import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, type Authed, type Identity } from './types.js';
import { authorizeMutation } from './authorization.js';
import { managementScope } from './management-scope.js';
import { escapeLike, type OrgStructureDeps } from './organization-structure.js';

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
});
const code = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_.-]+$/).transform(v => v.toUpperCase());

// Exact integer decimal math (cents) to completely avoid floating-point inaccuracies
export function toCents(val: number | string | null | undefined): bigint {
  if (val === null || val === undefined) return 0n;
  const s = String(val).trim();
  if (!s) return 0n;
  const parts = s.split('.');
  const intPart = parts[0] || '0';
  const decPart = (parts[1] || '').padEnd(2, '0').slice(0, 2);
  const sign = intPart.startsWith('-') ? -1n : 1n;
  const absInt = intPart.replace('-', '');
  return sign * (BigInt(absInt || '0') * 100n + BigInt(decPart));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const intPart = abs / 100n;
  const decPart = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${intPart}.${decPart}`;
}

export function prorateCents(baseCents: bigint, workedDaysHundredths: bigint, standardDaysHundredths: bigint): bigint {
  if (standardDaysHundredths <= 0n) return baseCents;
  if (workedDaysHundredths >= standardDaysHundredths) return baseCents;
  // Round to nearest cent: ((base * worked * 10) / standard + 5) / 10
  const numerator = baseCents * workedDaysHundredths;
  const rounded = (numerator * 10n) / standardDaysHundredths + 5n;
  return rounded / 10n;
}

const componentSchema = z.object({
  code,
  name: z.string().trim().min(1).max(120),
  type: z.enum(['BASE_SALARY', 'ALLOWANCE', 'BONUS', 'DEDUCTION']),
  calculationType: z.enum(['FIXED', 'PERCENTAGE', 'ATTENDANCE_BASED', 'FORMULA']).default('FIXED'),
  isTaxable: z.boolean().default(true),
  isStatutory: z.boolean().default(false),
  defaultAmount: z.number().min(0).max(1_000_000_000).default(0),
  active: z.boolean().default(true),
  description: z.string().trim().max(500).nullable().optional(),
}).strict();

const componentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  calculationType: z.enum(['FIXED', 'PERCENTAGE', 'ATTENDANCE_BASED', 'FORMULA']).default('FIXED'),
  isTaxable: z.boolean().default(true),
  isStatutory: z.boolean().default(false),
  defaultAmount: z.number().min(0).max(1_000_000_000).default(0),
  active: z.boolean().default(true),
  description: z.string().trim().max(500).nullable().optional(),
}).strict();

const profileComponentSchema = z.object({
  componentId: uuid,
  amount: z.number().min(0).max(1_000_000_000),
  percentage: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

const salaryProfileSchema = z.object({
  salaryMode: z.enum(['GROSS', 'NET']).default('GROSS'),
  baseSalary: z.number().min(0).max(1_000_000_000),
  effectiveFrom: day,
  effectiveTo: day.nullable().optional(),
  currency: z.string().trim().min(1).max(10).default('VND'),
  bankAccountNumber: z.string().trim().max(50).nullable().optional(),
  bankName: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).default('ACTIVE'),
  notes: z.string().trim().max(500).nullable().optional(),
  components: z.array(profileComponentSchema).default([]),
}).strict().refine(data => !data.effectiveTo || data.effectiveTo >= data.effectiveFrom, {
  message: 'effectiveTo must be greater than or equal to effectiveFrom',
  path: ['effectiveTo'],
});

const periodSchema = z.object({
  code,
  name: z.string().trim().min(1).max(120),
  startDate: day,
  endDate: day,
  paymentDate: day.nullable().optional(),
  standardWorkingDays: z.number().min(1).max(31).default(22),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict().refine(data => data.endDate >= data.startDate, {
  message: 'endDate must be greater than or equal to startDate',
  path: ['endDate'],
});

const periodStatusSchema = z.object({
  status: z.enum(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'CLOSED']),
  notes: z.string().trim().max(500).optional(),
}).strict();

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function registerPayrollRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, requireIdentity, audit } = deps;
  const prefix = '/api/organizations/:organizationId/payroll';

  function identityFor(req: Authed): Identity {
    const identity = requireIdentity(req);
    uuid.parse(req.params.organizationId);
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  // 1. GET Catalog (salary components for admin/HR)
  app.get(`${prefix}/catalog`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
      const result = await pool.query(
        `SELECT id, code, name, type, calculation_type AS "calculationType",
                is_taxable AS "isTaxable", is_statutory AS "isStatutory",
                default_amount AS "defaultAmount", active, description
         FROM salary_components
         WHERE organization_id = $1
         ORDER BY type, name`,
        [identity.orgId]
      );
      res.json({ components: result.rows });
    } catch (err) { next(err); }
  });

  // 2. GET Components list with pagination & search
  app.get(`${prefix}/components`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
      const { page, limit } = pagingSchema.parse(req.query);
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';

      const clauses = ['organization_id = $1'];
      const params: unknown[] = [identity.orgId];
      if (q) {
        params.push(`%${escapeLike(q)}%`);
        clauses.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
      }
      if (type && ['BASE_SALARY', 'ALLOWANCE', 'BONUS', 'DEDUCTION'].includes(type)) {
        params.push(type);
        clauses.push(`type = $${params.length}`);
      }

      const countSql = `SELECT count(*)::integer AS total FROM salary_components WHERE ${clauses.join(' AND ')}`;
      const total = (await pool.query(countSql, params)).rows[0]?.total ?? 0;

      const offset = (page - 1) * limit;
      params.push(limit, offset);
      const dataSql = `SELECT id, code, name, type, calculation_type AS "calculationType",
                              is_taxable AS "isTaxable", is_statutory AS "isStatutory",
                              default_amount AS "defaultAmount", active, description,
                              created_at AS "createdAt", updated_at AS "updatedAt"
                       FROM salary_components
                       WHERE ${clauses.join(' AND ')}
                       ORDER BY type, name
                       LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const items = (await pool.query(dataSql, params)).rows;
      res.json({ items, total, page, limit });
    } catch (err) { next(err); }
  });

  // 3. POST Component
  app.post(`${prefix}/components`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const data = componentSchema.parse(req.body);
      const id = randomUUID();

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);
        const dup = await db.query(
          'SELECT 1 FROM salary_components WHERE organization_id = $1 AND upper(btrim(code)) = upper(btrim($2))',
          [identity.orgId, data.code]
        );
        if (dup.rowCount) fail(409, 'DUPLICATE_CODE');

        await db.query(
          `INSERT INTO salary_components(id, organization_id, code, name, type, calculation_type, is_taxable, is_statutory, default_amount, active, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, identity.orgId, data.code, data.name, data.type, data.calculationType, data.isTaxable, data.isStatutory, data.defaultAmount, data.active, data.description || null]
        );
        await audit(db, 'PAYROLL_COMPONENT_CREATED', identity.userId, identity.orgId, undefined, {
          componentId: id,
          code: data.code,
          type: data.type,
        });
      });

      res.status(201).json({ id, ...data });
    } catch (err) { next(err); }
  });

  // 4. PUT Component
  app.put(`${prefix}/components/:id`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const componentId = uuid.parse(req.params.id);
      const data = componentUpdateSchema.parse(req.body);

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);
        const current = await db.query(
          'SELECT id, code FROM salary_components WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [componentId, identity.orgId]
        );
        if (!current.rowCount) fail(404, 'NOT_FOUND');

        await db.query(
          `UPDATE salary_components
           SET name = $1, calculation_type = $2, is_taxable = $3, is_statutory = $4,
               default_amount = $5, active = $6, description = $7, updated_at = now()
           WHERE id = $8 AND organization_id = $9`,
          [data.name, data.calculationType, data.isTaxable, data.isStatutory, data.defaultAmount, data.active, data.description || null, componentId, identity.orgId]
        );
        await audit(db, 'PAYROLL_COMPONENT_UPDATED', identity.userId, identity.orgId, undefined, {
          componentId,
          code: current.rows[0].code,
        });
      });

      res.json({ id: componentId, ...data });
    } catch (err) { next(err); }
  });

  // 5. GET Employee Salary Profile
  app.get(`${prefix}/employees/:employeeId/salary-profile`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const empId = uuid.parse(req.params.employeeId);

      const emp = await pool.query<{ id: string; user_id: string | null; department_id: string | null; manager_user_id: string | null }>(
        'SELECT id, user_id, department_id, manager_user_id FROM employees WHERE id = $1 AND organization_id = $2',
        [empId, identity.orgId]
      );
      if (!emp.rowCount) fail(404, 'NOT_FOUND');

      const empRow = emp.rows[0];
      if (identity.role === 'EMPLOYEE' && empRow.user_id !== identity.userId) {
        fail(403, 'FORBIDDEN');
      }
      if (identity.role === 'MANAGER') {
        const scope = (await managementScope(pool, identity))!;
        const inScope = (empRow.department_id && scope.departments.includes(empRow.department_id)) ||
                        (empRow.user_id && scope.users.includes(empRow.user_id)) ||
                        empRow.manager_user_id === identity.userId ||
                        empRow.user_id === identity.userId;
        if (!inScope) fail(403, 'FORBIDDEN');
      }

      const profileRes = await pool.query(
        `SELECT id, salary_mode AS "salaryMode", base_salary AS "baseSalary",
                effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo",
                currency, bank_account_number AS "bankAccountNumber", bank_name AS "bankName",
                status, notes, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM employee_salary_profiles
         WHERE organization_id = $1 AND employee_id = $2
         ORDER BY effective_from DESC
         LIMIT 1`,
        [identity.orgId, empId]
      );

      if (!profileRes.rowCount) {
        res.json({ profile: null, components: [] });
        return;
      }

      const profile = profileRes.rows[0];
      const compsRes = await pool.query(
        `SELECT pc.id, pc.component_id AS "componentId", c.name AS "componentName",
                c.code AS "componentCode", c.type AS "componentType",
                pc.amount, pc.percentage, pc.notes
         FROM employee_salary_profile_components pc
         JOIN salary_components c ON c.id = pc.component_id AND c.organization_id = pc.organization_id
         WHERE pc.profile_id = $1 AND pc.organization_id = $2
         ORDER BY c.type, c.name`,
        [profile.id, identity.orgId]
      );

      res.json({ profile, components: compsRes.rows });
    } catch (err) { next(err); }
  });

  // 6. PUT Employee Salary Profile (Admin & HR with reauth)
  app.put(`${prefix}/employees/:employeeId/salary-profile`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const empId = uuid.parse(req.params.employeeId);
      const data = salaryProfileSchema.parse(req.body);

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);
        const emp = await db.query(
          'SELECT id FROM employees WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [empId, identity.orgId]
        );
        if (!emp.rowCount) fail(404, 'NOT_FOUND');

        // Verify all componentIds belong to the same tenant
        if (data.components.length > 0) {
          const compIds = data.components.map(c => c.componentId);
          const validComps = await db.query(
            'SELECT id FROM salary_components WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND active = true',
            [compIds, identity.orgId]
          );
          if (validComps.rowCount !== compIds.length) fail(400, 'INVALID_COMPONENT');
        }

        const profileId = randomUUID();
        // Insert new profile version
        await db.query(
          `INSERT INTO employee_salary_profiles(
             id, organization_id, employee_id, salary_mode, base_salary, effective_from, effective_to,
             currency, bank_account_number, bank_name, status, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [profileId, identity.orgId, empId, data.salaryMode, data.baseSalary, data.effectiveFrom, data.effectiveTo || null,
           data.currency, data.bankAccountNumber || null, data.bankName || null, data.status, data.notes || null]
        );

        for (const item of data.components) {
          await db.query(
            `INSERT INTO employee_salary_profile_components(
               id, organization_id, profile_id, component_id, amount, percentage, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), identity.orgId, profileId, item.componentId, item.amount, item.percentage || null, item.notes || null]
          );
        }

        // Never log financial values or bank numbers
        await audit(db, 'PAYROLL_PROFILE_SAVED', identity.userId, identity.orgId, undefined, {
          employeeId: empId,
          profileId,
          salaryMode: data.salaryMode,
          effectiveFrom: data.effectiveFrom,
        });
      });

      res.status(200).json({ ok: true, employeeId: empId });
    } catch (err) { next(err); }
  });

  // 7. GET Payroll Periods
  app.get(`${prefix}/periods`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR', 'MANAGER'].includes(identity.role)) fail(403, 'FORBIDDEN');
      const { page, limit } = pagingSchema.parse(req.query);
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';

      const clauses = ['p.organization_id = $1'];
      const params: unknown[] = [identity.orgId];
      if (statusFilter && ['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'CLOSED'].includes(statusFilter)) {
        params.push(statusFilter);
        clauses.push(`p.status = $${params.length}`);
      }

      const countSql = `SELECT count(*)::integer AS total FROM payroll_periods p WHERE ${clauses.join(' AND ')}`;
      const total = (await pool.query(countSql, params)).rows[0]?.total ?? 0;

      const offset = (page - 1) * limit;
      params.push(limit, offset);
      const dataSql = `SELECT p.id, p.code, p.name, p.start_date::text AS "startDate", p.end_date::text AS "endDate",
                              p.payment_date::text AS "paymentDate", p.standard_working_days AS "standardWorkingDays",
                              p.status, p.approved_at AS "approvedAt", p.closed_at AS "closedAt", p.notes,
                              u_app.full_name AS "approvedByName", u_cls.full_name AS "closedByName",
                              (SELECT count(*)::integer FROM payroll_slips s WHERE s.period_id = p.id AND s.organization_id = p.organization_id) AS "slipCount"
                       FROM payroll_periods p
                       LEFT JOIN users u_app ON u_app.id = p.approved_by
                       LEFT JOIN users u_cls ON u_cls.id = p.closed_by
                       WHERE ${clauses.join(' AND ')}
                       ORDER BY p.start_date DESC
                       LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const items = (await pool.query(dataSql, params)).rows;
      res.json({ items, total, page, limit });
    } catch (err) { next(err); }
  });

  // 8. POST Create Payroll Period
  app.post(`${prefix}/periods`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const data = periodSchema.parse(req.body);
      const id = randomUUID();

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);
        const dup = await db.query(
          'SELECT 1 FROM payroll_periods WHERE organization_id = $1 AND upper(btrim(code)) = upper(btrim($2))',
          [identity.orgId, data.code]
        );
        if (dup.rowCount) fail(409, 'DUPLICATE_CODE');

        await db.query(
          `INSERT INTO payroll_periods(
             id, organization_id, code, name, start_date, end_date, payment_date, standard_working_days, status, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9)`,
          [id, identity.orgId, data.code, data.name, data.startDate, data.endDate, data.paymentDate || null, data.standardWorkingDays, data.notes || null]
        );

        await audit(db, 'PAYROLL_PERIOD_CREATED', identity.userId, identity.orgId, undefined, {
          periodId: id,
          code: data.code,
          startDate: data.startDate,
          endDate: data.endDate,
        });
      });

      res.status(201).json({ id, ...data, status: 'DRAFT' });
    } catch (err) { next(err); }
  });

  // 9. GET Payroll Period Detail with Summary
  app.get(`${prefix}/periods/:id`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR', 'MANAGER'].includes(identity.role)) fail(403, 'FORBIDDEN');
      const periodId = uuid.parse(req.params.id);

      const periodRes = await pool.query(
        `SELECT p.id, p.code, p.name, p.start_date::text AS "startDate", p.end_date::text AS "endDate",
                p.payment_date::text AS "paymentDate", p.standard_working_days AS "standardWorkingDays",
                p.status, p.approved_at AS "approvedAt", p.closed_at AS "closedAt", p.notes,
                u_app.full_name AS "approvedByName", u_cls.full_name AS "closedByName"
         FROM payroll_periods p
         LEFT JOIN users u_app ON u_app.id = p.approved_by
         LEFT JOIN users u_cls ON u_cls.id = p.closed_by
         WHERE p.id = $1 AND p.organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'NOT_FOUND');
      const period = periodRes.rows[0];

      const summaryRes = await pool.query(
        `SELECT count(*)::integer AS "totalSlips",
                COALESCE(sum(gross_pay), 0)::text AS "totalGross",
                COALESCE(sum(net_pay), 0)::text AS "totalNet",
                count(DISTINCT employee_id)::integer AS "totalEmployees"
         FROM payroll_slips
         WHERE period_id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );

      res.json({ period, summary: summaryRes.rows[0] });
    } catch (err) { next(err); }
  });

  // 10. POST Calculate Draft Payroll for Period (Admin & HR with reauth)
  app.post(`${prefix}/periods/:id/calculate`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const periodId = uuid.parse(req.params.id);

      const result = await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        // Lock period row
        const periodRes = await db.query<{
          id: string; status: string; code: string; start_date: string; end_date: string; standard_working_days: string;
        }>(
          `SELECT id, status, code, start_date::text AS start_date, end_date::text AS end_date, standard_working_days::text AS standard_working_days
           FROM payroll_periods
           WHERE id = $1 AND organization_id = $2
           FOR UPDATE`,
          [periodId, identity.orgId]
        );
        if (!periodRes.rowCount) fail(404, 'NOT_FOUND');
        const period = periodRes.rows[0];

        if (period.status === 'CLOSED') {
          fail(409, 'PAYROLL_PERIOD_CLOSED');
        }

        // Idempotent: delete existing draft slips and cascade slip items
        await db.query(
          'DELETE FROM payroll_slips WHERE period_id = $1 AND organization_id = $2',
          [periodId, identity.orgId]
        );

        // Fetch all active employees in tenant
        const employees = await db.query<{ id: string; employee_code: string; full_name: string }>(
          `SELECT id, employee_code, full_name
           FROM employees
           WHERE organization_id = $1 AND employment_status = 'ACTIVE'
           ORDER BY employee_code`,
          [identity.orgId]
        );

        const standardDaysNum = Number(period.standard_working_days) || 22;
        const standardDaysHundredths = BigInt(Math.round(standardDaysNum * 100));

        let generatedSlips = 0;

        for (const emp of employees.rows) {
          // Look up active salary profile effective in this period window
          const profileRes = await db.query<{
            id: string; salary_mode: 'GROSS' | 'NET'; base_salary: string;
          }>(
            `SELECT id, salary_mode, base_salary::text AS base_salary
             FROM employee_salary_profiles
             WHERE organization_id = $1 AND employee_id = $2 AND status = 'ACTIVE'
               AND effective_from <= $4::date AND (effective_to IS NULL OR effective_to >= $3::date)
             ORDER BY effective_from DESC
             LIMIT 1`,
            [identity.orgId, emp.id, period.start_date, period.end_date]
          );

          if (!profileRes.rowCount) {
            continue; // Skip employee without configured salary profile
          }
          const profile = profileRes.rows[0];
          const baseCents = toCents(profile.base_salary);

          // Get attendance punches worked days
          const attRes = await db.query<{ worked_days: number }>(
            `SELECT count(DISTINCT s.work_date)::integer AS worked_days
             FROM work_schedule s
             JOIN attendance_punches p ON p.schedule_id = s.id AND p.organization_id = s.organization_id
             WHERE s.organization_id = $1 AND s.employee_id = $2
               AND s.work_date >= $3::date AND s.work_date <= $4::date
               AND p.checked_in_at IS NOT NULL`,
            [identity.orgId, emp.id, period.start_date, period.end_date]
          );
          const rawWorkedDays = attRes.rows[0]?.worked_days ?? 0;

          // Get approved leave minutes
          const leaveRes = await db.query<{ leave_minutes: number }>(
            `SELECT COALESCE(sum(charge_minutes), 0)::integer AS leave_minutes
             FROM leave_requests
             WHERE organization_id = $1 AND employee_id = $2 AND status = 'APPROVED'
               AND starts_at::date >= $3::date AND starts_at::date <= $4::date`,
            [identity.orgId, emp.id, period.start_date, period.end_date]
          );
          const leaveMinutes = leaveRes.rows[0]?.leave_minutes ?? 0;
          // 480 minutes = 1 workday
          const paidLeaveDays = Math.round((leaveMinutes / 480) * 100) / 100;

          // If attendance schedule exists, actual days is recorded worked days.
          // If no shifts were ever assigned or punched (rawWorkedDays === 0 and leaveMinutes === 0),
          // default to standard working days to avoid penalizing employees when attendance module is not tracked.
          let actualDays = rawWorkedDays;
          if (rawWorkedDays === 0 && leaveMinutes === 0) {
            actualDays = standardDaysNum;
          }

          const totalEffectiveDays = Math.min(actualDays + paidLeaveDays, standardDaysNum);
          const effectiveDaysHundredths = BigInt(Math.round(totalEffectiveDays * 100));

          // Prorated base salary using exact integer math
          const proratedBaseCents = prorateCents(baseCents, effectiveDaysHundredths, standardDaysHundredths);

          // Fetch recurring components
          const compsRes = await db.query<{
            component_id: string; component_name: string; component_type: string;
            amount: string; percentage: number | null;
          }>(
            `SELECT pc.component_id, c.name AS component_name, c.type AS component_type,
                    pc.amount::text AS amount, pc.percentage
             FROM employee_salary_profile_components pc
             JOIN salary_components c ON c.id = pc.component_id AND c.organization_id = pc.organization_id
             WHERE pc.profile_id = $1 AND pc.organization_id = $2 AND c.active = true
             ORDER BY c.type, c.name`,
            [profile.id, identity.orgId]
          );

          let allowancesCents = 0n;
          let bonusesCents = 0n;
          let deductionsCents = 0n;
          const slipItemsToInsert: Array<{
            componentId: string | null; componentName: string; type: string; amountCents: bigint; notes: string | null;
          }> = [];

          // Add base salary line item
          slipItemsToInsert.push({
            componentId: null,
            componentName: 'Lương cơ bản (quy đổi theo ngày công)',
            type: 'BASE_SALARY',
            amountCents: proratedBaseCents,
            notes: `Ngày công: ${actualDays} thực tế + ${paidLeaveDays} phép / ${standardDaysNum} tiêu chuẩn`,
          });

          for (const c of compsRes.rows) {
            const itemCents = toCents(c.amount);
            if (c.component_type === 'ALLOWANCE') {
              allowancesCents += itemCents;
              slipItemsToInsert.push({
                componentId: c.component_id,
                componentName: c.component_name,
                type: 'ALLOWANCE',
                amountCents: itemCents,
                notes: null,
              });
            } else if (c.component_type === 'BONUS') {
              bonusesCents += itemCents;
              slipItemsToInsert.push({
                componentId: c.component_id,
                componentName: c.component_name,
                type: 'BONUS',
                amountCents: itemCents,
                notes: null,
              });
            } else if (c.component_type === 'DEDUCTION') {
              deductionsCents += itemCents;
              slipItemsToInsert.push({
                componentId: c.component_id,
                componentName: c.component_name,
                type: 'DEDUCTION',
                amountCents: itemCents,
                notes: null,
              });
            }
          }

          const grossCents = proratedBaseCents + allowancesCents + bonusesCents;
          const netCents = grossCents >= deductionsCents ? grossCents - deductionsCents : 0n;

          const slipId = randomUUID();
          await db.query(
            `INSERT INTO payroll_slips(
               id, organization_id, period_id, employee_id, salary_mode, standard_days,
               actual_working_days, paid_leave_days, unpaid_leave_days, overtime_hours,
               base_salary, prorated_base_salary, total_allowances, total_bonuses,
               total_deductions, overtime_pay, gross_pay, net_pay, status
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $10, $11, $12, $13, 0, $14, $15, 'DRAFT'
             )`,
            [
              slipId, identity.orgId, periodId, emp.id, profile.salary_mode, standardDaysNum,
              actualDays, paidLeaveDays, fromCents(baseCents), fromCents(proratedBaseCents),
              fromCents(allowancesCents), fromCents(bonusesCents), fromCents(deductionsCents),
              fromCents(grossCents), fromCents(netCents)
            ]
          );

          for (const item of slipItemsToInsert) {
            await db.query(
              `INSERT INTO payroll_slip_items(
                 id, organization_id, slip_id, component_id, component_name, type, amount, notes
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                randomUUID(), identity.orgId, slipId, item.componentId, item.componentName,
                item.type, fromCents(item.amountCents), item.notes
              ]
            );
          }

          generatedSlips++;
        }

        await db.query('UPDATE payroll_periods SET updated_at = now() WHERE id = $1', [periodId]);

        await audit(db, 'PAYROLL_CALCULATED', identity.userId, identity.orgId, undefined, {
          periodId,
          code: period.code,
          slipsCount: generatedSlips,
        });

        return { periodId, generatedSlips };
      });

      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  // 11. PATCH Period Status (Lifecycle: DRAFT -> UNDER_REVIEW -> APPROVED -> CLOSED)
  app.patch(`${prefix}/periods/:id/status`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const periodId = uuid.parse(req.params.id);
      const { status, notes } = periodStatusSchema.parse(req.body);

      await transaction(async db => {
        await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

        const periodRes = await db.query<{ id: string; status: string; code: string }>(
          'SELECT id, status, code FROM payroll_periods WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [periodId, identity.orgId]
        );
        if (!periodRes.rowCount) fail(404, 'NOT_FOUND');
        const period = periodRes.rows[0];

        if (period.status === 'CLOSED') {
          fail(409, 'PAYROLL_PERIOD_CLOSED');
        }

        // Validate allowed transitions
        const allowedTransitions: Record<string, string[]> = {
          DRAFT: ['UNDER_REVIEW'],
          UNDER_REVIEW: ['DRAFT', 'APPROVED'],
          APPROVED: ['UNDER_REVIEW', 'CLOSED'],
        };
        if (!allowedTransitions[period.status]?.includes(status)) {
          fail(400, 'INVALID_STATUS_TRANSITION');
        }

        let updateSql = 'UPDATE payroll_periods SET status = $1, updated_at = now()';
        const params: unknown[] = [status];

        if (status === 'APPROVED') {
          params.push(identity.userId);
          updateSql += `, approved_by = $${params.length}, approved_at = now()`;
        } else if (status === 'CLOSED') {
          params.push(identity.userId);
          updateSql += `, closed_by = $${params.length}, closed_at = now()`;
        }

        if (notes !== undefined) {
          params.push(notes);
          updateSql += `, notes = $${params.length}`;
        }

        params.push(periodId, identity.orgId);
        updateSql += ` WHERE id = $${params.length - 1} AND organization_id = $${params.length}`;
        await db.query(updateSql, params);

        const auditEvent = status === 'CLOSED' ? 'PAYROLL_PERIOD_CLOSED' : 'PAYROLL_STATUS_CHANGED';
        await audit(db, auditEvent, identity.userId, identity.orgId, undefined, {
          periodId,
          code: period.code,
          fromStatus: period.status,
          toStatus: status,
        });
      });

      res.json({ id: periodId, status });
    } catch (err) { next(err); }
  });

  // 12. GET Slips in Period
  app.get(`${prefix}/periods/:id/slips`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const periodId = uuid.parse(req.params.id);
      const { page, limit } = pagingSchema.parse(req.query);
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const clauses = ['s.period_id = $1', 's.organization_id = $2'];
      const params: unknown[] = [periodId, identity.orgId];

      if (identity.role === 'EMPLOYEE') {
        params.push(identity.userId);
        clauses.push(`e.user_id = $${params.length}`);
      } else if (identity.role === 'MANAGER') {
        const scope = (await managementScope(pool, identity))!;
        params.push(scope.departments, scope.users, identity.userId);
        clauses.push(`(e.department_id = ANY($${params.length - 2}::uuid[]) OR e.user_id = ANY($${params.length - 1}::uuid[]) OR e.manager_user_id = $${params.length} OR e.user_id = $${params.length})`);
      }

      if (q) {
        params.push(`%${escapeLike(q)}%`);
        clauses.push(`(e.full_name ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`);
      }

      const countSql = `SELECT count(*)::integer AS total
                        FROM payroll_slips s
                        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
                        WHERE ${clauses.join(' AND ')}`;
      const total = (await pool.query(countSql, params)).rows[0]?.total ?? 0;

      const offset = (page - 1) * limit;
      params.push(limit, offset);
      const dataSql = `SELECT s.id, s.period_id AS "periodId", s.employee_id AS "employeeId",
                              e.employee_code AS "employeeCode", e.full_name AS "fullName",
                              d.name AS "departmentName", p.title AS "positionTitle",
                              s.salary_mode AS "salaryMode", s.standard_days AS "standardDays",
                              s.actual_working_days AS "actualWorkingDays", s.paid_leave_days AS "paidLeaveDays",
                              s.base_salary AS "baseSalary", s.prorated_base_salary AS "proratedBaseSalary",
                              s.total_allowances AS "totalAllowances", s.total_bonuses AS "totalBonuses",
                              s.total_deductions AS "totalDeductions", s.gross_pay AS "grossPay",
                              s.net_pay AS "netPay", s.status, s.created_at AS "createdAt"
                       FROM payroll_slips s
                       JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
                       LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
                       LEFT JOIN positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
                       WHERE ${clauses.join(' AND ')}
                       ORDER BY e.employee_code
                       LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const items = (await pool.query(dataSql, params)).rows;

      res.json({ items, total, page, limit });
    } catch (err) { next(err); }
  });

  // 13. GET Single Slip Detail
  app.get(`${prefix}/slips/:id`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const slipId = uuid.parse(req.params.id);

      const slipRes = await pool.query(
        `SELECT s.*, e.employee_code AS "employeeCode", e.full_name AS "fullName", e.user_id,
                e.department_id, e.manager_user_id, d.name AS "departmentName", p.title AS "positionTitle",
                pr.code AS "periodCode", pr.name AS "periodName", pr.start_date::text AS "periodStartDate",
                pr.end_date::text AS "periodEndDate", pr.status AS "periodStatus"
         FROM payroll_slips s
         JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
         JOIN payroll_periods pr ON pr.id = s.period_id AND pr.organization_id = s.organization_id
         LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
         LEFT JOIN positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
         WHERE s.id = $1 AND s.organization_id = $2`,
        [slipId, identity.orgId]
      );
      if (!slipRes.rowCount) fail(404, 'NOT_FOUND');
      const row = slipRes.rows[0];

      if (identity.role === 'EMPLOYEE' && row.user_id !== identity.userId) {
        fail(403, 'FORBIDDEN');
      }
      if (identity.role === 'MANAGER') {
        const scope = (await managementScope(pool, identity))!;
        const inScope = (row.department_id && scope.departments.includes(row.department_id)) ||
                        (row.user_id && scope.users.includes(row.user_id)) ||
                        row.manager_user_id === identity.userId ||
                        row.user_id === identity.userId;
        if (!inScope) fail(403, 'FORBIDDEN');
      }

      const itemsRes = await pool.query(
        `SELECT id, component_name AS "componentName", type, amount, notes
         FROM payroll_slip_items
         WHERE slip_id = $1 AND organization_id = $2
         ORDER BY id`,
        [slipId, identity.orgId]
      );

      res.json({
        slip: {
          id: row.id,
          periodId: row.period_id,
          employeeId: row.employee_id,
          employeeCode: row.employeeCode,
          fullName: row.fullName,
          departmentName: row.departmentName,
          positionTitle: row.positionTitle,
          periodCode: row.periodCode,
          periodName: row.periodName,
          periodStartDate: row.periodStartDate,
          periodEndDate: row.periodEndDate,
          periodStatus: row.periodStatus,
          salaryMode: row.salary_mode,
          standardDays: row.standard_days,
          actualWorkingDays: row.actual_working_days,
          paidLeaveDays: row.paid_leave_days,
          unpaidLeaveDays: row.unpaid_leave_days,
          overtimeHours: row.overtime_hours,
          baseSalary: row.base_salary,
          proratedBaseSalary: row.prorated_base_salary,
          totalAllowances: row.total_allowances,
          totalBonuses: row.total_bonuses,
          totalDeductions: row.total_deductions,
          overtimePay: row.overtime_pay,
          grossPay: row.gross_pay,
          netPay: row.net_pay,
          status: row.status,
          createdAt: row.created_at,
        },
        items: itemsRes.rows,
      });
    } catch (err) { next(err); }
  });

  // 14. GET Self-service "My Payslips" for logged in employee
  app.get(`${prefix}/my-slips`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const empRes = await pool.query<{ id: string }>(
        'SELECT id FROM employees WHERE user_id = $1 AND organization_id = $2',
        [identity.userId, identity.orgId]
      );
      if (!empRes.rowCount) {
        res.json({ items: [], total: 0 });
        return;
      }
      const empId = empRes.rows[0].id;

      const slipsRes = await pool.query(
        `SELECT s.id, s.period_id AS "periodId", pr.code AS "periodCode", pr.name AS "periodName",
                pr.start_date::text AS "periodStartDate", pr.end_date::text AS "periodEndDate",
                pr.payment_date::text AS "paymentDate", pr.status AS "periodStatus",
                s.salary_mode AS "salaryMode", s.standard_days AS "standardDays",
                s.actual_working_days AS "actualWorkingDays", s.paid_leave_days AS "paidLeaveDays",
                s.base_salary AS "baseSalary", s.prorated_base_salary AS "proratedBaseSalary",
                s.total_allowances AS "totalAllowances", s.total_bonuses AS "totalBonuses",
                s.total_deductions AS "totalDeductions", s.gross_pay AS "grossPay",
                s.net_pay AS "netPay", s.status, s.created_at AS "createdAt"
         FROM payroll_slips s
         JOIN payroll_periods pr ON pr.id = s.period_id AND pr.organization_id = s.organization_id
         WHERE s.employee_id = $1 AND s.organization_id = $2
         ORDER BY pr.start_date DESC`,
        [empId, identity.orgId]
      );

      res.json({ items: slipsRes.rows, total: slipsRes.rowCount });
    } catch (err) { next(err); }
  });
}
