import type { Express, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, type Authed, type Identity } from './types.js';
import { authorizeMutation } from './authorization.js';
import type { OrgStructureDeps } from './organization-structure.js';

const uuid = z.string().uuid();

// Helpers for exact integer-cents arithmetic
function toCents(amount: string | number | null | undefined): bigint {
  if (amount == null) return 0n;
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).trim());
  if (isNaN(num)) return 0n;
  return BigInt(Math.round(num * 100));
}

function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const dollars = abs / 100n;
  const rem = abs % 100n;
  return `${sign}${dollars}.${rem.toString().padStart(2, '0')}`;
}

const ruleTypeEnum = z.enum([
  'PIT_DEDUCTIONS',
  'PIT_BRACKETS',
  'SI_RATES',
  'BASE_SALARY_STATUTORY',
  'REGIONAL_MIN_WAGE',
]);

const reportTypeEnum = z.enum([
  'PIT_MONTHLY',
  'PIT_QUARTERLY',
  'PIT_ANNUAL',
  'SI_MONTHLY',
  'SI_FLUCTUATION',
  'HR_COST_ANALYTICS',
]);

const ruleCreateSchema = z.object({
  ruleType: ruleTypeEnum,
  ruleCode: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  parameters: z.record(z.string(), z.any()),
  legalReference: z.string().trim().min(1).max(255),
  isVerified: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

const dependentCreateSchema = z.object({
  employeeId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(255),
  relationship: z.enum(['CHILD', 'SPOUSE', 'PARENT', 'OTHER']),
  taxId: z.string().trim().max(50).nullable().optional(),
  idNumber: z.string().trim().max(50).nullable().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isVerified: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

// Standard Vietnamese statutory parameters
export const DEFAULT_STATUTORY_RULES = [
  {
    ruleType: 'PIT_DEDUCTIONS',
    ruleCode: 'PIT_DEDUCTIONS_2020',
    name: 'Mức giảm trừ gia cảnh thuế TNCN',
    effectiveFrom: '2020-07-01',
    effectiveTo: null,
    parameters: {
      personal: 11000000.00,
      dependent: 4400000.00,
    },
    legalReference: 'Nghị quyết 954/2020/UBTVQH14',
    isVerified: true,
    notes: 'Giảm trừ bản thân 11M/tháng, người phụ thuộc 4.4M/tháng',
  },
  {
    ruleType: 'PIT_BRACKETS',
    ruleCode: 'PIT_BRACKETS_PROGRESSIVE',
    name: 'Biểu thuế lũy tiến từng phần thuế TNCN',
    effectiveFrom: '2009-01-01',
    effectiveTo: null,
    parameters: {
      brackets: [
        { upTo: 5000000.00, rate: 0.05, quickDeduction: 0.00 },
        { upTo: 10000000.00, rate: 0.10, quickDeduction: 250000.00 },
        { upTo: 18000000.00, rate: 0.15, quickDeduction: 750000.00 },
        { upTo: 32000000.00, rate: 0.20, quickDeduction: 1650000.00 },
        { upTo: 52000000.00, rate: 0.25, quickDeduction: 3250000.00 },
        { upTo: 80000000.00, rate: 0.30, quickDeduction: 5850000.00 },
        { upTo: null, rate: 0.35, quickDeduction: 9850000.00 },
      ],
    },
    legalReference: 'Điều 22 Luật Thuế TNCN số 04/2007/QH12 & Thông tư 111/2013/TT-BTC',
    isVerified: true,
    notes: '7 bậc thuế lũy tiến từ 5% đến 35%',
  },
  {
    ruleType: 'SI_RATES',
    ruleCode: 'SI_RATES_VN_CURRENT',
    name: 'Tỷ lệ đóng BHXH, BHYT, BHTN và KPCĐ',
    effectiveFrom: '2022-07-01',
    effectiveTo: null,
    parameters: {
      employee: {
        bhxh: 0.08,
        bhyt: 0.015,
        bhtn: 0.01,
      },
      employer: {
        bhxh: 0.175,
        bhyt: 0.03,
        bhtn: 0.01,
        tradeUnion: 0.02,
      },
    },
    legalReference: 'Luật BHXH 2014, Luật BHYT 2014, Luật Việc làm 2013, Nghị định 191/2013/NĐ-CP',
    isVerified: true,
    notes: 'NLĐ đóng 10.5%, DN đóng 21.5% bảo hiểm + 2% kinh phí công đoàn',
  },
  {
    ruleType: 'BASE_SALARY_STATUTORY',
    ruleCode: 'BASE_SALARY_ND73_2024',
    name: 'Mức lương cơ sở và trần đóng BHXH/BHYT',
    effectiveFrom: '2024-07-01',
    effectiveTo: null,
    parameters: {
      baseSalary: 2340000.00,
      capMultiplier: 20,
      capAmount: 46800000.00,
    },
    legalReference: 'Nghị định 73/2024/NĐ-CP',
    isVerified: true,
    notes: 'Lương cơ sở 2.340.000 VND; trần đóng BHXH/BHYT tối đa 20 lần = 46.800.000 VND',
  },
  {
    ruleType: 'REGIONAL_MIN_WAGE',
    ruleCode: 'REGIONAL_MIN_WAGE_ND74_2024',
    name: 'Mức lương tối thiểu vùng và trần BHTN',
    effectiveFrom: '2024-07-01',
    effectiveTo: null,
    parameters: {
      zones: {
        zone1: 4960000.00,
        zone2: 4410000.00,
        zone3: 3860000.00,
        zone4: 3450000.00,
      },
      capMultiplier: 20,
      zone1Cap: 99200000.00,
    },
    legalReference: 'Nghị định 74/2024/NĐ-CP',
    isVerified: true,
    notes: 'Lương tối thiểu Vùng I: 4.960.000 VND; trần đóng BHTN tối đa 20 lần = 99.200.000 VND',
  },
];

export interface PitBracket {
  upTo: number | null;
  rate: number;
  quickDeduction: number;
}

export interface SiRatesConfig {
  employee: {
    bhxh: number;
    bhyt: number;
    bhtn: number;
  };
  employer: {
    bhxh: number;
    bhyt: number;
    bhtn: number;
    tradeUnion: number;
  };
}

// Progressive tax calculation helper using verified brackets
export function calculatePitTax(assessableCents: bigint, brackets: PitBracket[]): bigint {
  if (assessableCents <= 0n) return 0n;
  const assessable = Number(assessableCents) / 100;
  for (const b of brackets) {
    if (b.upTo === null || assessable <= b.upTo) {
      const tax = assessable * b.rate - b.quickDeduction;
      return toCents(Math.max(0, tax));
    }
  }
  return 0n;
}

export function registerPayrollComplianceRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const prefix = '/api/organizations/:organizationId/payroll/compliance';

  function identityFor(req: Authed): Identity {
    const identity = requireIdentity(req);
    uuid.parse(req.params.organizationId);
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  function assertComplianceAccess(role: string) {
    if (!['ADMIN', 'HR'].includes(role)) {
      fail(403, 'FORBIDDEN');
    }
  }

  // =========================================================================
  // 1. STATUTORY COMPLIANCE RULES
  // =========================================================================

  // Seed default Vietnamese statutory rules
  app.post(`${prefix}/rules/seed-defaults`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);

      const result = await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        let seededCount = 0;
        for (const rule of DEFAULT_STATUTORY_RULES) {
          const existing = await db.query(
            `SELECT id FROM compliance_statutory_rules
             WHERE organization_id = $1 AND rule_code = $2 AND effective_from = $3::date`,
            [identity.orgId, rule.ruleCode, rule.effectiveFrom]
          );
          if (existing.rowCount === 0) {
            const ruleId = randomUUID();
            await db.query(
              `INSERT INTO compliance_statutory_rules (
                 id, organization_id, rule_type, rule_code, name, effective_from, effective_to,
                 parameters, legal_reference, is_verified, notes
               ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11)`,
              [
                ruleId, identity.orgId, rule.ruleType, rule.ruleCode, rule.name,
                rule.effectiveFrom, rule.effectiveTo, JSON.stringify(rule.parameters),
                rule.legalReference, rule.isVerified, rule.notes,
              ]
            );
            seededCount++;
          }
        }

        // Log audit
        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'SEED_DEFAULT_RULES', 'STATUTORY_RULE', $3, $4, $5)`,
          [randomUUID(), identity.orgId, identity.orgId, identity.userId, JSON.stringify({ seededCount })]
        );

        return { seededCount };
      });

      res.status(201).json({ success: true, seededCount: result.seededCount });
    } catch (err) {
      next(err);
    }
  });

  // List statutory rules
  app.get(`${prefix}/rules`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const ruleType = req.query.ruleType ? String(req.query.ruleType) : null;
      const activeDate = req.query.activeDate ? String(req.query.activeDate) : null;

      let query = `
        SELECT id, rule_type AS "ruleType", rule_code AS "ruleCode", name,
               effective_from::text AS "effectiveFrom",
               effective_to::text AS "effectiveTo",
               parameters, legal_reference AS "legalReference",
               is_verified AS "isVerified", notes, created_at AS "createdAt"
        FROM compliance_statutory_rules
        WHERE organization_id = $1
      `;
      const params: any[] = [identity.orgId];

      if (ruleType) {
        params.push(ruleType);
        query += ` AND rule_type = $${params.length}`;
      }
      if (activeDate) {
        params.push(activeDate);
        query += ` AND effective_from <= $${params.length}::date AND (effective_to IS NULL OR effective_to >= $${params.length}::date)`;
      }

      query += ` ORDER BY rule_type, effective_from DESC`;
      const rules = await pool.query(query, params);
      res.json({ rules: rules.rows });
    } catch (err) {
      next(err);
    }
  });

  // Create statutory rule
  app.post(`${prefix}/rules`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const data = ruleCreateSchema.parse(req.body);

      const rule = await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        const id = randomUUID();
        await db.query(
          `INSERT INTO compliance_statutory_rules (
             id, organization_id, rule_type, rule_code, name, effective_from, effective_to,
             parameters, legal_reference, is_verified, notes
           ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11)`,
          [
            id, identity.orgId, data.ruleType, data.ruleCode, data.name,
            data.effectiveFrom, data.effectiveTo || null, JSON.stringify(data.parameters),
            data.legalReference, data.isVerified, data.notes || null,
          ]
        );

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'CREATE_RULE', 'STATUTORY_RULE', $3, $4, $5)`,
          [randomUUID(), identity.orgId, id, identity.userId, JSON.stringify({ ruleCode: data.ruleCode })]
        );

        return { id, ...data };
      });

      res.status(201).json({ success: true, rule });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 2. EMPLOYEE REGISTERED DEPENDENTS
  // =========================================================================

  // List dependents
  app.get(`${prefix}/dependents`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const employeeId = req.query.employeeId ? String(req.query.employeeId) : null;

      let query = `
        SELECT d.id, d.employee_id AS "employeeId", e.employee_code AS "employeeCode", e.full_name AS "employeeName",
               d.full_name AS "fullName", d.relationship, d.tax_id AS "taxId", d.id_number AS "idNumber",
               d.birth_date::text AS "birthDate", d.effective_from::text AS "effectiveFrom",
               d.effective_to::text AS "effectiveTo", d.is_verified AS "isVerified", d.notes,
               d.created_at AS "createdAt"
        FROM employee_dependents d
        JOIN employees e ON e.id = d.employee_id AND e.organization_id = d.organization_id
        WHERE d.organization_id = $1
      `;
      const params: any[] = [identity.orgId];

      // Employee can only access their own dependents
      if (identity.role === 'EMPLOYEE') {
        const empRes = await pool.query(
          `SELECT id FROM employees WHERE organization_id = $1 AND user_id = $2`,
          [identity.orgId, identity.userId]
        );
        if (!empRes.rowCount) return res.json({ dependents: [] });
        params.push(empRes.rows[0].id);
        query += ` AND d.employee_id = $${params.length}`;
      } else if (employeeId) {
        params.push(employeeId);
        query += ` AND d.employee_id = $${params.length}`;
      }

      query += ` ORDER BY d.created_at DESC`;
      const depsRes = await pool.query(query, params);
      res.json({ dependents: depsRes.rows });
    } catch (err) {
      next(err);
    }
  });

  // Create dependent
  app.post(`${prefix}/dependents`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const data = dependentCreateSchema.parse(req.body);

      const dependent = await transaction(async db => {
        // If employee, can only add dependent for self
        if (identity.role === 'EMPLOYEE') {
          const empRes = await db.query(
            `SELECT id FROM employees WHERE organization_id = $1 AND user_id = $2`,
            [identity.orgId, identity.userId]
          );
          if (!empRes.rowCount || empRes.rows[0].id !== data.employeeId) {
            fail(403, 'FORBIDDEN');
          }
          data.isVerified = false; // Employee cannot auto-verify own dependent
        } else {
          await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);
        }

        const id = randomUUID();
        await db.query(
          `INSERT INTO employee_dependents (
             id, organization_id, employee_id, full_name, relationship, tax_id, id_number,
             birth_date, effective_from, effective_to, is_verified, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12)`,
          [
            id, identity.orgId, data.employeeId, data.fullName, data.relationship,
            data.taxId || null, data.idNumber || null, data.birthDate || null,
            data.effectiveFrom, data.effectiveTo || null, data.isVerified, data.notes || null,
          ]
        );

        return { id, ...data };
      });

      res.status(201).json({ success: true, dependent });
    } catch (err) {
      next(err);
    }
  });

  // Verify dependent (HR/Admin only)
  app.patch(`${prefix}/dependents/:id/verify`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const dependentId = z.string().uuid().parse(req.params.id);
      const isVerified = z.boolean().parse(req.body.isVerified ?? true);

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        const upd = await db.query(
          `UPDATE employee_dependents SET is_verified = $1, updated_at = now()
           WHERE id = $2 AND organization_id = $3 RETURNING id`,
          [isVerified, dependentId, identity.orgId]
        );
        if (!upd.rowCount) fail(404, 'NOT_FOUND');

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'VERIFY_DEPENDENT', 'DEPENDENT', $3, $4, $5)`,
          [randomUUID(), identity.orgId, dependentId, identity.userId, JSON.stringify({ isVerified })]
        );
      });

      res.json({ success: true, dependentId, isVerified });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 3. PERSONAL INCOME TAX (PIT) REPORTING
  // =========================================================================

  app.get(`${prefix}/pit/period/:periodId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const periodId = z.string().uuid().parse(req.params.periodId);

      // Fetch period
      const periodRes = await pool.query(
        `SELECT id, code, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      // Fetch active statutory PIT rules for this period
      const rulesRes = await pool.query<{ rule_type: string; parameters: any }>(
        `SELECT rule_type, parameters FROM compliance_statutory_rules
         WHERE organization_id = $1 AND rule_type IN ('PIT_DEDUCTIONS', 'PIT_BRACKETS', 'SI_RATES')
           AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
         ORDER BY effective_from DESC`,
        [identity.orgId, period.start_date]
      );

      let personalDeduction = 11000000.00;
      let dependentDeductionUnit = 4400000.00;
      let brackets: PitBracket[] = (DEFAULT_STATUTORY_RULES.find(r => r.ruleType === 'PIT_BRACKETS')!.parameters as any).brackets;

      for (const r of rulesRes.rows) {
        if (r.rule_type === 'PIT_DEDUCTIONS') {
          personalDeduction = Number(r.parameters.personal) || personalDeduction;
          dependentDeductionUnit = Number(r.parameters.dependent) || dependentDeductionUnit;
        } else if (r.rule_type === 'PIT_BRACKETS' && Array.isArray(r.parameters.brackets)) {
          brackets = r.parameters.brackets as PitBracket[];
        }
      }

      // Fetch slips and slip items for this period
      const slipsRes = await pool.query<{
        id: string; employee_id: string; employee_code: string; full_name: string; department_name: string;
        gross_pay: string; net_pay: string; total_deductions: string;
      }>(
        `SELECT s.id, s.employee_id, e.employee_code, e.full_name, COALESCE(d.name, 'Chưa gán') AS department_name,
                s.gross_pay::text, s.net_pay::text, s.total_deductions::text
         FROM payroll_slips s
         JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
         LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
         WHERE s.period_id = $1 AND s.organization_id = $2
         ORDER BY e.employee_code`,
        [periodId, identity.orgId]
      );

      // Fetch verified dependents active during the period
      const depsRes = await pool.query<{ employee_id: string; cnt: number }>(
        `SELECT employee_id, count(*)::integer AS cnt
         FROM employee_dependents
         WHERE organization_id = $1 AND is_verified = true
           AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $2::date)
         GROUP BY employee_id`,
        [identity.orgId, period.start_date, period.end_date]
      );
      const dependentCountMap = new Map<string, number>();
      for (const d of depsRes.rows) dependentCountMap.set(d.employee_id, d.cnt);

      // Fetch slip items to identify non-taxable allowances, statutory insurance, and taxes withheld
      const itemsRes = await pool.query<{
        slip_id: string; component_name: string; type: string; amount: string;
      }>(
        `SELECT i.slip_id, i.component_name, i.type, i.amount::text
         FROM payroll_slip_items i
         JOIN payroll_slips s ON s.id = i.slip_id AND s.organization_id = i.organization_id
         WHERE s.period_id = $1 AND s.organization_id = $2`,
        [periodId, identity.orgId]
      );

      const slipItemsMap = new Map<string, Array<{ component_name: string; type: string; amount: string }>>();
      for (const item of itemsRes.rows) {
        const arr = slipItemsMap.get(item.slip_id) || [];
        arr.push(item);
        slipItemsMap.set(item.slip_id, arr);
      }

      const personalDeductionCents = toCents(personalDeduction);
      const dependentUnitCents = toCents(dependentDeductionUnit);

      let totalGrossCents = 0n;
      let totalTaxableCents = 0n;
      let totalPersonalDeductionCents = 0n;
      let totalDependentDeductionCents = 0n;
      let totalInsuranceDeductionCents = 0n;
      let totalAssessableCents = 0n;
      let totalCalculatedTaxCents = 0n;
      let totalWithheldTaxCents = 0n;

      const employeeBreakdown = [];

      for (const slip of slipsRes.rows) {
        const grossCents = toCents(slip.gross_pay);
        totalGrossCents += grossCents;

        const items = slipItemsMap.get(slip.id) || [];
        let insuranceCents = 0n;
        let withheldTaxCents = 0n;
        let nonTaxableCents = 0n;

        for (const it of items) {
          const itemCents = toCents(it.amount);
          const nameLower = it.component_name.toLowerCase();
          if (/bhxh|bhyt|bhtn|bảo hiểm|statutory/i.test(nameLower) && it.type === 'DEDUCTION') {
            insuranceCents += itemCents;
          } else if (/thuế|tax|tncn/i.test(nameLower) && it.type === 'DEDUCTION') {
            withheldTaxCents += itemCents;
          } else if (/ăn trưa|xăng xe|đồng phục|trang phục|công tác phí|điện thoại/i.test(nameLower) && it.type === 'ALLOWANCE') {
            nonTaxableCents += itemCents;
          }
        }

        const depCount = dependentCountMap.get(slip.employee_id) || 0;
        const depDeductionCents = BigInt(depCount) * dependentUnitCents;

        const taxableCents = grossCents > nonTaxableCents ? grossCents - nonTaxableCents : 0n;
        const totalDeductionForTaxCents = personalDeductionCents + depDeductionCents + insuranceCents;
        const assessableCents = taxableCents > totalDeductionForTaxCents ? taxableCents - totalDeductionForTaxCents : 0n;

        const calculatedTaxCents = calculatePitTax(assessableCents, brackets);
        const varianceCents = calculatedTaxCents - withheldTaxCents;

        totalTaxableCents += taxableCents;
        totalPersonalDeductionCents += personalDeductionCents;
        totalDependentDeductionCents += depDeductionCents;
        totalInsuranceDeductionCents += insuranceCents;
        totalAssessableCents += assessableCents;
        totalCalculatedTaxCents += calculatedTaxCents;
        totalWithheldTaxCents += withheldTaxCents;

        employeeBreakdown.push({
          employeeId: slip.employee_id,
          employeeCode: slip.employee_code,
          fullName: slip.full_name,
          departmentName: slip.department_name,
          grossPay: fromCents(grossCents),
          nonTaxableIncome: fromCents(nonTaxableCents),
          taxableIncome: fromCents(taxableCents),
          personalDeduction: fromCents(personalDeductionCents),
          dependentCount: depCount,
          dependentDeduction: fromCents(depDeductionCents),
          insuranceDeduction: fromCents(insuranceCents),
          assessableIncome: fromCents(assessableCents),
          calculatedTax: fromCents(calculatedTaxCents),
          withheldTax: fromCents(withheldTaxCents),
          variance: fromCents(varianceCents),
        });
      }

      res.json({
        period,
        verificationStatus: 'NOT_VERIFIED',
        summary: {
          totalEmployees: slipsRes.rows.length,
          totalGrossPay: fromCents(totalGrossCents),
          totalTaxableIncome: fromCents(totalTaxableCents),
          totalPersonalDeduction: fromCents(totalPersonalDeductionCents),
          totalDependentDeduction: fromCents(totalDependentDeductionCents),
          totalInsuranceDeduction: fromCents(totalInsuranceDeductionCents),
          totalAssessableIncome: fromCents(totalAssessableCents),
          totalCalculatedTax: fromCents(totalCalculatedTaxCents),
          totalWithheldTax: fromCents(totalWithheldTaxCents),
          totalVariance: fromCents(totalCalculatedTaxCents - totalWithheldTaxCents),
        },
        employees: employeeBreakdown,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 4. SOCIAL INSURANCE REPORTING (BHXH / BHYT / BHTN / KPCĐ)
  // =========================================================================

  app.get(`${prefix}/insurance/period/:periodId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const periodId = z.string().uuid().parse(req.params.periodId);

      const periodRes = await pool.query(
        `SELECT id, code, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      // Fetch active statutory SI rules
      const rulesRes = await pool.query<{ rule_type: string; parameters: any }>(
        `SELECT rule_type, parameters FROM compliance_statutory_rules
         WHERE organization_id = $1 AND rule_type IN ('SI_RATES', 'BASE_SALARY_STATUTORY', 'REGIONAL_MIN_WAGE')
           AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
         ORDER BY effective_from DESC`,
        [identity.orgId, period.start_date]
      );

      let siRates: SiRatesConfig = (DEFAULT_STATUTORY_RULES.find(r => r.ruleCode === 'SI_RATES_VN_CURRENT')!.parameters as any);
      let baseSalaryCap = 46800000.00; // 20x 2.34M
      let uiCap = 99200000.00; // 20x 4.96M (Zone 1)

      for (const r of rulesRes.rows) {
        if (r.rule_type === 'SI_RATES') siRates = r.parameters as SiRatesConfig;
        if (r.rule_type === 'BASE_SALARY_STATUTORY' && r.parameters.capAmount) {
          baseSalaryCap = Number(r.parameters.capAmount);
        }
        if (r.rule_type === 'REGIONAL_MIN_WAGE' && r.parameters.zone1Cap) {
          uiCap = Number(r.parameters.zone1Cap);
        }
      }

      // Fetch employee social insurance profiles active during period
      const profilesRes = await pool.query<{
        employee_id: string; employee_code: string; full_name: string; department_name: string;
        si_code: string; hi_code: string | null; si_salary: string; status: string;
      }>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name, COALESCE(d.name, 'Chưa gán') AS department_name,
                si.si_code, si.hi_code, si.si_salary::text, si.status
         FROM employees e
         JOIN employee_social_insurance si ON si.employee_id = e.id AND si.organization_id = e.organization_id
         LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
         WHERE e.organization_id = $1 AND si.status = 'ACTIVE'
           AND si.enrollment_date <= $3::date AND (si.termination_date IS NULL OR si.termination_date >= $2::date)
         ORDER BY e.employee_code`,
        [identity.orgId, period.start_date, period.end_date]
      );

      const baseSalaryCapCents = toCents(baseSalaryCap);
      const uiCapCents = toCents(uiCap);

      let totalSiFundCents = 0n;
      let totalEmployeeSiCents = 0n;
      let totalEmployerSiCents = 0n;
      let totalTradeUnionCents = 0n;

      const employeeBreakdown = [];

      for (const p of profilesRes.rows) {
        const rawSalaryCents = toCents(p.si_salary);
        const cappedSiCents = rawSalaryCents > baseSalaryCapCents ? baseSalaryCapCents : rawSalaryCents;
        const cappedUiCents = rawSalaryCents > uiCapCents ? uiCapCents : rawSalaryCents;

        // Employee portions: BHXH 8%, BHYT 1.5%, BHTN 1%
        const empBhxhCents = toCents((Number(cappedSiCents) / 100) * siRates.employee.bhxh);
        const empBhytCents = toCents((Number(cappedSiCents) / 100) * siRates.employee.bhyt);
        const empBhtnCents = toCents((Number(cappedUiCents) / 100) * siRates.employee.bhtn);
        const empTotalCents = empBhxhCents + empBhytCents + empBhtnCents;

        // Employer portions: BHXH 17.5%, BHYT 3%, BHTN 1%, Trade Union 2%
        const empyrBhxhCents = toCents((Number(cappedSiCents) / 100) * siRates.employer.bhxh);
        const empyrBhytCents = toCents((Number(cappedSiCents) / 100) * siRates.employer.bhyt);
        const empyrBhtnCents = toCents((Number(cappedUiCents) / 100) * siRates.employer.bhtn);
        const unionCents = toCents((Number(cappedSiCents) / 100) * siRates.employer.tradeUnion);
        const empyrTotalCents = empyrBhxhCents + empyrBhytCents + empyrBhtnCents;

        totalSiFundCents += rawSalaryCents;
        totalEmployeeSiCents += empTotalCents;
        totalEmployerSiCents += empyrTotalCents;
        totalTradeUnionCents += unionCents;

        employeeBreakdown.push({
          employeeId: p.employee_id,
          employeeCode: p.employee_code,
          fullName: p.full_name,
          departmentName: p.department_name,
          siCode: p.si_code,
          hiCode: p.hi_code,
          contractSiSalary: fromCents(rawSalaryCents),
          cappedBhxhSalary: fromCents(cappedSiCents),
          cappedBhtnSalary: fromCents(cappedUiCents),
          employeePortion: {
            bhxh: fromCents(empBhxhCents),
            bhyt: fromCents(empBhytCents),
            bhtn: fromCents(empBhtnCents),
            total: fromCents(empTotalCents),
          },
          employerPortion: {
            bhxh: fromCents(empyrBhxhCents),
            bhyt: fromCents(empyrBhytCents),
            bhtn: fromCents(empyrBhtnCents),
            tradeUnion: fromCents(unionCents),
            total: fromCents(empyrTotalCents + unionCents),
          },
          totalPayable: fromCents(empTotalCents + empyrTotalCents + unionCents),
        });
      }

      res.json({
        period,
        verificationStatus: 'NOT_VERIFIED',
        summary: {
          totalParticipants: profilesRes.rows.length,
          totalSiSalaryFund: fromCents(totalSiFundCents),
          totalEmployeePortion: fromCents(totalEmployeeSiCents),
          totalEmployerPortion: fromCents(totalEmployerSiCents),
          totalTradeUnion: fromCents(totalTradeUnionCents),
          totalPayableInsuranceAgency: fromCents(totalEmployeeSiCents + totalEmployerSiCents),
          totalCostToCompany: fromCents(totalEmployerSiCents + totalTradeUnionCents),
        },
        rates: siRates,
        employees: employeeBreakdown,
      });
    } catch (err) {
      next(err);
    }
  });

  // Track insurance fluctuations (Form D02-LT)
  app.get(`${prefix}/insurance/fluctuations`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const month = String(req.query.month || new Date().toISOString().slice(0, 7)); // YYYY-MM
      const startDate = `${month}-01`;

      // New enrollments in this month
      const newEnrollments = await pool.query(
        `SELECT e.id AS "employeeId", e.employee_code AS "employeeCode", e.full_name AS "fullName",
                si.si_code AS "siCode", si.enrollment_date::text AS "enrollmentDate", si.si_salary::text AS "siSalary"
         FROM employee_social_insurance si
         JOIN employees e ON e.id = si.employee_id AND e.organization_id = si.organization_id
         WHERE si.organization_id = $1 AND date_trunc('month', si.enrollment_date) = $2::date`,
        [identity.orgId, startDate]
      );

      // Terminations in this month
      const terminations = await pool.query(
        `SELECT e.id AS "employeeId", e.employee_code AS "employeeCode", e.full_name AS "fullName",
                si.si_code AS "siCode", si.termination_date::text AS "terminationDate", si.si_salary::text AS "siSalary"
         FROM employee_social_insurance si
         JOIN employees e ON e.id = si.employee_id AND e.organization_id = si.organization_id
         WHERE si.organization_id = $1 AND date_trunc('month', si.termination_date) = $2::date`,
        [identity.orgId, startDate]
      );

      res.json({
        month,
        fluctuations: {
          newEnrollments: newEnrollments.rows,
          terminations: terminations.rows,
          totalNew: newEnrollments.rows.length,
          totalTerminated: terminations.rows.length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 5. HR COST ANALYTICS & DASHBOARD
  // =========================================================================

  app.get(`${prefix}/analytics/period/:periodId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const periodId = z.string().uuid().parse(req.params.periodId);

      const periodRes = await pool.query(
        `SELECT id, code, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      // Aggregates from payroll_slips
      const slipsAgg = await pool.query<{
        cnt: number;
        prorated_base: string;
        allowances: string;
        bonuses: string;
        overtime: string;
        gross: string;
        net: string;
        deductions: string;
      }>(
        `SELECT count(*)::integer AS cnt,
                COALESCE(sum(prorated_base_salary), 0)::text AS prorated_base,
                COALESCE(sum(total_allowances), 0)::text AS allowances,
                COALESCE(sum(total_bonuses), 0)::text AS bonuses,
                COALESCE(sum(overtime_pay), 0)::text AS overtime,
                COALESCE(sum(gross_pay), 0)::text AS gross,
                COALESCE(sum(net_pay), 0)::text AS net,
                COALESCE(sum(total_deductions), 0)::text AS deductions
         FROM payroll_slips
         WHERE period_id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      const agg = slipsAgg.rows[0];

      // Calculate employer insurance & trade union portions
      const siFundRes = await pool.query<{ total_si_fund: string }>(
        `SELECT COALESCE(sum(LEAST(si.si_salary, 46800000)), 0)::text AS total_si_fund
         FROM employee_social_insurance si
         JOIN payroll_slips s ON s.employee_id = si.employee_id AND s.organization_id = si.organization_id
         WHERE s.period_id = $1 AND s.organization_id = $2 AND si.status = 'ACTIVE'`,
        [periodId, identity.orgId]
      );
      const siFundCents = toCents(siFundRes.rows[0]?.total_si_fund);
      const employerSiCents = toCents((Number(siFundCents) / 100) * 0.215); // BHXH 17.5% + BHYT 3% + BHTN 1%
      const employerUnionCents = toCents((Number(siFundCents) / 100) * 0.02); // 2% trade union

      const grossCents = toCents(agg.gross);
      const netCents = toCents(agg.net);
      const totalCostCents = grossCents + employerSiCents + employerUnionCents;

      // Actual disbursements made for this period
      const disbRes = await pool.query<{ disbursed: string }>(
        `SELECT COALESCE(sum(amount), 0)::text AS disbursed
         FROM payroll_disbursements
         WHERE period_id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      const disbursedCents = toCents(disbRes.rows[0]?.disbursed);

      // Departmental cost breakdown
      const deptBreakdown = await pool.query<{
        department_name: string;
        employee_count: number;
        dept_gross: string;
      }>(
        `SELECT COALESCE(d.name, 'Chưa gán') AS department_name,
                count(s.id)::integer AS employee_count,
                COALESCE(sum(s.gross_pay), 0)::text AS dept_gross
         FROM payroll_slips s
         JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
         LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
         WHERE s.period_id = $1 AND s.organization_id = $2
         GROUP BY d.name
         ORDER BY sum(s.gross_pay) DESC`,
        [periodId, identity.orgId]
      );

      // Previous period comparison
      const prevPeriodRes = await pool.query<{ id: string; gross: string }>(
        `SELECT p.id, COALESCE(sum(s.gross_pay), 0)::text AS gross
         FROM payroll_periods p
         JOIN payroll_slips s ON s.period_id = p.id AND s.organization_id = p.organization_id
         WHERE p.organization_id = $1 AND p.start_date < $2::date
         GROUP BY p.id, p.start_date
         ORDER BY p.start_date DESC
         LIMIT 1`,
        [identity.orgId, period.start_date]
      );
      let momDeltaCents = 0n;
      let momPct = 0;
      if (prevPeriodRes.rowCount && prevPeriodRes.rows[0]) {
        const prevGrossCents = toCents(prevPeriodRes.rows[0].gross);
        momDeltaCents = grossCents - prevGrossCents;
        if (prevGrossCents > 0n) {
          momPct = Number((momDeltaCents * 10000n) / prevGrossCents) / 100;
        }
      }

      res.json({
        period,
        analytics: {
          employeeCount: agg.cnt,
          grossPayroll: fromCents(grossCents),
          proratedBaseSalary: agg.prorated_base,
          allowances: agg.allowances,
          bonuses: agg.bonuses,
          overtimePay: agg.overtime,
          employerSocialInsurance: fromCents(employerSiCents),
          employerTradeUnion: fromCents(employerUnionCents),
          totalCostToCompany: fromCents(totalCostCents),
          financialMetrics: {
            accruedExpense: fromCents(totalCostCents), // Chi phí ghi nhận (Nợ 6422/6421)
            payableLiability: fromCents(netCents),     // Số tiền phải trả người lao động (Có 3341)
            disbursedPayment: fromCents(disbursedCents), // Số tiền thực tế đã chi trả (Có 1121)
            remainingUnpaid: fromCents(netCents > disbursedCents ? netCents - disbursedCents : 0n),
          },
          momComparison: {
            previousGross: prevPeriodRes.rowCount ? prevPeriodRes.rows[0].gross : '0.00',
            deltaAmount: fromCents(momDeltaCents),
            percentChange: momPct,
          },
          departmentDistribution: deptBreakdown.rows.map(d => ({
            departmentName: d.department_name,
            employeeCount: d.employee_count,
            grossAmount: d.dept_gross,
            percentOfTotal: grossCents > 0n ? Math.round((Number(toCents(d.dept_gross)) / Number(grossCents)) * 10000) / 100 : 0,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 6. COMPLIANCE ENGINE & ANOMALY DETECTION
  // =========================================================================

  app.post(`${prefix}/check/:periodId`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const periodId = z.string().uuid().parse(req.params.periodId);

      const anomalies = await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        // Check period
        const periodRes = await db.query<{ id: string; start_date: string; end_date: string }>(
          `SELECT id, start_date::text AS start_date, end_date::text AS end_date
           FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
          [periodId, identity.orgId]
        );
        if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
        const period = periodRes.rows[0];

        // Clear existing unresolved anomalies for this period
        await db.query(
          `DELETE FROM compliance_anomalies
           WHERE period_id = $1 AND organization_id = $2 AND resolution_status = 'OPEN'`,
          [periodId, identity.orgId]
        );

        const detected: any[] = [];

        // 1. Check: SALARY_BELOW_REGIONAL_MIN (Zone 1 standard 4,960,000)
        const minWageRes = await db.query<{
          id: string; employee_id: string; employee_code: string; full_name: string; base_salary: string;
        }>(
          `SELECT s.id, s.employee_id, e.employee_code, e.full_name, s.base_salary::text AS base_salary
           FROM payroll_slips s
           JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
           WHERE s.period_id = $1 AND s.organization_id = $2 AND s.base_salary < 4960000.00`,
          [periodId, identity.orgId]
        );
        for (const row of minWageRes.rows) {
          detected.push({
            id: randomUUID(),
            organization_id: identity.orgId,
            period_id: periodId,
            employee_id: row.employee_id,
            anomaly_code: 'SALARY_BELOW_REGIONAL_MIN',
            severity: 'CRITICAL',
            description: `Lương cơ bản của nhân viên ${row.full_name} (${row.employee_code}) thấp hơn mức lương tối thiểu vùng I (4.960.000 VND).`,
            expected_value: '>= 4960000.00',
            actual_value: row.base_salary,
          });
        }

        // 2. Check: MISSING_SI_PROFILE for employees with active slips
        const missingSiRes = await db.query<{
          employee_id: string; employee_code: string; full_name: string;
        }>(
          `SELECT s.employee_id, e.employee_code, e.full_name
           FROM payroll_slips s
           JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
           LEFT JOIN employee_social_insurance si ON si.employee_id = e.id AND si.organization_id = e.organization_id AND si.status = 'ACTIVE'
           WHERE s.period_id = $1 AND s.organization_id = $2 AND si.id IS NULL`,
          [periodId, identity.orgId]
        );
        for (const row of missingSiRes.rows) {
          detected.push({
            id: randomUUID(),
            organization_id: identity.orgId,
            period_id: periodId,
            employee_id: row.employee_id,
            anomaly_code: 'MISSING_SI_PROFILE',
            severity: 'WARNING',
            description: `Nhân viên ${row.full_name} (${row.employee_code}) có phiếu lương nhưng chưa có hồ sơ tham gia BHXH bắt buộc.`,
            expected_value: 'Active SI Profile',
            actual_value: 'None',
          });
        }

        // 3. Check: MISSING_DEPENDENT_TAX_ID
        const unverifiedDeps = await db.query<{
          employee_id: string; employee_code: string; full_name: string; dep_name: string;
        }>(
          `SELECT d.employee_id, e.employee_code, e.full_name, d.full_name AS dep_name
           FROM employee_dependents d
           JOIN employees e ON e.id = d.employee_id AND e.organization_id = d.organization_id
           JOIN payroll_slips s ON s.employee_id = d.employee_id AND s.organization_id = d.organization_id
           WHERE s.period_id = $1 AND d.organization_id = $2 AND (d.tax_id IS NULL OR d.is_verified = false)`,
          [periodId, identity.orgId]
        );
        for (const row of unverifiedDeps.rows) {
          detected.push({
            id: randomUUID(),
            organization_id: identity.orgId,
            period_id: periodId,
            employee_id: row.employee_id,
            anomaly_code: 'MISSING_DEPENDENT_TAX_ID',
            severity: 'INFO',
            description: `Người phụ thuộc "${row.dep_name}" của nhân viên ${row.full_name} (${row.employee_code}) chưa có MST hoặc chưa được xác minh.`,
            expected_value: 'Verified Tax ID',
            actual_value: 'Unverified / Missing Tax ID',
          });
        }

        // 4. Check: ANOMALOUS_FLUCTUATION (gross variance > 30% MoM)
        const flucRes = await db.query<{
          employee_id: string; employee_code: string; full_name: string; curr_gross: string; prev_gross: string;
        }>(
          `SELECT curr.employee_id, e.employee_code, e.full_name, curr.gross_pay::text AS curr_gross, prev.gross_pay::text AS prev_gross
           FROM payroll_slips curr
           JOIN employees e ON e.id = curr.employee_id AND e.organization_id = curr.organization_id
           JOIN payroll_periods curr_p ON curr_p.id = curr.period_id
           JOIN payroll_periods prev_p ON prev_p.organization_id = curr.organization_id AND prev_p.start_date < curr_p.start_date
           JOIN payroll_slips prev ON prev.period_id = prev_p.id AND prev.employee_id = curr.employee_id
           WHERE curr.period_id = $1 AND curr.organization_id = $2
             AND prev.gross_pay > 0
             AND ABS(curr.gross_pay - prev.gross_pay) / prev.gross_pay > 0.30`,
          [periodId, identity.orgId]
        );
        for (const row of flucRes.rows) {
          detected.push({
            id: randomUUID(),
            organization_id: identity.orgId,
            period_id: periodId,
            employee_id: row.employee_id,
            anomaly_code: 'ANOMALOUS_FLUCTUATION',
            severity: 'WARNING',
            description: `Thu nhập của nhân viên ${row.full_name} (${row.employee_code}) biến động > 30% so với kỳ trước.`,
            expected_value: `~ ${row.prev_gross}`,
            actual_value: row.curr_gross,
          });
        }

        // Insert detected anomalies
        for (const an of detected) {
          await db.query(
            `INSERT INTO compliance_anomalies (
               id, organization_id, period_id, employee_id, anomaly_code, severity,
               description, expected_value, actual_value, resolution_status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN')`,
            [
              an.id, an.organization_id, an.period_id, an.employee_id, an.anomaly_code,
              an.severity, an.description, an.expected_value, an.actual_value,
            ]
          );
        }

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'RUN_COMPLIANCE_CHECK', 'PAYROLL_PERIOD', $3, $4, $5)`,
          [randomUUID(), identity.orgId, periodId, identity.userId, JSON.stringify({ detectedCount: detected.length })]
        );

        return detected;
      });

      res.json({ success: true, count: anomalies.length, anomalies });
    } catch (err) {
      next(err);
    }
  });

  // List anomalies
  app.get(`${prefix}/anomalies`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const periodId = req.query.periodId ? String(req.query.periodId) : null;
      const status = req.query.status ? String(req.query.status) : null;

      let query = `
        SELECT a.id, a.period_id AS "periodId", a.employee_id AS "employeeId",
               e.employee_code AS "employeeCode", e.full_name AS "fullName",
               a.anomaly_code AS "anomalyCode", a.severity, a.description,
               a.expected_value AS "expectedValue", a.actual_value AS "actualValue",
               a.resolution_status AS "resolutionStatus", a.resolution_notes AS "resolutionNotes",
               a.resolved_at AS "resolvedAt", a.created_at AS "createdAt"
        FROM compliance_anomalies a
        LEFT JOIN employees e ON e.id = a.employee_id AND e.organization_id = a.organization_id
        WHERE a.organization_id = $1
      `;
      const params: any[] = [identity.orgId];

      if (periodId) {
        params.push(periodId);
        query += ` AND a.period_id = $${params.length}`;
      }
      if (status) {
        params.push(status);
        query += ` AND a.resolution_status = $${params.length}`;
      }

      query += ` ORDER BY a.created_at DESC`;
      const resData = await pool.query(query, params);
      res.json({ anomalies: resData.rows });
    } catch (err) {
      next(err);
    }
  });

  // Resolve anomaly
  app.patch(`${prefix}/anomalies/:id/resolve`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const anomalyId = z.string().uuid().parse(req.params.id);
      const status = z.enum(['ACKNOWLEDGED', 'RESOLVED', 'WAIVED']).parse(req.body.status ?? 'RESOLVED');
      const notes = z.string().trim().min(1).max(500).parse(req.body.notes ?? 'Đã giải trình và xác nhận');

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        const upd = await db.query(
          `UPDATE compliance_anomalies
           SET resolution_status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = now()
           WHERE id = $4 AND organization_id = $5 RETURNING id`,
          [status, notes, identity.userId, anomalyId, identity.orgId]
        );
        if (!upd.rowCount) fail(404, 'NOT_FOUND');

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'RESOLVE_ANOMALY', 'ANOMALY', $3, $4, $5)`,
          [randomUUID(), identity.orgId, anomalyId, identity.userId, JSON.stringify({ status, notes })]
        );
      });

      res.json({ success: true, anomalyId, status, notes });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 7. FORMAL COMPLIANCE REPORTS LIFECYCLE & EXPORT
  // =========================================================================

  // Generate formal compliance report
  app.post(`${prefix}/reports/generate`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const reportType = reportTypeEnum.parse(req.body.reportType);
      const periodId = req.body.periodId ? z.string().uuid().parse(req.body.periodId) : null;
      const title = z.string().trim().min(1).max(255).parse(req.body.title);

      const report = await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        let startDate = req.body.periodStart;
        let endDate = req.body.periodEnd;

        if (periodId) {
          const p = await db.query(
            `SELECT start_date::text, end_date::text FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId]
          );
          if (!p.rowCount) fail(404, 'PERIOD_NOT_FOUND');
          startDate = p.rows[0].start_date;
          endDate = p.rows[0].end_date;
        }

        if (!startDate || !endDate) fail(400, 'PERIOD_DATES_REQUIRED');

        const codeSuffix = startDate.replace(/-/g, '').slice(0, 6);
        const reportCode = `REP-${reportType}-${codeSuffix}-${randomUUID().slice(0, 4).toUpperCase()}`;

        // Count open anomalies
        const anomRes = await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM compliance_anomalies
           WHERE organization_id = $1 AND period_id = $2 AND resolution_status = 'OPEN'`,
          [identity.orgId, periodId]
        );
        const anomalyCount = parseInt(anomRes.rows[0]?.count || '0', 10);

        const id = randomUUID();
        await db.query(
          `INSERT INTO compliance_reports (
             id, organization_id, report_type, report_code, title, period_id,
             period_start, period_end, status, summary_data, anomaly_count, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, 'DRAFT', $9, $10, $11)`,
          [
            id, identity.orgId, reportType, reportCode, title, periodId,
            startDate, endDate, JSON.stringify(req.body.summaryData || {}),
            anomalyCount, identity.userId,
          ]
        );

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'GENERATE_REPORT', 'COMPLIANCE_REPORT', $3, $4, $5)`,
          [randomUUID(), identity.orgId, id, identity.userId, JSON.stringify({ reportCode, reportType })]
        );

        return { id, reportCode, reportType, title, status: 'DRAFT', anomalyCount };
      });

      res.status(201).json({ success: true, report });
    } catch (err) {
      next(err);
    }
  });

  // List formal reports
  app.get(`${prefix}/reports`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);

      const reports = await pool.query(
        `SELECT r.id, r.report_type AS "reportType", r.report_code AS "reportCode", r.title,
                r.period_id AS "periodId", r.period_start::text AS "periodStart", r.period_end::text AS "periodEnd",
                r.status, r.summary_data AS "summaryData", r.anomaly_count AS "anomalyCount",
                r.export_count AS "exportCount", r.last_exported_at AS "lastExportedAt",
                r.created_at AS "createdAt", u.full_name AS "createdByName"
         FROM compliance_reports r
         JOIN users u ON u.id = r.created_by
         WHERE r.organization_id = $1
         ORDER BY r.created_at DESC`,
        [identity.orgId]
      );
      res.json({ reports: reports.rows });
    } catch (err) {
      next(err);
    }
  });

  // Approve report (Admin / HR)
  app.post(`${prefix}/reports/:id/approve`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const reportId = z.string().uuid().parse(req.params.id);

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        const curr = await db.query<{ status: string }>(
          `SELECT status FROM compliance_reports WHERE id = $1 AND organization_id = $2`,
          [reportId, identity.orgId]
        );
        if (!curr.rowCount) fail(404, 'REPORT_NOT_FOUND');
        if (curr.rows[0].status === 'LOCKED') fail(409, 'REPORT_ALREADY_LOCKED');

        await db.query(
          `UPDATE compliance_reports
           SET status = 'APPROVED', approved_by = $1, approved_at = now(), updated_at = now()
           WHERE id = $2 AND organization_id = $3`,
          [identity.userId, reportId, identity.orgId]
        );

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'APPROVE_REPORT', 'COMPLIANCE_REPORT', $3, $4, '{}')`,
          [randomUUID(), identity.orgId, reportId, identity.userId]
        );
      });

      res.json({ success: true, reportId, status: 'APPROVED' });
    } catch (err) {
      next(err);
    }
  });

  // Lock report (Admin only)
  app.post(`${prefix}/reports/:id/lock`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const reportId = z.string().uuid().parse(req.params.id);

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN']);

        const curr = await db.query<{ status: string }>(
          `SELECT status FROM compliance_reports WHERE id = $1 AND organization_id = $2`,
          [reportId, identity.orgId]
        );
        if (!curr.rowCount) fail(404, 'REPORT_NOT_FOUND');
        if (curr.rows[0].status !== 'APPROVED') fail(400, 'REPORT_MUST_BE_APPROVED_BEFORE_LOCK');

        await db.query(
          `UPDATE compliance_reports
           SET status = 'LOCKED', updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [reportId, identity.orgId]
        );

        await db.query(
          `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
           VALUES ($1, $2, 'LOCK_REPORT', 'COMPLIANCE_REPORT', $3, $4, '{}')`,
          [randomUUID(), identity.orgId, reportId, identity.userId]
        );
      });

      res.json({ success: true, reportId, status: 'LOCKED' });
    } catch (err) {
      next(err);
    }
  });

  // Export report to CSV (Requires APPROVED or LOCKED status)
  app.get(`${prefix}/reports/:id/export`, async (req: Authed, res: Response, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);
      const reportId = z.string().uuid().parse(req.params.id);

      const reportRes = await pool.query<{
        id: string; report_type: string; report_code: string; title: string;
        period_id: string | null; period_start: string; period_end: string;
        status: string; summary_data: any;
      }>(
        `SELECT id, report_type, report_code, title, period_id,
                period_start::text, period_end::text, status, summary_data
         FROM compliance_reports
         WHERE id = $1 AND organization_id = $2`,
        [reportId, identity.orgId]
      );
      if (!reportRes.rowCount) fail(404, 'REPORT_NOT_FOUND');
      const rep = reportRes.rows[0];

      // Enforce business rule: Cannot export DRAFT report officially!
      if (rep.status !== 'APPROVED' && rep.status !== 'LOCKED') {
        fail(400, 'REPORT_NOT_APPROVED_FOR_EXPORT');
      }

      // Legacy statutory exports use unverified fixed rates and do not reconcile
      // to a closed payroll snapshot. Fail closed until these are verified.
      if (rep.report_type.startsWith('PIT') || rep.report_type.startsWith('SI')) {
        fail(409, 'STATUTORY_EXPORT_NOT_VERIFIED');
      }

      // Record export in audit log and increment counter
      await pool.query(
        `UPDATE compliance_reports
         SET export_count = export_count + 1, last_exported_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [reportId, identity.orgId]
      );
      await pool.query(
        `INSERT INTO compliance_audit_logs (id, organization_id, action, target_type, target_id, performed_by, details)
         VALUES ($1, $2, 'EXPORT_OFFICIAL_REPORT', 'COMPLIANCE_REPORT', $3, $4, $5)`,
        [randomUUID(), identity.orgId, reportId, identity.userId, JSON.stringify({ code: rep.report_code })]
      );

      // Generate CSV content with UTF-8 BOM
      let csv = '\uFEFF';
      csv += `BÁO CÁO TUÂN THỦ: ${rep.title}\r\n`;
      csv += `Mã báo cáo: ${rep.report_code}\r\n`;
      csv += `Kỳ: ${rep.period_start} đến ${rep.period_end}\r\n`;
      csv += `Trạng thái: ${rep.status}\r\n`;
      csv += `Thời điểm xuất: ${new Date().toISOString()}\r\n\r\n`;

      if (rep.report_type.startsWith('PIT')) {
        csv += 'Mã NV,Họ và tên,Thu nhập chịu thuế,Giảm trừ bản thân,Số người phụ thuộc,Giảm trừ NPT,Bảo hiểm bắt buộc,Thu nhập tính thuế,Thuế TNCN phải nộp\r\n';
        if (rep.period_id) {
          const slips = await pool.query<{
            employee_code: string; full_name: string; gross_pay: string;
          }>(
            `SELECT e.employee_code, e.full_name, s.gross_pay::text
             FROM payroll_slips s
             JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
             WHERE s.period_id = $1 AND s.organization_id = $2
             ORDER BY e.employee_code`,
            [rep.period_id, identity.orgId]
          );
          for (const s of slips.rows) {
            const gross = toCents(s.gross_pay);
            const personal = 1100000000n;
            const assessable = gross > personal ? gross - personal : 0n;
            const tax = assessable * 5n / 100n;
            csv += `"${s.employee_code}","${s.full_name}",${fromCents(gross)},11000000.00,0,0.00,0.00,${fromCents(assessable)},${fromCents(tax)}\r\n`;
          }
        }
      } else if (rep.report_type.startsWith('SI')) {
        csv += 'Mã NV,Họ và tên,Mã BHXH,Mức lương đóng BHXH,BHXH NLĐ (8%),BHYT NLĐ (1.5%),BHTN NLĐ (1%),BHXH DN (17.5%),BHYT DN (3%),BHTN DN (1%),KPCĐ (2%),Tổng trích nộp\r\n';
        if (rep.period_id) {
          const siList = await pool.query<{
            employee_code: string; full_name: string; si_code: string; si_salary: string;
          }>(
            `SELECT e.employee_code, e.full_name, si.si_code, si.si_salary::text
             FROM employees e
             JOIN employee_social_insurance si ON si.employee_id = e.id AND si.organization_id = e.organization_id
             WHERE e.organization_id = $1 AND si.status = 'ACTIVE'`,
            [identity.orgId]
          );
          for (const row of siList.rows) {
            const sal = toCents(row.si_salary);
            const emp8 = sal * 8n / 100n;
            const emp15 = sal * 15n / 1000n;
            const emp1 = sal * 1n / 100n;
            const dn175 = sal * 175n / 1000n;
            const dn3 = sal * 3n / 100n;
            const dn1 = sal * 1n / 100n;
            const union2 = sal * 2n / 100n;
            const tot = emp8 + emp15 + emp1 + dn175 + dn3 + dn1 + union2;
            csv += `"${row.employee_code}","${row.full_name}","${row.si_code}",${fromCents(sal)},${fromCents(emp8)},${fromCents(emp15)},${fromCents(emp1)},${fromCents(dn175)},${fromCents(dn3)},${fromCents(dn1)},${fromCents(union2)},${fromCents(tot)}\r\n`;
          }
        }
      } else {
        csv += 'Chỉ tiêu,Số tiền (VND),Ghi chú\r\n';
        csv += `Tổng chi phí nhân sự (CTC),${rep.summary_data.totalCostToCompany || '0.00'},Chi phí ghi nhận\r\n`;
        csv += `Lương thực lĩnh phải trả,${rep.summary_data.payableLiability || '0.00'},Công nợ phải trả\r\n`;
        csv += `Thực tế đã chi trả,${rep.summary_data.disbursedPayment || '0.00'},Đã thanh toán\r\n`;
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${rep.report_code}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  // Audit logs list
  app.get(`${prefix}/audit-logs`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      assertComplianceAccess(identity.role);

      const logs = await pool.query(
        `SELECT l.id, l.action, l.target_type AS "targetType", l.target_id AS "targetId",
                l.performed_by AS "performedBy", u.full_name AS "performedByName",
                l.details, l.created_at AS "createdAt"
         FROM compliance_audit_logs l
         JOIN users u ON u.id = l.performed_by
         WHERE l.organization_id = $1
         ORDER BY l.created_at DESC
         LIMIT 100`,
        [identity.orgId]
      );
      res.json({ logs: logs.rows });
    } catch (err) {
      next(err);
    }
  });
}
