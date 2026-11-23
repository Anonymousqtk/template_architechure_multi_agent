import type { Express, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { fail, type Authed } from './types.js';
import { toCents, fromCents } from './payroll.js';

interface OrgStructureDeps {
  pool: Pool;
  transaction: <T>(client: (db: PoolClient) => Promise<T>) => Promise<T>;
  audit: (
    db: PoolClient | Pool,
    action: string,
    userId?: string,
    orgId?: string,
    targetUserId?: string,
    metadata?: Record<string, unknown>
  ) => Promise<void>;
  requireIdentity: (req: Authed) => { userId: string; orgId: string; role: string };
}

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const uuidSchema = z.string().uuid();

const accountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
const componentTypeSchema = z.enum([
  'BASE_SALARY',
  'ALLOWANCE',
  'BONUS',
  'DEDUCTION',
  'OVERTIME',
  'STATUTORY_SI',
  'TAX',
  'NET_PAY',
]);

const accountCreateSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1),
  type: accountTypeSchema,
  description: z.string().trim().optional(),
  isActive: z.boolean().default(true),
});

const accountUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

const ruleCreateSchema = z.object({
  ruleCode: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1),
  componentType: componentTypeSchema,
  departmentId: uuidSchema.optional().nullable(),
  debitAccountId: uuidSchema,
  creditAccountId: uuidSchema,
  isActive: z.boolean().default(true),
});

const ruleUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  debitAccountId: uuidSchema.optional(),
  creditAccountId: uuidSchema.optional(),
  isActive: z.boolean().optional(),
});

const disbursementItemSchema = z.object({
  employeeId: uuidSchema,
  slipId: uuidSchema.optional().nullable(),
  disbursementCode: z.string().trim().min(1),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'OTHER']).default('BANK_TRANSFER'),
  bankName: z.string().trim().optional().nullable(),
  bankAccountNumber: z.string().trim().optional().nullable(),
  amount: z.number().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  referenceCode: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const disbursementBatchSchema = z.object({
  items: z.array(disbursementItemSchema).min(1),
});

