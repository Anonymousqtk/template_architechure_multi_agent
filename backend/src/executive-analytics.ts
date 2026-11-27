import type { Express } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { attendanceLedgerSql } from './attendance-ledger-sql.js';
import { buildEmployeeScopeClause } from './reporting.js';
import type { OrgStructureDeps } from './organization-structure.js';
import { fail, type Authed, type Identity } from './types.js';

const day = z.iso.date().refine((value) => value >= '1900-01-01' && value <= '9998-12-31');
const rangeSchema = z
  .object({
    startDate: day,
    endDate: day,
    compareStartDate: day.optional(),
    compareEndDate: day.optional(),
    departmentId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    grain: z.enum(['month', 'quarter', 'year']).default('month'),
  })
  .strict();

export function parseAnalyticsRange(raw: unknown) {
  const range = rangeSchema.parse(raw);
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
  if (days(range.startDate, range.endDate) < 0 || days(range.startDate, range.endDate) > 365)
    fail(400, 'INVALID_ANALYTICS_RANGE');
  if (Boolean(range.compareStartDate) !== Boolean(range.compareEndDate))
    fail(400, 'INVALID_ANALYTICS_RANGE');
  const span = days(range.startDate, range.endDate) + 1;
  const previousEnd = new Date(Date.parse(range.startDate) - 86400000).toISOString().slice(0, 10);
  const previousStart = new Date(Date.parse(range.startDate) - span * 86400000)
    .toISOString()
    .slice(0, 10);
  const compareStartDate = range.compareStartDate ?? previousStart;
  const compareEndDate = range.compareEndDate ?? previousEnd;
  if (
    days(compareStartDate, compareEndDate) < 0 ||
    days(compareStartDate, compareEndDate) > 365 ||
    compareEndDate >= range.startDate
  )
    fail(400, 'INVALID_ANALYTICS_RANGE');
  return { ...range, compareStartDate, compareEndDate };
}

export function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator <= 0
    ? null
    : Math.round((numerator / denominator) * 10000) / 100;
}

export function lifecycleKpis(input: {
  opening: number | null;
  closing: number | null;
  departures: number | null;
  retained: number | null;
}) {
  const { opening, closing, departures, retained } = input;
  return {
    growth: opening === null || closing === null ? null : ratio(closing - opening, opening),
    turnover:
      opening === null || closing === null ? null : ratio(departures, (opening + closing) / 2),
    retention: ratio(retained, opening),
  };
}

function decimalCents(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = amount.replace(/^-/, '').split('.');
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))) * (negative ? -1n : 1n)
  );
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  const abs = numerator < 0n ? -numerator : numerator;
  return ((abs + denominator / 2n) / denominator) * (numerator < 0n ? -1n : 1n);
}

export function moneyChangePercent(current: string | null, previous: string | null): number | null {
  if (current === null || previous === null) return null;
  const baseline = decimalCents(previous);
  if (baseline <= 0n) return null;
  return Number(roundedDivision((decimalCents(current) - baseline) * 10000n, baseline)) / 100;
}