const discrepancyUpdateSchema = z.object({
  resolutionStatus: z.enum(['PENDING', 'INVESTIGATING', 'ADJUSTED', 'RESOLVED', 'IGNORED']),
  resolutionNotes: z.string().trim().optional().nullable(),
});

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function registerPayrollAccountingRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const prefix = '/api/organizations/:organizationId/payroll';

  function assertAccountingAccess(role: string) {
    if (!['ADMIN', 'HR'].includes(role)) {
      fail(403, 'FORBIDDEN');
    }
  }

  // ============================================================
  // 1. Chart of Accounts (Hệ thống tài khoản kế toán)
  // ============================================================

  // Seed default standard chart of accounts & rules (VAS)
  app.post(`${prefix}/accounting/accounts/seed-defaults`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);

      await transaction(async (db) => {
        // Standard Accounts per VAS
        const standardAccounts = [
          { code: '3341', name: 'Phải trả người lao động (Lương)', type: 'LIABILITY', desc: 'Thanh toán tiền lương' },
          { code: '6422', name: 'Chi phí quản lý doanh nghiệp (Lương & phụ cấp)', type: 'EXPENSE', desc: 'Chi phí tiền lương khối quản lý' },
          { code: '6421', name: 'Chi phí bán hàng (Lương & phụ cấp)', type: 'EXPENSE', desc: 'Chi phí tiền lương khối kinh doanh / bán hàng' },
          { code: '622', name: 'Chi phí nhân công trực tiếp', type: 'EXPENSE', desc: 'Chi phí nhân công sản xuất trực tiếp' },
          { code: '3383', name: 'Bảo hiểm xã hội', type: 'LIABILITY', desc: 'BHXH người lao động & doanh nghiệp' },
          { code: '3384', name: 'Bảo hiểm y tế', type: 'LIABILITY', desc: 'BHYT người lao động & doanh nghiệp' },
          { code: '3386', name: 'Bảo hiểm thất nghiệp', type: 'LIABILITY', desc: 'BHTN người lao động & doanh nghiệp' },
          { code: '3382', name: 'Kinh phí công đoàn', type: 'LIABILITY', desc: 'Kinh phí công đoàn 2%' },
          { code: '3335', name: 'Thuế thu nhập cá nhân', type: 'LIABILITY', desc: 'Khấu trừ thuế TNCN người lao động' },
          { code: '1121', name: 'Tiền gửi ngân hàng (VND)', type: 'ASSET', desc: 'Tài khoản thanh toán chuyển khoản lương' },
          { code: '1111', name: 'Tiền mặt tại quỹ (VND)', type: 'ASSET', desc: 'Thanh toán tiền mặt' },
        ];

        const accountMap = new Map<string, string>();

        for (const acc of standardAccounts) {
          const existing = await db.query(
            `SELECT id FROM accounting_accounts WHERE organization_id = $1 AND upper(btrim(code)) = upper($2)`,
            [identity.orgId, acc.code]
          );
          if (existing.rowCount && existing.rows[0]) {
            accountMap.set(acc.code, existing.rows[0].id);
          } else {
            const id = randomUUID();
            await db.query(
              `INSERT INTO accounting_accounts (id, organization_id, code, name, type, description, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, true)`,
              [id, identity.orgId, acc.code, acc.name, acc.type, acc.desc]
            );
            accountMap.set(acc.code, id);
          }
        }

        // Standard Rules
        const defaultRules = [
          { ruleCode: 'BASE_SALARY_EXPENSE', name: 'Hạch toán lương cơ bản', componentType: 'BASE_SALARY', debit: '6422', credit: '3341' },
          { ruleCode: 'ALLOWANCE_EXPENSE', name: 'Hạch toán phụ cấp', componentType: 'ALLOWANCE', debit: '6422', credit: '3341' },
          { ruleCode: 'BONUS_EXPENSE', name: 'Hạch toán tiền thưởng', componentType: 'BONUS', debit: '6422', credit: '3341' },
          { ruleCode: 'OVERTIME_EXPENSE', name: 'Hạch toán làm thêm giờ', componentType: 'OVERTIME', debit: '6422', credit: '3341' },
          { ruleCode: 'SI_DEDUCTION', name: 'Khấu trừ BHXH', componentType: 'STATUTORY_SI', debit: '3341', credit: '3383' },
          { ruleCode: 'TAX_DEDUCTION', name: 'Khấu trừ thuế TNCN', componentType: 'TAX', debit: '3341', credit: '3335' },
          { ruleCode: 'NET_PAY_PAYMENT', name: 'Chi trả lương thực lĩnh', componentType: 'NET_PAY', debit: '3341', credit: '1121' },
        ];

        for (const rule of defaultRules) {
          const debitId = accountMap.get(rule.debit);
          const creditId = accountMap.get(rule.credit);
          if (!debitId || !creditId) continue;

          const existing = await db.query(
            `SELECT id FROM accounting_rules WHERE organization_id = $1 AND upper(btrim(rule_code)) = upper($2)`,
            [identity.orgId, rule.ruleCode]
          );
          if (!existing.rowCount) {
            const ruleId = randomUUID();
            await db.query(
              `INSERT INTO accounting_rules (id, organization_id, rule_code, name, component_type, debit_account_id, credit_account_id, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
              [ruleId, identity.orgId, rule.ruleCode, rule.name, rule.componentType, debitId, creditId]
            );
          }
        }

        await audit(db, 'ACCOUNTING_DEFAULTS_SEEDED', identity.userId, identity.orgId, undefined, {
          accountsCount: standardAccounts.length,
          rulesCount: defaultRules.length,
        });
      });

      return res.status(200).json({ ok: true, message: 'Seeded default accounts and posting rules' });
    } catch (err) {
      next(err);
    }
  });

  // List Accounts
  app.get(`${prefix}/accounting/accounts`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const { page, limit } = pagingSchema.parse(req.query);
      const typeFilter = typeof req.query.type === 'string' ? req.query.type.trim() : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const activeFilter = req.query.isActive !== undefined ? req.query.isActive === 'true' : null;

      const clauses = ['organization_id = $1'];
      const params: unknown[] = [identity.orgId];

      if (typeFilter) {
        params.push(typeFilter);
        clauses.push(`type = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        clauses.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
      }
      if (activeFilter !== null) {
        params.push(activeFilter);
        clauses.push(`is_active = $${params.length}`);
      }

      const where = clauses.join(' AND ');
      const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM accounting_accounts WHERE ${where}`, params);
      const total = countRes.rows[0].count;

      params.push(limit, (page - 1) * limit);
      const rowsRes = await pool.query(
        `SELECT id, code, name, type, description, is_active AS "isActive",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM accounting_accounts
         WHERE ${where}
         ORDER BY code ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return res.status(200).json({
        items: rowsRes.rows,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  });

  // Create Account
  app.post(`${prefix}/accounting/accounts`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const data = accountCreateSchema.parse(req.body);

      const dup = await pool.query(
        `SELECT id FROM accounting_accounts WHERE organization_id = $1 AND upper(btrim(code)) = upper($2)`,
        [identity.orgId, data.code]
      );
      if (dup.rowCount) fail(409, 'ACCOUNT_CODE_EXISTS');

      const id = randomUUID();
      await transaction(async (db) => {
        await db.query(
          `INSERT INTO accounting_accounts (id, organization_id, code, name, type, description, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, identity.orgId, data.code.toUpperCase(), data.name, data.type, data.description || null, data.isActive]
        );
        await audit(db, 'ACCOUNTING_ACCOUNT_CREATED', identity.userId, identity.orgId, undefined, {
          accountId: id,
          code: data.code.toUpperCase(),
          type: data.type,
        });
      });

      return res.status(201).json({ id, ...data, code: data.code.toUpperCase() });
    } catch (err) {
      next(err);
    }
  });

  // Update Account
  app.put(`${prefix}/accounting/accounts/:id`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const accountId = uuidSchema.parse(req.params.id);
      const data = accountUpdateSchema.parse(req.body);

      const existing = await pool.query(
        `SELECT id, code FROM accounting_accounts WHERE id = $1 AND organization_id = $2`,
        [accountId, identity.orgId]
      );
      if (!existing.rowCount) fail(404, 'ACCOUNT_NOT_FOUND');

      await transaction(async (db) => {
        await db.query(
          `UPDATE accounting_accounts
           SET name = COALESCE($1, name),
               description = COALESCE($2, description),
               is_active = COALESCE($3, is_active),
               updated_at = now()
           WHERE id = $4 AND organization_id = $5`,
          [data.name || null, data.description !== undefined ? data.description : null, data.isActive !== undefined ? data.isActive : null, accountId, identity.orgId]
        );
        await audit(db, 'ACCOUNTING_ACCOUNT_UPDATED', identity.userId, identity.orgId, undefined, {
          accountId,
          code: existing.rows[0].code,
        });
      });

      return res.status(200).json({ ok: true, accountId });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================
  // 2. Accounting Posting Rules (Quy tắc định khoản)
  // ============================================================

  // List Rules
  app.get(`${prefix}/accounting/rules`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);

      const rows = await pool.query(
        `SELECT r.id, r.rule_code AS "ruleCode", r.name, r.component_type AS "componentType",
                r.department_id AS "departmentId", d.name AS "departmentName",
                r.debit_account_id AS "debitAccountId", da.code AS "debitAccountCode", da.name AS "debitAccountName",
                r.credit_account_id AS "creditAccountId", ca.code AS "creditAccountCode", ca.name AS "creditAccountName",
                r.is_active AS "isActive", r.created_at AS "createdAt", r.updated_at AS "updatedAt"
         FROM accounting_rules r
         LEFT JOIN departments d ON d.id = r.department_id AND d.organization_id = r.organization_id
         JOIN accounting_accounts da ON da.id = r.debit_account_id AND da.organization_id = r.organization_id
         JOIN accounting_accounts ca ON ca.id = r.credit_account_id AND ca.organization_id = r.organization_id
         WHERE r.organization_id = $1
         ORDER BY r.rule_code ASC`,
        [identity.orgId]
      );

      return res.status(200).json({ items: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  // Create Rule
  app.post(`${prefix}/accounting/rules`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const data = ruleCreateSchema.parse(req.body);

      // Verify accounts exist and belong to tenant
      const debitAcc = await pool.query(`SELECT id FROM accounting_accounts WHERE id = $1 AND organization_id = $2`, [data.debitAccountId, identity.orgId]);
      if (!debitAcc.rowCount) fail(404, 'DEBIT_ACCOUNT_NOT_FOUND');
      const creditAcc = await pool.query(`SELECT id FROM accounting_accounts WHERE id = $1 AND organization_id = $2`, [data.creditAccountId, identity.orgId]);
      if (!creditAcc.rowCount) fail(404, 'CREDIT_ACCOUNT_NOT_FOUND');

      if (data.departmentId) {
        const dept = await pool.query(`SELECT id FROM departments WHERE id = $1 AND organization_id = $2`, [data.departmentId, identity.orgId]);
        if (!dept.rowCount) fail(404, 'DEPARTMENT_NOT_FOUND');
      }

      const dup = await pool.query(
        `SELECT id FROM accounting_rules WHERE organization_id = $1 AND upper(btrim(rule_code)) = upper($2)`,
        [identity.orgId, data.ruleCode]
      );
      if (dup.rowCount) fail(409, 'RULE_CODE_EXISTS');

      const id = randomUUID();
      await transaction(async (db) => {
        await db.query(
          `INSERT INTO accounting_rules (id, organization_id, rule_code, name, component_type, department_id, debit_account_id, credit_account_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, identity.orgId, data.ruleCode.toUpperCase(), data.name, data.componentType, data.departmentId || null, data.debitAccountId, data.creditAccountId, data.isActive]
        );
        await audit(db, 'ACCOUNTING_RULE_CREATED', identity.userId, identity.orgId, undefined, {
          ruleId: id,
          ruleCode: data.ruleCode.toUpperCase(),
        });
      });

      return res.status(201).json({ id, ...data, ruleCode: data.ruleCode.toUpperCase() });
    } catch (err) {
      next(err);
    }
  });

  // Update Rule
  app.put(`${prefix}/accounting/rules/:id`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const ruleId = uuidSchema.parse(req.params.id);
      const data = ruleUpdateSchema.parse(req.body);

      const existing = await pool.query(`SELECT id, rule_code FROM accounting_rules WHERE id = $1 AND organization_id = $2`, [ruleId, identity.orgId]);
      if (!existing.rowCount) fail(404, 'RULE_NOT_FOUND');

      if (data.debitAccountId) {
        const debitAcc = await pool.query(`SELECT id FROM accounting_accounts WHERE id = $1 AND organization_id = $2`, [data.debitAccountId, identity.orgId]);
        if (!debitAcc.rowCount) fail(404, 'DEBIT_ACCOUNT_NOT_FOUND');
      }
      if (data.creditAccountId) {
        const creditAcc = await pool.query(`SELECT id FROM accounting_accounts WHERE id = $1 AND organization_id = $2`, [data.creditAccountId, identity.orgId]);
        if (!creditAcc.rowCount) fail(404, 'CREDIT_ACCOUNT_NOT_FOUND');
      }

      await transaction(async (db) => {
        await db.query(
          `UPDATE accounting_rules
           SET name = COALESCE($1, name),
               debit_account_id = COALESCE($2, debit_account_id),
               credit_account_id = COALESCE($3, credit_account_id),
               is_active = COALESCE($4, is_active),
               updated_at = now()
           WHERE id = $5 AND organization_id = $6`,
          [data.name || null, data.debitAccountId || null, data.creditAccountId || null, data.isActive !== undefined ? data.isActive : null, ruleId, identity.orgId]
        );
        await audit(db, 'ACCOUNTING_RULE_UPDATED', identity.userId, identity.orgId, undefined, {
          ruleId,
          ruleCode: existing.rows[0].rule_code,
        });
      });

      return res.status(200).json({ ok: true, ruleId });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================
  // 3. Journal Entry Generation & Management (Bút toán sổ nhật ký)
  // ============================================================

  // Generate Journal Entry from Approved or Closed Payroll Period
  app.post(`${prefix}/periods/:id/accounting/generate`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);

      // Period must be APPROVED or CLOSED
      const periodRes = await pool.query(
        `SELECT id, code, name, status, start_date AS "startDate", end_date AS "endDate"
         FROM payroll_periods
         WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PAYROLL_PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      if (!['APPROVED', 'CLOSED'].includes(period.status)) {
        fail(409, 'PAYROLL_PERIOD_NOT_APPROVED_OR_CLOSED');
      }

      // Check rules configured
      const rulesRes = await pool.query(
        `SELECT id, rule_code, component_type, department_id, debit_account_id, credit_account_id
         FROM accounting_rules
         WHERE organization_id = $1 AND is_active = true`,
        [identity.orgId]
      );
      if (!rulesRes.rowCount) {
        fail(400, 'NO_ACTIVE_ACCOUNTING_RULES_FOUND');
      }

      // Read all slips with employee department
      const slipsRes = await pool.query(
        `SELECT s.id, s.employee_id, s.base_salary, s.prorated_base_salary, s.total_allowances,
                s.total_bonuses, s.total_deductions, s.overtime_pay, s.gross_pay, s.net_pay,
                e.department_id, d.name AS "departmentName"
         FROM payroll_slips s
         JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
         LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
         WHERE s.period_id = $1 AND s.organization_id = $2`,
        [periodId, identity.orgId]
      );

      if (!slipsRes.rowCount) {
        fail(400, 'NO_PAYROLL_SLIPS_FOUND');
      }

      // Read detailed slip items for exact component breakdowns
      const slipItemsRes = await pool.query(
        `SELECT si.slip_id, si.component_id, si.component_name, si.type, si.amount,
                e.department_id
         FROM payroll_slip_items si
         JOIN payroll_slips s ON s.id = si.slip_id AND s.organization_id = si.organization_id
         JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
         WHERE s.period_id = $1 AND s.organization_id = $2`,
        [periodId, identity.orgId]
      );

      // Find best rule matching componentType and departmentId (or fallback to org-wide rule)
      function findRule(type: string, deptId: string | null) {
        const matching = rulesRes.rows.filter((r) => r.component_type === type);
        if (deptId) {
          const deptSpecific = matching.find((r) => r.department_id === deptId);
          if (deptSpecific) return deptSpecific;
        }
        return matching.find((r) => !r.department_id);
      }

      // Group costs by Debit Account, Credit Account, Department, Description
      // We will generate balanced double-entry lines:
      // Line: { debitAccountId, creditAccountId, deptId, amountCents, desc }
      interface PostingLineAccumulator {
        debitAccountId: string;
        creditAccountId: string;
        departmentId: string | null;
        description: string;
        amountCents: bigint;
      }
      const postingMap = new Map<string, PostingLineAccumulator>();

      function addPosting(debitAcc: string, creditAcc: string, deptId: string | null, desc: string, cents: bigint) {
        if (cents <= 0n) return;
        const key = `${debitAcc}__${creditAcc}__${deptId || 'NONE'}__${desc}`;
        const existing = postingMap.get(key);
        if (existing) {
          existing.amountCents += cents;
        } else {
          postingMap.set(key, {
            debitAccountId: debitAcc,
            creditAccountId: creditAcc,
            departmentId: deptId,
            description: desc,
            amountCents: cents,
          });
        }
      }

      // 1. Process Slips: Prorated Base Salary + Overtime Pay
      for (const slip of slipsRes.rows) {
        const deptId = slip.department_id || null;
        const baseCents = toCents(slip.prorated_base_salary);
        if (baseCents > 0n) {
          const rule = findRule('BASE_SALARY', deptId);
          if (rule) {
            addPosting(rule.debit_account_id, rule.credit_account_id, deptId, 'Lương cơ bản', baseCents);
          }
        }

        const otCents = toCents(slip.overtime_pay);
        if (otCents > 0n) {
          const rule = findRule('OVERTIME', deptId) || findRule('BASE_SALARY', deptId);
          if (rule) {
            addPosting(rule.debit_account_id, rule.credit_account_id, deptId, 'Lương làm thêm giờ', otCents);
          }
        }
      }

      // 2. Process Detailed Slip Items: Allowances, Bonuses, Deductions
      for (const item of slipItemsRes.rows) {
        const deptId = item.department_id || null;
        const cents = toCents(item.amount);
        if (cents <= 0n) continue;

        if (item.type === 'ALLOWANCE') {
          const rule = findRule('ALLOWANCE', deptId) || findRule('BASE_SALARY', deptId);
          if (rule) addPosting(rule.debit_account_id, rule.credit_account_id, deptId, `Phụ cấp: ${item.component_name}`, cents);
        } else if (item.type === 'BONUS') {
          const rule = findRule('BONUS', deptId) || findRule('BASE_SALARY', deptId);
          if (rule) addPosting(rule.debit_account_id, rule.credit_account_id, deptId, `Thưởng: ${item.component_name}`, cents);
        } else if (item.type === 'DEDUCTION') {
          // If item name contains BHXH / BHYT / BHTN / Bảo hiểm -> STATUTORY_SI
          const isSI = /bảo hiểm|bhxh|bhyt|bhtn/i.test(item.component_name);
          const isTax = /thuế|tax|tncn/i.test(item.component_name);
          let rule = null;
          if (isSI) rule = findRule('STATUTORY_SI', deptId);
          else if (isTax) rule = findRule('TAX', deptId);
          if (!rule) rule = findRule('DEDUCTION', deptId);

          if (rule) {
            addPosting(rule.debit_account_id, rule.credit_account_id, deptId, `Khấu trừ: ${item.component_name}`, cents);
          }
        }
      }

      if (postingMap.size === 0) {
        fail(400, 'CANNOT_GENERATE_ENTRIES_NO_MATCHING_POSTING_RULES');
      }

      // Convert accumulators into double-entry lines (Debit and Credit lines)
      interface JournalLineDraft {
        accountId: string;
        departmentId: string | null;
        debitAmountCents: bigint;
        creditAmountCents: bigint;
        description: string;
      }
      const linesDraft: JournalLineDraft[] = [];

      for (const item of postingMap.values()) {
        // Debit line
        linesDraft.push({
          accountId: item.debitAccountId,
          departmentId: item.departmentId,
          debitAmountCents: item.amountCents,
          creditAmountCents: 0n,
          description: `Nợ: ${item.description}`,
        });
        // Credit line
        linesDraft.push({
          accountId: item.creditAccountId,
          departmentId: item.departmentId,
          debitAmountCents: 0n,
          creditAmountCents: item.amountCents,
          description: `Có: ${item.description}`,
        });
      }

      // Check balance: sum(debit) === sum(credit)
      let totalDebitCents = 0n;
      let totalCreditCents = 0n;
      for (const l of linesDraft) {
        totalDebitCents += l.debitAmountCents;
        totalCreditCents += l.creditAmountCents;
      }

      if (totalDebitCents !== totalCreditCents) {
        fail(400, 'JOURNAL_ENTRY_UNBALANCED');
      }

      const totalDebitStr = fromCents(totalDebitCents);
      const totalCreditStr = fromCents(totalCreditCents);

      const entryId = randomUUID();
      const entryNumber = `PKT-${period.code}-${Date.now().toString().slice(-4)}`;
      const entryDate = new Date().toISOString().slice(0, 10);
      const status = req.query.status === 'POSTED' ? 'POSTED' : 'DRAFT';

      await transaction(async (db) => {
        // 1. Insert entry in DRAFT status first so lines can be attached
        await db.query(
          `INSERT INTO payroll_journal_entries (id, organization_id, period_id, entry_number, entry_date, status, total_debit, total_credit, description, posted_by, posted_at)
           VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, null, null)`,
          [
            entryId,
            identity.orgId,
            periodId,
            entryNumber,
            entryDate,
            totalDebitStr,
            totalCreditStr,
            `Bút toán chi phí lương kỳ ${period.name}`,
          ]
        );

        let order = 1;
        for (const line of linesDraft) {
          const lineId = randomUUID();
          await db.query(
            `INSERT INTO payroll_journal_entry_lines (id, organization_id, entry_id, account_id, department_id, debit_amount, credit_amount, description, line_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              lineId,
              identity.orgId,
              entryId,
              line.accountId,
              line.departmentId,
              fromCents(line.debitAmountCents),
              fromCents(line.creditAmountCents),
              line.description,
              order++,
            ]
          );
        }

        // 2. If status was requested as POSTED, transition to POSTED now that lines are in place
        if (status === 'POSTED') {
          await db.query(
            `UPDATE payroll_journal_entries
             SET status = 'POSTED', posted_by = $1, posted_at = now(), updated_at = now()
             WHERE id = $2 AND organization_id = $3`,
            [identity.userId, entryId, identity.orgId]
          );
        }

        await audit(db, 'PAYROLL_JOURNAL_GENERATED', identity.userId, identity.orgId, undefined, {
          entryId,
          entryNumber,
          periodId,
          totalDebit: totalDebitStr,
          linesCount: linesDraft.length,
          status,
        });
      });

      return res.status(201).json({
        id: entryId,
        entryNumber,
        entryDate,
        status,
        totalDebit: totalDebitStr,
        totalCredit: totalCreditStr,
        linesCount: linesDraft.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // List Journal Entries for Period
  app.get(`${prefix}/periods/:id/accounting/entries`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);

      const rows = await pool.query(
        `SELECT e.id, e.entry_number AS "entryNumber", e.entry_date AS "entryDate", e.status,
                e.total_debit AS "totalDebit", e.total_credit AS "totalCredit", e.description,
                e.reversal_entry_id AS "reversalEntryId", e.posted_at AS "postedAt", e.reversed_at AS "reversedAt",
                u_post.full_name AS "postedByName", u_rev.full_name AS "reversedByName",
                e.created_at AS "createdAt"
         FROM payroll_journal_entries e
         LEFT JOIN users u_post ON u_post.id = e.posted_by
         LEFT JOIN users u_rev ON u_rev.id = e.reversed_by
         WHERE e.period_id = $1 AND e.organization_id = $2
         ORDER BY e.entry_date DESC, e.created_at DESC`,
        [periodId, identity.orgId]
      );

      return res.status(200).json({ items: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  // Get Journal Entry Details with Lines
  app.get(`${prefix}/accounting/entries/:entryId`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const entryId = uuidSchema.parse(req.params.entryId);

      const entryRes = await pool.query(
        `SELECT e.id, e.period_id AS "periodId", e.entry_number AS "entryNumber", e.entry_date AS "entryDate",
                e.status, e.total_debit AS "totalDebit", e.total_credit AS "totalCredit", e.description,
                e.reversal_entry_id AS "reversalEntryId", e.posted_at AS "postedAt", e.reversed_at AS "reversedAt",
                p.code AS "periodCode", p.name AS "periodName",
                u_post.full_name AS "postedByName", u_rev.full_name AS "reversedByName",
                e.created_at AS "createdAt"
         FROM payroll_journal_entries e
         JOIN payroll_periods p ON p.id = e.period_id AND p.organization_id = e.organization_id
         LEFT JOIN users u_post ON u_post.id = e.posted_by
         LEFT JOIN users u_rev ON u_rev.id = e.reversed_by
         WHERE e.id = $1 AND e.organization_id = $2`,
        [entryId, identity.orgId]
      );
      if (!entryRes.rowCount) fail(404, 'JOURNAL_ENTRY_NOT_FOUND');

      const linesRes = await pool.query(
        `SELECT l.id, l.account_id AS "accountId", a.code AS "accountCode", a.name AS "accountName", a.type AS "accountType",
                l.department_id AS "departmentId", d.name AS "departmentName",
                l.debit_amount AS "debitAmount", l.credit_amount AS "creditAmount",
                l.description, l.line_order AS "lineOrder"
         FROM payroll_journal_entry_lines l
         JOIN accounting_accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
         LEFT JOIN departments d ON d.id = l.department_id AND d.organization_id = l.organization_id
         WHERE l.entry_id = $1 AND l.organization_id = $2
         ORDER BY l.line_order ASC`,
        [entryId, identity.orgId]
      );

      return res.status(200).json({
        entry: entryRes.rows[0],
        lines: linesRes.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // Post Journal Entry (Transition DRAFT -> POSTED)
  app.post(`${prefix}/accounting/entries/:entryId/post`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const entryId = uuidSchema.parse(req.params.entryId);

      const entryRes = await pool.query(
        `SELECT id, entry_number, status, total_debit, total_credit
         FROM payroll_journal_entries
         WHERE id = $1 AND organization_id = $2`,
        [entryId, identity.orgId]
      );
      if (!entryRes.rowCount) fail(404, 'JOURNAL_ENTRY_NOT_FOUND');
      const entry = entryRes.rows[0];

      if (entry.status !== 'DRAFT') {
        fail(409, 'JOURNAL_ENTRY_NOT_IN_DRAFT_STATUS');
      }

      if (toCents(entry.total_debit) !== toCents(entry.total_credit)) {
        fail(400, 'JOURNAL_ENTRY_UNBALANCED');
      }

      await transaction(async (db) => {
        await db.query(
          `UPDATE payroll_journal_entries
           SET status = 'POSTED', posted_by = $1, posted_at = now(), updated_at = now()
           WHERE id = $2 AND organization_id = $3`,
          [identity.userId, entryId, identity.orgId]
        );
        await audit(db, 'PAYROLL_JOURNAL_POSTED', identity.userId, identity.orgId, undefined, {
          entryId,
          entryNumber: entry.entry_number,
        });
      });

      return res.status(200).json({ ok: true, status: 'POSTED' });
    } catch (err) {
      next(err);
    }
  });

  // Reverse Journal Entry (Đảo bút toán có lưu vết)
  app.post(`${prefix}/accounting/entries/:entryId/reverse`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const entryId = uuidSchema.parse(req.params.entryId);

      const entryRes = await pool.query(
        `SELECT id, period_id, entry_number, status, total_debit, total_credit, description
         FROM payroll_journal_entries
         WHERE id = $1 AND organization_id = $2`,
        [entryId, identity.orgId]
      );
      if (!entryRes.rowCount) fail(404, 'JOURNAL_ENTRY_NOT_FOUND');
      const original = entryRes.rows[0];

      if (original.status !== 'POSTED') {
        fail(409, 'ONLY_POSTED_ENTRIES_CAN_BE_REVERSED');
      }

      // Read lines to reverse
      const linesRes = await pool.query(
        `SELECT account_id, department_id, debit_amount, credit_amount, description, line_order
         FROM payroll_journal_entry_lines
         WHERE entry_id = $1 AND organization_id = $2
         ORDER BY line_order ASC`,
        [entryId, identity.orgId]
      );

      const reversalId = randomUUID();
      const reversalNumber = `${original.entry_number}-REV`;
      const reversalDate = new Date().toISOString().slice(0, 10);

      await transaction(async (db) => {
        // 1. Create reversal entry with status DRAFT first so lines can be attached
        await db.query(
          `INSERT INTO payroll_journal_entries (id, organization_id, period_id, entry_number, entry_date, status, total_debit, total_credit, description, posted_by, posted_at)
           VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, null, null)`,
          [
            reversalId,
            identity.orgId,
            original.period_id,
            reversalNumber,
            reversalDate,
            original.total_credit, // Swapped total debit
            original.total_debit,  // Swapped total credit
            `Đảo bút toán chứng từ ${original.entry_number}`,
          ]
        );

        // 2. Insert lines with swapped Debit and Credit
        for (const line of linesRes.rows) {
          const lineId = randomUUID();
          await db.query(
            `INSERT INTO payroll_journal_entry_lines (id, organization_id, entry_id, account_id, department_id, debit_amount, credit_amount, description, line_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              lineId,
              identity.orgId,
              reversalId,
              line.account_id,
              line.department_id,
              line.credit_amount, // Swapped!
              line.debit_amount,  // Swapped!
              `Đảo: ${line.description}`,
              line.line_order,
            ]
          );
        }

        // 3. Lock reversal entry to POSTED
        await db.query(
          `UPDATE payroll_journal_entries
           SET status = 'POSTED', posted_by = $1, posted_at = now(), updated_at = now()
           WHERE id = $2 AND organization_id = $3`,
          [identity.userId, reversalId, identity.orgId]
        );

        // 4. Mark original entry as REVERSED and link reversal entry
        await db.query(
          `UPDATE payroll_journal_entries
           SET status = 'REVERSED', reversed_by = $1, reversed_at = now(), reversal_entry_id = $2, updated_at = now()
           WHERE id = $3 AND organization_id = $4`,
          [identity.userId, reversalId, entryId, identity.orgId]
        );

        await audit(db, 'PAYROLL_JOURNAL_REVERSED', identity.userId, identity.orgId, undefined, {
          originalEntryId: entryId,
          originalEntryNumber: original.entry_number,
          reversalEntryId: reversalId,
          reversalNumber,
        });
      });

      return res.status(200).json({
        ok: true,
        originalEntryId: entryId,
        reversalEntryId: reversalId,
        reversalNumber,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================
  // 4. Payroll Disbursements (Thanh toán / chi trả lương)
  // ============================================================

  // Record / Import Payment Disbursements
  app.post(`${prefix}/periods/:id/disbursements`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);
      const data = disbursementBatchSchema.parse(req.body);

      const periodRes = await pool.query(`SELECT id FROM payroll_periods WHERE id = $1 AND organization_id = $2`, [periodId, identity.orgId]);
      if (!periodRes.rowCount) fail(404, 'PAYROLL_PERIOD_NOT_FOUND');

      const insertedIds: string[] = [];

      await transaction(async (db) => {
        for (const item of data.items) {
          // Check employee exists
          const empRes = await db.query(`SELECT id FROM employees WHERE id = $1 AND organization_id = $2`, [item.employeeId, identity.orgId]);
          if (!empRes.rowCount) fail(404, `EMPLOYEE_NOT_FOUND: ${item.employeeId}`);

          // Check duplicate disbursement code
          const dupCode = await db.query(
            `SELECT id FROM payroll_disbursements WHERE organization_id = $1 AND upper(btrim(disbursement_code)) = upper($2)`,
            [identity.orgId, item.disbursementCode]
          );
          if (dupCode.rowCount) fail(409, `DISBURSEMENT_CODE_EXISTS: ${item.disbursementCode}`);

          const disbId = randomUUID();
          await db.query(
            `INSERT INTO payroll_disbursements (id, organization_id, period_id, slip_id, employee_id, disbursement_code, payment_method, bank_name, bank_account_number, amount, payment_date, reference_code, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              disbId,
              identity.orgId,
              periodId,
              item.slipId || null,
              item.employeeId,
              item.disbursementCode.toUpperCase(),
              item.paymentMethod,
              item.bankName || null,
              item.bankAccountNumber || null,
              item.amount,
              item.paymentDate,
              item.referenceCode || null,
              item.notes || null,
            ]
          );
          insertedIds.push(disbId);

          // If bank info provided, update employee record if empty
          if (item.bankName || item.bankAccountNumber) {
            await db.query(
              `UPDATE employees
               SET bank_name = COALESCE(bank_name, $1),
                   bank_account_number = COALESCE(bank_account_number, $2)
               WHERE id = $3 AND organization_id = $4`,
              [item.bankName || null, item.bankAccountNumber || null, item.employeeId, identity.orgId]
            );
          }
        }

        await audit(db, 'PAYROLL_DISBURSEMENT_RECORDED', identity.userId, identity.orgId, undefined, {
          periodId,
          count: data.items.length,
        });
      });

      return res.status(201).json({ ok: true, count: insertedIds.length, ids: insertedIds });
    } catch (err) {
      next(err);
    }
  });

  // List Disbursements for Period
  app.get(`${prefix}/periods/:id/disbursements`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);
      const { page, limit } = pagingSchema.parse(req.query);

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM payroll_disbursements WHERE period_id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      const total = countRes.rows[0].count;

      const rows = await pool.query(
        `SELECT d.id, d.disbursement_code AS "disbursementCode", d.payment_method AS "paymentMethod",
                d.bank_name AS "bankName", d.bank_account_number AS "bankAccountNumber",
                d.amount, d.payment_date AS "paymentDate", d.status, d.reference_code AS "referenceCode",
                d.notes, d.employee_id AS "employeeId", e.employee_code AS "employeeCode",
                u.full_name AS "employeeName", d.created_at AS "createdAt"
         FROM payroll_disbursements d
         JOIN employees e ON e.id = d.employee_id AND e.organization_id = d.organization_id
         LEFT JOIN users u ON u.id = e.user_id
         WHERE d.period_id = $1 AND d.organization_id = $2
         ORDER BY d.payment_date DESC, d.created_at DESC
         LIMIT $3 OFFSET $4`,
        [periodId, identity.orgId, limit, (page - 1) * limit]
      );

      return res.status(200).json({
        items: rows.rows,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================
  // 5. Payroll Reconciliation (Đối chiếu bảng lương)
  // ============================================================

  // Run Reconciliation for Period
  app.post(`${prefix}/periods/:id/reconcile`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);

      const periodRes = await pool.query(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PAYROLL_PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      // Read all payslips
      const slipsRes = await pool.query(
        `SELECT id, employee_id, net_pay, gross_pay FROM payroll_slips WHERE period_id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );

      // Read all COMPLETED disbursements
      const disbRes = await pool.query(
        `SELECT id, employee_id, slip_id, amount, disbursement_code
         FROM payroll_disbursements
         WHERE period_id = $1 AND organization_id = $2 AND status = 'COMPLETED'`,
        [periodId, identity.orgId]
      );

      // Map disbursements by employee
      const disbByEmp = new Map<string, typeof disbRes.rows>();
      for (const d of disbRes.rows) {
        const list = disbByEmp.get(d.employee_id) || [];
        list.push(d);
        disbByEmp.set(d.employee_id, list);
      }

      // Discrepancy detector
      interface DiscrepancyDraft {
        employeeId: string;
        slipId: string | null;
        disbursementId: string | null;
        type: 'UNPAID' | 'OVERPAID' | 'UNDERPAID' | 'DUPLICATE' | 'ORPHAN_PAYMENT';
        expectedAmount: string;
        disbursedAmount: string;
        differenceAmount: string;
        notes: string;
      }
      const discrepancies: DiscrepancyDraft[] = [];

      let totalExpectedCents = 0n;
      let totalDisbursedCents = 0n;
      let matchedCount = 0;
      const seenEmployees = new Set<string>();

      // Check each payslip
      for (const slip of slipsRes.rows) {
        seenEmployees.add(slip.employee_id);
        const expCents = toCents(slip.net_pay);
        totalExpectedCents += expCents;

        const disbs = disbByEmp.get(slip.employee_id) || [];
        let empDisbCents = 0n;
        for (const d of disbs) {
          empDisbCents += toCents(d.amount);
        }
        totalDisbursedCents += empDisbCents;

        if (disbs.length === 0) {
          // No payment found
          discrepancies.push({
            employeeId: slip.employee_id,
            slipId: slip.id,
            disbursementId: null,
            type: 'UNPAID',
            expectedAmount: fromCents(expCents),
            disbursedAmount: '0.00',
            differenceAmount: fromCents(expCents),
            notes: 'Chưa có khoản chi trả nào được ghi nhận cho phiếu lương này',
          });
        } else if (disbs.length > 1) {
          // Multiple payments -> duplicate or split
          const diffCents = expCents - empDisbCents;
          discrepancies.push({
            employeeId: slip.employee_id,
            slipId: slip.id,
            disbursementId: disbs[0].id,
            type: 'DUPLICATE',
            expectedAmount: fromCents(expCents),
            disbursedAmount: fromCents(empDisbCents),
            differenceAmount: fromCents(diffCents),
            notes: `Phát hiện ${disbs.length} giao dịch chi trả cho cùng nhân viên trong kỳ`,
          });
        } else {
          // Exactly 1 disbursement
          const diffCents = expCents - empDisbCents;
          if (diffCents > 0n) {
            discrepancies.push({
              employeeId: slip.employee_id,
              slipId: slip.id,
              disbursementId: disbs[0].id,
              type: 'UNDERPAID',
              expectedAmount: fromCents(expCents),
              disbursedAmount: fromCents(empDisbCents),
              differenceAmount: fromCents(diffCents),
              notes: 'Số tiền chi trả nhỏ hơn mức lương thực lĩnh',
            });
          } else if (diffCents < 0n) {
            discrepancies.push({
              employeeId: slip.employee_id,
              slipId: slip.id,
              disbursementId: disbs[0].id,
              type: 'OVERPAID',
              expectedAmount: fromCents(expCents),
              disbursedAmount: fromCents(empDisbCents),
              differenceAmount: fromCents(diffCents),
              notes: 'Số tiền chi trả vượt quá mức lương thực lĩnh',
            });
          } else {
            matchedCount++;
          }
        }
      }

      // Check for orphan disbursements (disbursements without a slip in this period)
      for (const d of disbRes.rows) {
        if (!seenEmployees.has(d.employee_id)) {
          const dCents = toCents(d.amount);
          discrepancies.push({
            employeeId: d.employee_id,
            slipId: null,
            disbursementId: d.id,
            type: 'ORPHAN_PAYMENT',
            expectedAmount: '0.00',
            disbursedAmount: fromCents(dCents),
            differenceAmount: fromCents(-dCents),
            notes: 'Khoản chi trả không tìm thấy phiếu lương tương ứng trong kỳ',
          });
        }
      }

      const diffTotalCents = totalExpectedCents - totalDisbursedCents;
      const status = discrepancies.length === 0 ? 'RECONCILED' : 'DISCREPANCY_DETECTED';

      let recId = randomUUID();

      await transaction(async (db) => {
        // Upsert reconciliation
        const existingRec = await db.query(
          `SELECT id FROM payroll_reconciliations WHERE period_id = $1 AND organization_id = $2`,
          [periodId, identity.orgId]
        );

        if (existingRec.rowCount) {
          recId = existingRec.rows[0].id;
          await db.query(
            `UPDATE payroll_reconciliations
             SET reconciliation_date = CURRENT_DATE,
                 status = $1,
                 total_expected_slips = $2,
                 total_expected_amount = $3,
                 total_disbursed_slips = $4,
                 total_disbursed_amount = $5,
                 difference_amount = $6,
                 matched_count = $7,
                 discrepancy_count = $8,
                 reconciled_by = $9,
                 reconciled_at = now(),
                 updated_at = now()
             WHERE id = $10 AND organization_id = $11`,
            [
              status,
              slipsRes.rowCount,
              fromCents(totalExpectedCents),
              disbRes.rowCount,
              fromCents(totalDisbursedCents),
              fromCents(diffTotalCents),
              matchedCount,
              discrepancies.length,
              identity.userId,
              recId,
              identity.orgId,
            ]
          );
          // Delete old discrepancies
          await db.query(`DELETE FROM payroll_reconciliation_discrepancies WHERE reconciliation_id = $1 AND organization_id = $2`, [recId, identity.orgId]);
        } else {
          await db.query(
            `INSERT INTO payroll_reconciliations (id, organization_id, period_id, reconciliation_date, status, total_expected_slips, total_expected_amount, total_disbursed_slips, total_disbursed_amount, difference_amount, matched_count, discrepancy_count, reconciled_by, reconciled_at)
             VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
            [
              recId,
              identity.orgId,
              periodId,
              status,
              slipsRes.rowCount,
              fromCents(totalExpectedCents),
              disbRes.rowCount,
              fromCents(totalDisbursedCents),
              fromCents(diffTotalCents),
              matchedCount,
              discrepancies.length,
              identity.userId,
            ]
          );
        }

        // Insert discrepancies
        for (const disc of discrepancies) {
          const discId = randomUUID();
          await db.query(
            `INSERT INTO payroll_reconciliation_discrepancies (id, organization_id, reconciliation_id, employee_id, slip_id, disbursement_id, type, expected_amount, disbursed_amount, difference_amount, resolution_status, resolution_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11)`,
            [
              discId,
              identity.orgId,
              recId,
              disc.employeeId,
              disc.slipId,
              disc.disbursementId,
              disc.type,
              disc.expectedAmount,
              disc.disbursedAmount,
              disc.differenceAmount,
              disc.notes,
            ]
          );
        }

        // Update Payroll Liabilities
        const liabEndingCents = diffTotalCents;
        const liabStatus = liabEndingCents === 0n ? 'SETTLED' : totalDisbursedCents > 0n ? 'PARTIALLY_SETTLED' : 'OPEN';

        await db.query(
          `INSERT INTO payroll_liabilities (id, organization_id, period_id, beginning_balance, incurred_amount, paid_amount, ending_balance, status, last_reconciled_at)
           VALUES ($1, $2, $3, 0.00, $4, $5, $6, $7, now())
           ON CONFLICT (period_id) DO UPDATE
           SET incurred_amount = EXCLUDED.incurred_amount,
               paid_amount = EXCLUDED.paid_amount,
               ending_balance = EXCLUDED.ending_balance,
               status = EXCLUDED.status,
               last_reconciled_at = now(),
               updated_at = now()`,
          [
            randomUUID(),
            identity.orgId,
            periodId,
            fromCents(totalExpectedCents),
            fromCents(totalDisbursedCents),
            fromCents(liabEndingCents),
            liabStatus,
          ]
        );

        await audit(db, 'PAYROLL_RECONCILIATION_RUN', identity.userId, identity.orgId, undefined, {
          periodId,
          status,
          totalExpected: fromCents(totalExpectedCents),
          totalDisbursed: fromCents(totalDisbursedCents),
          matchedCount,
          discrepancyCount: discrepancies.length,
        });
      });

      return res.status(200).json({
        reconciliationId: recId,
        periodId,
        status,
        totalExpectedSlips: slipsRes.rowCount,
        totalExpectedAmount: fromCents(totalExpectedCents),
        totalDisbursedSlips: disbRes.rowCount,
        totalDisbursedAmount: fromCents(totalDisbursedCents),
        differenceAmount: fromCents(diffTotalCents),
        matchedCount,
        discrepancyCount: discrepancies.length,
        discrepancies,
      });
    } catch (err) {
      next(err);
    }
  });

  // Get Reconciliation Summary & Discrepancies
  app.get(`${prefix}/periods/:id/reconciliation`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);

      const recRes = await pool.query(
        `SELECT r.id, r.period_id AS "periodId", r.reconciliation_date AS "reconciliationDate",
                r.status, r.total_expected_slips AS "totalExpectedSlips",
                r.total_expected_amount AS "totalExpectedAmount",
                r.total_disbursed_slips AS "totalDisbursedSlips",
                r.total_disbursed_amount AS "totalDisbursedAmount",
                r.difference_amount AS "differenceAmount",
                r.matched_count AS "matchedCount",
                r.discrepancy_count AS "discrepancyCount",
                r.reconciled_at AS "reconciledAt", u.full_name AS "reconciledByName"
         FROM payroll_reconciliations r
         LEFT JOIN users u ON u.id = r.reconciled_by
         WHERE r.period_id = $1 AND r.organization_id = $2`,
        [periodId, identity.orgId]
      );

      if (!recRes.rowCount) {
        return res.status(200).json({ reconciliation: null, discrepancies: [] });
      }

      const rec = recRes.rows[0];
      const discRes = await pool.query(
        `SELECT d.id, d.employee_id AS "employeeId", e.employee_code AS "employeeCode",
                u.full_name AS "employeeName", dep.name AS "departmentName",
                d.slip_id AS "slipId", d.disbursement_id AS "disbursementId",
                d.type, d.expected_amount AS "expectedAmount", d.disbursed_amount AS "disbursedAmount",
                d.difference_amount AS "differenceAmount", d.resolution_status AS "resolutionStatus",
                d.resolution_notes AS "resolutionNotes", d.resolved_at AS "resolvedAt",
                u_res.full_name AS "resolvedByName"
         FROM payroll_reconciliation_discrepancies d
         JOIN employees e ON e.id = d.employee_id AND e.organization_id = d.organization_id
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN departments dep ON dep.id = e.department_id AND dep.organization_id = e.organization_id
         LEFT JOIN users u_res ON u_res.id = d.resolved_by
         WHERE d.reconciliation_id = $1 AND d.organization_id = $2
         ORDER BY d.created_at ASC`,
        [rec.id, identity.orgId]
      );

      return res.status(200).json({
        reconciliation: rec,
        discrepancies: discRes.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // Resolve / Update Discrepancy Item
  app.patch(`${prefix}/reconciliation/discrepancies/:id`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const discId = uuidSchema.parse(req.params.id);
      const data = discrepancyUpdateSchema.parse(req.body);

      const discRes = await pool.query(
        `SELECT id, reconciliation_id, type FROM payroll_reconciliation_discrepancies WHERE id = $1 AND organization_id = $2`,
        [discId, identity.orgId]
      );
      if (!discRes.rowCount) fail(404, 'DISCREPANCY_NOT_FOUND');
      const disc = discRes.rows[0];

      await transaction(async (db) => {
        await db.query(
          `UPDATE payroll_reconciliation_discrepancies
           SET resolution_status = $1,
               resolution_notes = COALESCE($2, resolution_notes),
               resolved_by = $3,
               resolved_at = now(),
               updated_at = now()
           WHERE id = $4 AND organization_id = $5`,
          [data.resolutionStatus, data.resolutionNotes !== undefined ? data.resolutionNotes : null, identity.userId, discId, identity.orgId]
        );

        // Check if all discrepancies are resolved or ignored
        const remaining = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM payroll_reconciliation_discrepancies
           WHERE reconciliation_id = $1 AND organization_id = $2 AND resolution_status NOT IN ('RESOLVED', 'IGNORED')`,
          [disc.reconciliation_id, identity.orgId]
        );

        if (remaining.rows[0].count === 0) {
          await db.query(
            `UPDATE payroll_reconciliations
             SET status = 'RESOLVED', updated_at = now()
             WHERE id = $1 AND organization_id = $2`,
            [disc.reconciliation_id, identity.orgId]
          );
        }

        await audit(db, 'PAYROLL_DISCREPANCY_RESOLVED', identity.userId, identity.orgId, undefined, {
          discrepancyId: discId,
          type: disc.type,
          resolutionStatus: data.resolutionStatus,
        });
      });

      return res.status(200).json({ ok: true, discrepancyId: discId, resolutionStatus: data.resolutionStatus });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================
  // 6. Payroll Liabilities (Quản lý công nợ lương)
  // ============================================================

  // Get Liabilities for Period
  app.get(`${prefix}/periods/:id/liabilities`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);

      const liabRes = await pool.query(
        `SELECT l.id, l.period_id AS "periodId", p.code AS "periodCode", p.name AS "periodName",
                l.beginning_balance AS "beginningBalance", l.incurred_amount AS "incurredAmount",
                l.paid_amount AS "paidAmount", l.ending_balance AS "endingBalance",
                l.status, l.last_reconciled_at AS "lastReconciledAt", l.updated_at AS "updatedAt"
         FROM payroll_liabilities l
         JOIN payroll_periods p ON p.id = l.period_id AND p.organization_id = l.organization_id
         WHERE l.period_id = $1 AND l.organization_id = $2`,
        [periodId, identity.orgId]
      );

      if (!liabRes.rowCount) {
        // Return computed real-time snapshot even if not yet saved to liabilities table
        const periodRes = await pool.query(`SELECT id, code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`, [periodId, identity.orgId]);
        if (!periodRes.rowCount) fail(404, 'PAYROLL_PERIOD_NOT_FOUND');

        const slipSum = await pool.query(
          `SELECT COALESCE(SUM(net_pay), 0.00) AS "incurredAmount" FROM payroll_slips WHERE period_id = $1 AND organization_id = $2`,
          [periodId, identity.orgId]
        );
        const disbSum = await pool.query(
          `SELECT COALESCE(SUM(amount), 0.00) AS "paidAmount" FROM payroll_disbursements WHERE period_id = $1 AND organization_id = $2 AND status = 'COMPLETED'`,
          [periodId, identity.orgId]
        );
        const incurred = slipSum.rows[0].incurredAmount;
        const paid = disbSum.rows[0].paidAmount;
        const diff = fromCents(toCents(incurred) - toCents(paid));
        const status = toCents(diff) === 0n ? 'SETTLED' : toCents(paid) > 0n ? 'PARTIALLY_SETTLED' : 'OPEN';

        return res.status(200).json({
          liability: {
            id: null,
            periodId,
            periodCode: periodRes.rows[0].code,
            periodName: periodRes.rows[0].name,
            beginningBalance: '0.00',
            incurredAmount: incurred,
            paidAmount: paid,
            endingBalance: diff,
            status,
            lastReconciledAt: null,
          },
        });
      }

      return res.status(200).json({ liability: liabRes.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  // Get Liabilities Ledger / Summary across all periods
  app.get(`${prefix}/liabilities/summary`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);

      const rows = await pool.query(
        `SELECT l.id, l.period_id AS "periodId", p.code AS "periodCode", p.name AS "periodName",
                p.start_date AS "startDate", p.end_date AS "endDate",
                l.beginning_balance AS "beginningBalance", l.incurred_amount AS "incurredAmount",
                l.paid_amount AS "paidAmount", l.ending_balance AS "endingBalance",
                l.status, l.last_reconciled_at AS "lastReconciledAt"
         FROM payroll_liabilities l
         JOIN payroll_periods p ON p.id = l.period_id AND p.organization_id = l.organization_id
         WHERE l.organization_id = $1
         ORDER BY p.start_date DESC`,
        [identity.orgId]
      );

      let totalIncurredCents = 0n;
      let totalPaidCents = 0n;
      let totalOutstandingCents = 0n;

      for (const r of rows.rows) {
        totalIncurredCents += toCents(r.incurredAmount);
        totalPaidCents += toCents(r.paidAmount);
        totalOutstandingCents += toCents(r.endingBalance);
      }

      return res.status(200).json({
        items: rows.rows,
        totals: {
          totalIncurred: fromCents(totalIncurredCents),
          totalPaid: fromCents(totalPaidCents),
          totalOutstanding: fromCents(totalOutstandingCents),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================
  // 7. Accounting Export (Xuất dữ liệu kế toán CSV)
  // ============================================================

  // Export Journal Entries, Reconciliation, Liabilities, Disbursements
  app.get(`${prefix}/periods/:id/accounting/export`, async (req: Authed, res, next) => {
    try {
      const identity = requireIdentity(req);
      assertAccountingAccess(identity.role);
      const periodId = uuidSchema.parse(req.params.id);
      const exportType = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'journal';
      const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'csv';

      const periodRes = await pool.query(`SELECT id, code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`, [periodId, identity.orgId]);
      if (!periodRes.rowCount) fail(404, 'PAYROLL_PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      if (exportType === 'journal') {
        const rows = await pool.query(
          `SELECT e.entry_number AS "entryNumber", e.entry_date AS "entryDate", e.description AS "entryDesc",
                  da.code AS "debitAccount", ca.code AS "creditAccount",
                  l.debit_amount AS "debitAmount", l.credit_amount AS "creditAmount",
                  l.description AS "lineDesc", d.name AS "departmentName", e.status
           FROM payroll_journal_entries e
           JOIN payroll_journal_entry_lines l ON l.entry_id = e.id AND l.organization_id = e.organization_id
           JOIN accounting_accounts da ON da.id = l.account_id AND da.organization_id = l.organization_id AND l.debit_amount > 0
           LEFT JOIN accounting_accounts ca ON ca.id = l.account_id AND ca.organization_id = l.organization_id AND l.credit_amount > 0
           LEFT JOIN departments d ON d.id = l.department_id AND d.organization_id = l.organization_id
           WHERE e.period_id = $1 AND e.organization_id = $2
           ORDER BY e.entry_number, l.line_order`,
          [periodId, identity.orgId]
        );

        // Fetch all lines directly
        const allLines = await pool.query(
          `SELECT e.entry_number AS "entryNumber", e.entry_date AS "entryDate", e.description AS "entryDesc",
                  a.code AS "accountCode", a.name AS "accountName",
                  l.debit_amount AS "debitAmount", l.credit_amount AS "creditAmount",
                  l.description AS "lineDesc", d.name AS "departmentName", e.status
           FROM payroll_journal_entries e
           JOIN payroll_journal_entry_lines l ON l.entry_id = e.id AND l.organization_id = e.organization_id
           JOIN accounting_accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
           LEFT JOIN departments d ON d.id = l.department_id AND d.organization_id = l.organization_id
           WHERE e.period_id = $1 AND e.organization_id = $2
           ORDER BY e.entry_number, l.line_order`,
          [periodId, identity.orgId]
        );

        if (format === 'json') {
          return res.status(200).json({ items: allLines.rows });
        }

        const headers = ['Số chứng từ', 'Ngày hạch toán', 'Diễn giải chứng từ', 'Mã tài khoản', 'Tên tài khoản', 'Số tiền Nợ', 'Số tiền Có', 'Diễn giải dòng', 'Phòng ban', 'Trạng thái'];
        const csvRows = [headers.map(escapeCsvField).join(',')];

        for (const r of allLines.rows) {
          csvRows.push([
            escapeCsvField(r.entryNumber),
            escapeCsvField(r.entryDate),
            escapeCsvField(r.entryDesc),
            escapeCsvField(r.accountCode),
            escapeCsvField(r.accountName),
            escapeCsvField(r.debitAmount),
            escapeCsvField(r.creditAmount),
            escapeCsvField(r.lineDesc),
            escapeCsvField(r.departmentName || ''),
            escapeCsvField(r.status),
          ].join(','));
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="journal_${period.code}.csv"`);
        return res.status(200).send('\uFEFF' + csvRows.join('\r\n'));
      } else if (exportType === 'reconciliation') {
        const rows = await pool.query(
          `SELECT e.employee_code AS "employeeCode", u.full_name AS "employeeName",
                  d.name AS "departmentName", s.net_pay AS "netPay",
                  COALESCE(SUM(disb.amount), 0.00) AS "disbursedAmount",
                  disc.type AS "discrepancyType", disc.resolution_status AS "resolutionStatus",
                  disc.resolution_notes AS "resolutionNotes"
           FROM payroll_slips s
           JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
           LEFT JOIN users u ON u.id = e.user_id
           LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
           LEFT JOIN payroll_disbursements disb ON disb.slip_id = s.id AND disb.status = 'COMPLETED' AND disb.organization_id = s.organization_id
           LEFT JOIN payroll_reconciliations r ON r.period_id = s.period_id AND r.organization_id = s.organization_id
           LEFT JOIN payroll_reconciliation_discrepancies disc ON disc.reconciliation_id = r.id AND disc.employee_id = s.employee_id
           WHERE s.period_id = $1 AND s.organization_id = $2
           GROUP BY e.employee_code, u.full_name, d.name, s.net_pay, disc.type, disc.resolution_status, disc.resolution_notes
           ORDER BY e.employee_code`,
          [periodId, identity.orgId]
        );

        if (format === 'json') {
          return res.status(200).json({ items: rows.rows });
        }

        const headers = ['Mã nhân viên', 'Họ tên', 'Phòng ban', 'Lương thực lĩnh', 'Đã chi trả', 'Sai lệch', 'Trạng thái xử lý', 'Ghi chú'];
        const csvRows = [headers.map(escapeCsvField).join(',')];

        for (const r of rows.rows) {
          csvRows.push([
            escapeCsvField(r.employeeCode),
            escapeCsvField(r.employeeName || ''),
            escapeCsvField(r.departmentName || ''),
            escapeCsvField(r.netPay),
            escapeCsvField(r.disbursedAmount),
            escapeCsvField(r.discrepancyType || 'KHỚP'),
            escapeCsvField(r.resolutionStatus || ''),
            escapeCsvField(r.resolutionNotes || ''),
          ].join(','));
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="reconciliation_${period.code}.csv"`);
        return res.status(200).send('\uFEFF' + csvRows.join('\r\n'));
      } else if (exportType === 'disbursements') {
        const rows = await pool.query(
          `SELECT d.disbursement_code AS "disbursementCode", e.employee_code AS "employeeCode",
                  u.full_name AS "employeeName", d.bank_name AS "bankName",
                  d.bank_account_number AS "bankAccountNumber", d.amount,
                  d.payment_date AS "paymentDate", d.payment_method AS "paymentMethod",
                  d.reference_code AS "referenceCode", d.status, d.notes
           FROM payroll_disbursements d
           JOIN employees e ON e.id = d.employee_id AND e.organization_id = d.organization_id
           LEFT JOIN users u ON u.id = e.user_id
           WHERE d.period_id = $1 AND d.organization_id = $2
           ORDER BY d.payment_date, d.disbursement_code`,
          [periodId, identity.orgId]
        );

        if (format === 'json') {
          return res.status(200).json({ items: rows.rows });
        }

        const headers = ['Mã giao dịch', 'Mã nhân viên', 'Họ tên', 'Ngân hàng', 'Số tài khoản', 'Số tiền', 'Ngày chi trả', 'Phương thức', 'Mã tham chiếu', 'Trạng thái', 'Ghi chú'];
        const csvRows = [headers.map(escapeCsvField).join(',')];

        for (const r of rows.rows) {
          csvRows.push([
            escapeCsvField(r.disbursementCode),
            escapeCsvField(r.employeeCode),
            escapeCsvField(r.employeeName || ''),
            escapeCsvField(r.bankName || ''),
            escapeCsvField(r.bankAccountNumber || ''),
            escapeCsvField(r.amount),
            escapeCsvField(r.paymentDate),
            escapeCsvField(r.paymentMethod),
            escapeCsvField(r.referenceCode || ''),
            escapeCsvField(r.status),
            escapeCsvField(r.notes || ''),
          ].join(','));
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="disbursements_${period.code}.csv"`);
        return res.status(200).send('\uFEFF' + csvRows.join('\r\n'));
      } else {
        fail(400, 'INVALID_EXPORT_TYPE');
      }
    } catch (err) {
      next(err);
    }
  });
}