export function costPerEmployee(amount: string | null, employees: number): string | null {
  if (amount === null || employees <= 0) return null;
  const value = roundedDivision(decimalCents(amount), BigInt(employees));
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

type Range = ReturnType<typeof parseAnalyticsRange>;

async function employeeSet(db: PoolClient, identity: Identity, range: Range) {
  const scope = await buildEmployeeScopeClause(db, identity, 4);
  const params: unknown[] = [identity.orgId, range.startDate, range.endDate, ...scope.params];
  const options = await db.query<{ id: string; name: string; parentId: string | null }>(
    `SELECT d.id,d.name,d.parent_id AS "parentId" FROM departments d
     WHERE d.organization_id=$1 AND $2::date <= $3::date AND (${['ADMIN', 'HR'].includes(identity.role) ? 'true OR' : ''}
       d.id=ANY($${scope.nextIndex}::uuid[]) OR EXISTS(SELECT 1 FROM employees e
       WHERE e.organization_id=$1 AND e.department_id=d.id AND ${scope.clause})
     )
     ORDER BY d.name,d.id`,
    [...params, scope.departmentIds ?? []],
  );
  for (const id of [range.departmentId, range.branchId]) {
    if (id && !options.rows.some((d) => d.id === id)) {
      const allowed =
        ['ADMIN', 'HR'].includes(identity.role) &&
        (
          await db.query('SELECT 1 FROM departments WHERE organization_id=$1 AND id=$2', [
            identity.orgId,
            id,
          ])
        ).rowCount;
      if (!allowed) fail(403, 'FORBIDDEN');
    }
  }
  const departmentParam = params.push(range.departmentId ?? null);
  const branchParam = params.push(range.branchId ?? null);
  const cte = `WITH RECURSIVE selected_branch(id) AS (
    SELECT id FROM departments WHERE organization_id=$1 AND id=$${branchParam}::uuid
    UNION SELECT d.id FROM departments d JOIN selected_branch b ON d.parent_id=b.id WHERE d.organization_id=$1
  ), selected_employees AS (
    SELECT e.* FROM employees e WHERE e.organization_id=$1 AND ${scope.clause}
      AND ($${departmentParam}::uuid IS NULL OR e.department_id=$${departmentParam})
      AND ($${branchParam}::uuid IS NULL OR e.department_id IN(SELECT id FROM selected_branch))
      AND $2::date <= $3::date
  )`;
  return { cte, params, departments: options.rows };
}

async function payrollTotals(db: PoolClient, cte: string, params: unknown[], grain: string) {
  // Only recorded, confirmed slips in approved/closed, fully-contained periods.
  // Insurance is read separately, never estimated from gross payroll.
  const sql = `${cte}, slips AS (
    SELECT s.*,p.start_date,p.end_date,e.department_id FROM payroll_slips s
    JOIN payroll_periods p ON p.id=s.period_id AND p.organization_id=s.organization_id
    JOIN selected_employees e ON e.id=s.employee_id AND e.organization_id=s.organization_id
    WHERE s.organization_id=$1 AND p.start_date >= $2::date AND p.end_date <= $3::date
      AND p.status IN ('APPROVED','CLOSED') AND s.status IN ('CONFIRMED','PAID')
  )`;
  const totals = await db.query(
    `${sql} SELECT count(*)::int AS records,
    count(DISTINCT employee_id)::int AS employees, sum(gross_pay)::text AS gross,
    sum(net_pay)::text AS net, sum(prorated_base_salary)::text AS base,
    sum(total_allowances)::text AS allowances,sum(total_bonuses)::text AS bonuses,
    sum(overtime_pay)::text AS overtime, sum(overtime_hours)::text AS "overtimeHours",
    max(updated_at) AS "updatedAt", avg(gross_pay)::text AS "averageSalary"
    FROM slips`,
    params,
  );
  const departments = await db.query(
    `${sql}
    SELECT s.department_id AS id,d.name AS label,count(DISTINCT s.employee_id)::int AS employees,
      sum(s.gross_pay)::text AS gross FROM slips s
    LEFT JOIN departments d ON d.id=s.department_id AND d.organization_id=$1
    GROUP BY s.department_id,d.name ORDER BY sum(s.gross_pay) DESC,s.department_id`,
    params,
  );
  const trends = await db.query(
    `${sql} SELECT date_trunc('${grain}',start_date)::date::text AS label,
    sum(gross_pay)::text AS value FROM slips GROUP BY 1 ORDER BY 1`,
    params,
  );
  const insurance = await db.query(
    `${cte} SELECT count(*) FILTER(WHERE si.currency='VND')::int AS records,
    count(*) FILTER(WHERE si.currency<>'VND')::int AS "excludedCurrencyRecords",
    sum(c.employer_amount) FILTER(WHERE si.currency='VND')::text AS employer,
    sum(c.employee_amount) FILTER(WHERE si.currency='VND')::text AS employee,
    max(c.updated_at) AS "updatedAt" FROM social_insurance_contributions c
    JOIN selected_employees e ON e.id=c.employee_id AND e.organization_id=c.organization_id
    JOIN employee_social_insurance si ON si.id=c.si_profile_id AND si.organization_id=c.organization_id
    WHERE c.organization_id=$1 AND c.contribution_month >= $2::date
      AND (c.contribution_month + interval '1 month - 1 day')::date <= $3::date
      AND c.status IN ('CONFIRMED','ADJUSTED')`,
    params,
  );
  const payments = await db.query(
    `${cte} SELECT count(*)::int AS records,
    sum(p.amount)::text AS amount,max(p.updated_at) AS "updatedAt" FROM payroll_disbursements p
    JOIN selected_employees e ON e.id=p.employee_id AND e.organization_id=p.organization_id
    WHERE p.organization_id=$1 AND p.status='COMPLETED' AND p.payment_date BETWEEN $2::date AND $3::date`,
    params,
  );
  const periods = await db.query(
    `${cte} SELECT p.id,p.name,p.status,
    p.start_date::text AS "startDate",p.end_date::text AS "endDate"
    FROM payroll_periods p WHERE p.organization_id=$1 AND p.start_date <= $3::date AND p.end_date >= $2::date
    ORDER BY p.start_date,p.id`,
    params,
  );
  return {
    ...totals.rows[0],
    insurance: insurance.rows[0],
    payments: payments.rows[0],
    departments: departments.rows,
    trends: trends.rows,
    periods: periods.rows,
  };
}

export function registerExecutiveAnalyticsRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const prefix = '/api/organizations/:organizationId/reports/executive';
  function identityFor(req: Authed, adminOnly = false) {
    const identity = requireIdentity(req);
    z.uuid().parse(req.params.organizationId);
    if (
      identity.orgId !== req.params.organizationId ||
      !(adminOnly ? identity.role === 'ADMIN' : ['ADMIN', 'HR', 'MANAGER'].includes(identity.role))
    )
      fail(403, 'FORBIDDEN');
    return identity;
  }

  app.get(prefix, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const range = parseAnalyticsRange(req.query);
      const financial = ['ADMIN', 'HR'].includes(identity.role);
      const result = await transaction(async (db) => {
        await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { cte, params, departments } = await employeeSet(db, identity, range);
        const workforce = await db.query(
          `${cte} SELECT count(*)::int AS records,
          count(*) FILTER(WHERE employment_status IN ('ACTIVE','ON_LEAVE') AND hire_date <= (now() AT TIME ZONE 'Asia/Bangkok')::date)::int AS headcount,
          count(*) FILTER(WHERE hire_date BETWEEN $2::date AND $3::date)::int AS hires,
          max(updated_at) AS "updatedAt" FROM selected_employees`,
          params,
        );
        const structure = await db.query(
          `${cte} SELECT 'department' AS kind,e.department_id AS id,d.name AS label,count(*)::int AS value
          FROM selected_employees e LEFT JOIN departments d ON d.id=e.department_id AND d.organization_id=e.organization_id
          WHERE e.employment_status IN ('ACTIVE','ON_LEAVE') AND e.hire_date<=(now() AT TIME ZONE 'Asia/Bangkok')::date GROUP BY e.department_id,d.name
          UNION ALL SELECT 'position',e.position_id,p.title,count(*)::int
          FROM selected_employees e LEFT JOIN positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
          WHERE e.employment_status IN ('ACTIVE','ON_LEAVE') AND e.hire_date<=(now() AT TIME ZONE 'Asia/Bangkok')::date GROUP BY e.position_id,p.title`,
          params,
        );
        // Reuse the exact ATT ledger SQL, including approved adjustments, leave and office days.
        // Substitutions are fixed server-side identifiers; no client text enters SQL.
        const ledger = attendanceLedgerSql.replace(
          /\$([1-4])\b/g,
          (_, n: string) => ({ '1': '$1', '2': 'se.id', '3': '$2', '4': '$3' })[n]!,
        );
        const attendance = await db.query(
          `${cte} SELECT count(*)::int AS schedules,
          count(*) FILTER(WHERE a."checkedInAt" IS NOT NULL)::int AS present,
          count(*) FILTER(WHERE a.status='LEAVE')::int AS leave,
          count(*) FILTER(WHERE a.status='MISSING' AND a."checkedInAt" IS NULL)::int AS absent,
          sum(a."overtimeMinutes") FILTER(WHERE a."recordedMinutes" IS NOT NULL) AS "overtimeMinutes",
          sum(a."recordedMinutes") FILTER(WHERE a."overtimeMinutes" IS NOT NULL) AS "recordedMinutes"
          FROM selected_employees se CROSS JOIN LATERAL (${ledger}) a
          WHERE a."attendanceKind"<>'OFF' AND a."endsAt"<=now()`,
          params,
        );
        const a = attendance.rows[0];
        const attendanceMetrics = {
          ...a,
          attendanceRate: ratio(a.schedules ? a.present : null, a.schedules),
          absenteeismRate: ratio(a.schedules ? a.absent : null, a.schedules),
          leaveRate: ratio(a.schedules ? a.leave : null, a.schedules),
          // Null when no shift supplies an overtime rule or no recorded work duration exists.
          overtimeRate: ratio(
            a.overtimeMinutes === null ? null : Number(a.overtimeMinutes),
            a.recordedMinutes === null ? null : Number(a.recordedMinutes),
          ),
        };
        let cost = null;
        if (financial) {
          const current = await payrollTotals(db, cte, params, range.grain);
          const previousParams = [...params];
          previousParams[1] = range.compareStartDate;
          previousParams[2] = range.compareEndDate;
          const previous = await payrollTotals(db, cte, previousParams, range.grain);
          // Journal lines are department-attributed, not employee-attributed.
          const journalParams = [
            identity.orgId,
            range.startDate,
            range.endDate,
            range.departmentId ?? null,
            range.branchId ?? null,
          ];
          const journal = await db.query(
            `WITH RECURSIVE branch(id) AS (
            SELECT id FROM departments WHERE organization_id=$1 AND id=$5::uuid
            UNION SELECT d.id FROM departments d JOIN branch b ON d.parent_id=b.id WHERE d.organization_id=$1
          ) SELECT count(*)::int AS records,
            max(j.updated_at) AS "updatedAt",
            sum(l.debit_amount-l.credit_amount) FILTER(WHERE a.type='EXPENSE')::text AS recognized,
            sum(l.credit_amount-l.debit_amount) FILTER(WHERE a.type='LIABILITY')::text AS "liabilityMovement"
            FROM payroll_journal_entry_lines l JOIN payroll_journal_entries j ON j.id=l.entry_id AND j.organization_id=l.organization_id
            JOIN accounting_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
            WHERE l.organization_id=$1 AND j.status IN ('POSTED','REVERSED') AND j.entry_date BETWEEN $2::date AND $3::date
            AND ($4::uuid IS NULL OR l.department_id=$4) AND ($5::uuid IS NULL OR l.department_id IN(SELECT id FROM branch))`,
            journalParams,
          );
          const anomalies = await db.query(
            `${cte} SELECT c.anomaly_code AS code,c.severity,c.resolution_status AS status,
            count(*)::int AS count FROM compliance_anomalies c
            WHERE c.organization_id=$1 AND c.resolution_status IN ('OPEN','ACKNOWLEDGED')
              AND c.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
              AND c.created_at < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')
              AND (EXISTS(SELECT 1 FROM selected_employees e WHERE e.id=c.employee_id)
                OR (c.employee_id IS NULL AND $${params.length - 1}::uuid IS NULL AND $${params.length}::uuid IS NULL))
            GROUP BY c.anomaly_code,c.severity,c.resolution_status ORDER BY c.severity,c.anomaly_code`,
            params,
          );
          cost = {
            current,
            previous,
            journal: journal.rows[0],
            anomalies: anomalies.rows,
            costPerEmployee: costPerEmployee(journal.rows[0].recognized, current.employees),
            grossChangePercent: moneyChangePercent(current.gross, previous.gross),
            // No budget or recruitment source is registered in this repository.
            budget: null,
          };
        }
        const snapshot = await db.query(
          `SELECT now() AS "generatedAt",(now() AT TIME ZONE 'Asia/Bangkok')::date::text AS "snapshotDate"`,
        );
        return {
          ...snapshot.rows[0],
          range,
          departments,
          workforce: workforce.rows[0],
          structure: structure.rows,
          attendance: attendanceMetrics,
          cost,
          lifecycle: {
            ...lifecycleKpis({ opening: null, closing: null, departures: null, retained: null }),
            departures: null,
          },
          capabilities: {
            financial,
            audit: identity.role === 'ADMIN',
            historicalEmployment: false,
            recruitment: false,
            budget: false,
          },
        };
      });
      await audit(pool, 'EXECUTIVE_ANALYTICS_VIEWED', identity.userId, identity.orgId, undefined, {
        filters: range,
        financial,
      });
      res.set('Cache-Control', 'no-store').json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get(`${prefix}/audit`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req, true);
      const q = z
        .object({
          startDate: day,
          endDate: day,
          actorId: z.uuid().optional(),
          action: z.string().trim().min(1).max(120).optional(),
          target: z.string().trim().min(1).max(120).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        })
        .strict()
        .parse(req.query);
      parseAnalyticsRange({ startDate: q.startDate, endDate: q.endDate });
      // Return safe event headers only; raw metadata may contain personal/payroll data.
      const sql = `WITH events AS (
        SELECT id,event_type AS action,actor_user_id AS actor,
          COALESCE(metadata->>'employeeId',metadata->>'periodId',metadata->>'reportId',subject_user_id::text) AS target,
          'AUTH_HR_PAY'::text AS source,created_at AS at FROM auth_audit_events WHERE organization_id=$1
        UNION ALL SELECT id,action,performed_by,target_id::text,'COMPLIANCE',created_at FROM compliance_audit_logs WHERE organization_id=$1
        UNION ALL SELECT id,'REPORT_EXPORTED',exported_by,report_code,'REPORTING',exported_at FROM report_export_audit_logs WHERE organization_id=$1
      ), filtered AS (SELECT * FROM events WHERE at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bangkok')
        AND at < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        AND ($4::uuid IS NULL OR actor=$4) AND ($5::text IS NULL OR action=$5)
        AND ($6::text IS NULL OR target=$6))`;
      const params = [
        identity.orgId,
        q.startDate,
        q.endDate,
        q.actorId ?? null,
        q.action ?? null,
        q.target ?? null,
      ];
      const result = await transaction(async (db) => {
        await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const count = await db.query(`${sql} SELECT count(*)::int AS total FROM filtered`, params);
        const rows = await db.query(
          `${sql} SELECT id,action,actor,target,source,at FROM filtered ORDER BY at DESC,id DESC,source LIMIT $7 OFFSET $8`,
          [...params, q.limit, (q.page - 1) * q.limit],
        );
        return { items: rows.rows, total: count.rows[0].total, page: q.page, limit: q.limit };
      });
      await audit(pool, 'EXECUTIVE_AUDIT_VIEWED', identity.userId, identity.orgId, undefined, {
        filters: q,
      });
      res.set('Cache-Control', 'no-store').json(result);
    } catch (err) {
      next(err);
    }
  });
}
