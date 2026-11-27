// Payroll, variance, cost allocation, liabilities and journal reports (split from reporting.ts, behavior unchanged).
import type { Express } from 'express';
import { escapeLike } from './organization-structure.js';
import { fail, type Authed } from './types.js';
import {
  uuid,
  canAccessReport,
  toCents,
  toDecimal,
  buildEmployeeScopeClause,
  type QueryParameter,
  type JournalLineSummary,
} from './reporting-shared.js';
import type { ReportingContext } from './reporting-context.js';

export function registerPayrollReportRoutes(app: Express, ctx: ReportingContext) {
  const { pool, prefix, identityFor } = ctx;

  // =========================================================================
  // 6. P0 REPORT: RPT-PAY-01 (PAYROLL SUMMARY & SLIP REGISTER)
  // =========================================================================

  app.get(`${prefix}/payroll-summary`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'MANAGER')) fail(403, 'FORBIDDEN');

      let periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : undefined;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      // If no periodId supplied, resolve latest period
      if (!periodId) {
        const latestPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId],
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({
          period: null,
          metrics: {
            totalSlips: 0,
            totalGross: '0.00',
            totalNet: '0.00',
            totalDeductions: '0.00',
            totalAllowances: '0.00',
            totalBonuses: '0.00',
            totalStandardDays: 0,
            totalActualDays: 0,
          },
          pagination: { page, pageSize, totalRows: 0, totalPages: 1 },
          items: [],
        });
      }

      const periodRes = await pool.query<{
        id: string;
        code: string;
        name: string;
        start_date: string;
        end_date: string;
        payment_date: string | null;
        standard_working_days: string;
        status: string;
      }>(
        `SELECT id, code, name, start_date::text, end_date::text, payment_date::text, standard_working_days::text, status
         FROM payroll_periods
         WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId],
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      const params: QueryParameter[] = [identity.orgId, periodId];
      let paramIdx = 3;

      const scope = await buildEmployeeScopeClause(pool, identity, paramIdx);
      params.push(...scope.params);
      paramIdx = scope.nextIndex;

      let whereClause = `s.organization_id = $1 AND s.period_id = $2 AND ${scope.clause}`;
      if (departmentId) {
        whereClause += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (search) {
        whereClause += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      // Aggregate overall metrics using exact bigint cents
      const aggQuery = `
        SELECT
          count(*)::int AS total_slips,
          COALESCE(sum(s.base_salary), 0)::text AS sum_base,
          COALESCE(sum(s.prorated_base_salary), 0)::text AS sum_prorated,
          COALESCE(sum(s.gross_pay), 0)::text AS sum_gross,
          COALESCE(sum(s.total_deductions), 0)::text AS sum_deductions,
          COALESCE(sum(s.net_pay), 0)::text AS sum_net,
          COALESCE(sum(s.standard_days), 0)::numeric(10,1) AS sum_standard_days,
          COALESCE(sum(s.actual_working_days), 0)::numeric(10,1) AS sum_actual_days,
          COALESCE((
            SELECT sum(i.amount)
            FROM payroll_slip_items i
            JOIN payroll_slips sp ON sp.id = i.slip_id AND sp.organization_id = i.organization_id
            WHERE sp.period_id = $2 AND sp.organization_id = $1 AND i.type = 'ALLOWANCE'
          ), 0)::text AS sum_allowances,
          COALESCE((
            SELECT sum(i.amount)
            FROM payroll_slip_items i
            JOIN payroll_slips sp ON sp.id = i.slip_id AND sp.organization_id = i.organization_id
            WHERE sp.period_id = $2 AND sp.organization_id = $1 AND i.type = 'BONUS'
          ), 0)::text AS sum_bonuses
        FROM payroll_slips s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        WHERE ${whereClause}
      `;
      const aggRes = await pool.query(aggQuery, params);
      const agg = aggRes.rows[0];

      // List query paginated
      const listParams = [...params, pageSize, offset];
      const listQuery = `
        SELECT
          s.id AS slip_id,
          e.employee_code,
          e.full_name,
          d.name AS department_name,
          p.title AS position_title,
          s.base_salary::text AS base_salary,
          s.prorated_base_salary::text AS prorated_base_salary,
          s.standard_days::text AS standard_days,
          s.actual_working_days::text AS actual_days,
          s.gross_pay::text AS gross_pay,
          s.total_deductions::text AS total_deductions,
          s.net_pay::text AS net_pay,
          s.status,
          COALESCE((
            SELECT sum(i.amount)
            FROM payroll_slip_items i
            WHERE i.slip_id = s.id AND i.organization_id = s.organization_id AND i.type = 'ALLOWANCE'
          ), 0)::text AS allowances_amount,
          COALESCE((
            SELECT sum(i.amount)
            FROM payroll_slip_items i
            WHERE i.slip_id = s.id AND i.organization_id = s.organization_id AND i.type = 'BONUS'
          ), 0)::text AS bonuses_amount
        FROM payroll_slips s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
        WHERE ${whereClause}
        ORDER BY e.employee_code ASC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const listRes = await pool.query(listQuery, listParams);

      const totalSlips = agg?.total_slips || 0;

      res.json({
        period: {
          id: period.id,
          code: period.code,
          name: period.name,
          startDate: period.start_date,
          endDate: period.end_date,
          paymentDate: period.payment_date,
          standardWorkingDays: parseFloat(period.standard_working_days || '22'),
          status: period.status,
          isDraft: period.status !== 'CLOSED',
        },
        metrics: {
          totalSlips,
          totalGross: toDecimal(toCents(agg?.sum_gross || '0')),
          totalNet: toDecimal(toCents(agg?.sum_net || '0')),
          totalDeductions: toDecimal(toCents(agg?.sum_deductions || '0')),
          totalAllowances: toDecimal(toCents(agg?.sum_allowances || '0')),
          totalBonuses: toDecimal(toCents(agg?.sum_bonuses || '0')),
          totalStandardDays: parseFloat(agg?.sum_standard_days || '0'),
          totalActualDays: parseFloat(agg?.sum_actual_days || '0'),
        },
        pagination: {
          page,
          pageSize,
          totalRows: totalSlips,
          totalPages: Math.ceil(totalSlips / pageSize) || 1,
        },
        items: listRes.rows.map((r) => ({
          slipId: r.slip_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name || 'Chưa phân bổ',
          positionTitle: r.position_title || 'Chưa phân bổ',
          baseSalary: toDecimal(toCents(r.base_salary)),
          proratedBaseSalary: toDecimal(toCents(r.prorated_base_salary)),
          standardDays: parseFloat(r.standard_days || '0'),
          actualDays: parseFloat(r.actual_days || '0'),
          grossPay: toDecimal(toCents(r.gross_pay)),
          allowancesAmount: toDecimal(toCents(r.allowances_amount)),
          bonusesAmount: toDecimal(toCents(r.bonuses_amount)),
          deductionsAmount: toDecimal(toCents(r.total_deductions)),
          netPay: toDecimal(toCents(r.net_pay)),
          status: r.status,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 7. P1 REPORT: RPT-PAY-02 (SALARY COMPONENTS & DEDUCTIONS BREAKDOWN)
  // =========================================================================

  app.get(`${prefix}/payroll-components`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      let periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const componentType = req.query.componentType
        ? String(req.query.componentType).toUpperCase()
        : undefined;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;

      if (!periodId) {
        const latestPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId],
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({
          period: null,
          metrics: {
            totalAllowances: '0.00',
            totalBonuses: '0.00',
            totalDeductions: '0.00',
            taxableAllowances: '0.00',
            nonTaxableAllowances: '0.00',
          },
          items: [],
        });
      }

      const periodRes = await pool.query<{
        id: string;
        code: string;
        name: string;
        status: string;
      }>(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId],
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      const params: QueryParameter[] = [identity.orgId, periodId];
      let paramIdx = 3;

      let where = `i.organization_id = $1 AND s.period_id = $2`;
      if (departmentId) {
        where += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (componentType && ['ALLOWANCE', 'BONUS', 'DEDUCTION'].includes(componentType)) {
        where += ` AND i.type = $${paramIdx++}`;
        params.push(componentType);
      }

      const query = `
        SELECT
          i.component_name,
          i.type,
          sum(i.amount)::text AS total_amount,
          count(DISTINCT i.slip_id)::int AS recipient_count
        FROM payroll_slip_items i
        JOIN payroll_slips s ON s.id = i.slip_id AND s.organization_id = i.organization_id
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        WHERE ${where}
        GROUP BY i.component_name, i.type
        ORDER BY i.type ASC, sum(i.amount) DESC
      `;
      const resRows = await pool.query(query, params);

      let allowanceCents = 0n;
      let bonusCents = 0n;
      let deductionCents = 0n;
      let taxableAllowanceCents = 0n;
      let nonTaxableAllowanceCents = 0n;

      const items = resRows.rows.map((r) => {
        const amtCents = toCents(r.total_amount);
        const nameLower = r.component_name.toLowerCase();
        const isNonTaxable = /ăn trưa|xăng xe|đồng phục|trang phục|công tác phí|điện thoại/i.test(
          nameLower,
        );

        if (r.type === 'ALLOWANCE') {
          allowanceCents += amtCents;
          if (isNonTaxable) {
            nonTaxableAllowanceCents += amtCents;
          } else {
            taxableAllowanceCents += amtCents;
          }
        } else if (r.type === 'BONUS') {
          bonusCents += amtCents;
        } else if (r.type === 'DEDUCTION') {
          deductionCents += amtCents;
        }

        return {
          componentName: r.component_name,
          type: r.type,
          totalAmount: toDecimal(amtCents),
          recipientCount: r.recipient_count,
          isTaxable: r.type === 'ALLOWANCE' ? !isNonTaxable : true,
        };
      });

      res.json({
        period: {
          id: period.id,
          code: period.code,
          name: period.name,
          status: period.status,
          isDraft: period.status !== 'CLOSED',
        },
        metrics: {
          totalAllowances: toDecimal(allowanceCents),
          totalBonuses: toDecimal(bonusCents),
          totalDeductions: toDecimal(deductionCents),
          taxableAllowances: toDecimal(taxableAllowanceCents),
          nonTaxableAllowances: toDecimal(nonTaxableAllowanceCents),
        },
        items,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 8. P1 REPORT: RPT-PAY-03 (PAYROLL VARIANCE & MOM TREND)
  // =========================================================================

  app.get(`${prefix}/payroll-variance`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      const curParam = req.query.periodId || req.query.currentPeriodId;
      const compParam = req.query.comparePeriodId || req.query.previousPeriodId;
      let periodId = curParam ? uuid.parse(curParam) : undefined;
      let comparePeriodId = compParam ? uuid.parse(compParam) : undefined;

      if (!periodId) {
        const latestPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId],
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({ current: null, compare: null, variance: null, anomalousEmployees: [] });
      }

      const curPeriodRes = await pool.query<{
        id: string;
        code: string;
        name: string;
        start_date: string;
        status: string;
      }>(
        `SELECT id, code, name, start_date::text, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId],
      );
      if (!curPeriodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const curPeriod = curPeriodRes.rows[0];

      // If comparePeriodId not specified, take the one directly before start_date
      if (!comparePeriodId) {
        const compPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods
           WHERE organization_id = $1 AND start_date < $2::date
           ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId, curPeriod.start_date],
        );
        if (compPeriodRes.rowCount && compPeriodRes.rows[0]) {
          comparePeriodId = compPeriodRes.rows[0].id;
        }
      }

      // Query totals for current period
      const curSummary = await pool.query<{
        headcount: number;
        sum_gross: string;
        sum_net: string;
        sum_deductions: string;
      }>(
        `SELECT
           count(*)::int AS headcount,
           COALESCE(sum(gross_pay), 0)::text AS sum_gross,
           COALESCE(sum(net_pay), 0)::text AS sum_net,
           COALESCE(sum(total_deductions), 0)::text AS sum_deductions
         FROM payroll_slips
         WHERE organization_id = $1 AND period_id = $2`,
        [identity.orgId, periodId],
      );
      const cur = curSummary.rows[0] || {
        headcount: 0,
        sum_gross: '0',
        sum_net: '0',
        sum_deductions: '0',
      };

      let comp: { headcount: number; sum_gross: string; sum_net: string; sum_deductions: string } =
        {
          headcount: 0,
          sum_gross: '0',
          sum_net: '0',
          sum_deductions: '0',
        };
      let compPeriod = null;

      if (comparePeriodId) {
        const compPeriodRow = await pool.query<{
          id: string;
          code: string;
          name: string;
          status: string;
        }>(
          `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
          [comparePeriodId, identity.orgId],
        );
        if (compPeriodRow.rowCount && compPeriodRow.rows[0]) {
          compPeriod = compPeriodRow.rows[0];
          const compRes = await pool.query<{
            headcount: number;
            sum_gross: string;
            sum_net: string;
            sum_deductions: string;
          }>(
            `SELECT
               count(*)::int AS headcount,
               COALESCE(sum(gross_pay), 0)::text AS sum_gross,
               COALESCE(sum(net_pay), 0)::text AS sum_net,
               COALESCE(sum(total_deductions), 0)::text AS sum_deductions
             FROM payroll_slips
             WHERE organization_id = $1 AND period_id = $2`,
            [identity.orgId, comparePeriodId],
          );
          comp = compRes.rows[0] || comp;
        }
      }

      const curGrossCents = toCents(cur.sum_gross);
      const compGrossCents = toCents(comp.sum_gross);
      const grossDeltaCents = curGrossCents - compGrossCents;
      const grossPercent =
        compGrossCents > 0n
          ? parseFloat(((Number(grossDeltaCents) / Number(compGrossCents)) * 100).toFixed(2))
          : 0;

      const curNetCents = toCents(cur.sum_net);
      const compNetCents = toCents(comp.sum_net);
      const netDeltaCents = curNetCents - compNetCents;
      const netPercent =
        compNetCents > 0n
          ? parseFloat(((Number(netDeltaCents) / Number(compNetCents)) * 100).toFixed(2))
          : 0;

      const curDedCents = toCents(cur.sum_deductions);
      const compDedCents = toCents(comp.sum_deductions);
      const dedDeltaCents = curDedCents - compDedCents;
      const dedPercent =
        compDedCents > 0n
          ? parseFloat(((Number(dedDeltaCents) / Number(compDedCents)) * 100).toFixed(2))
          : 0;

      const hcDelta = cur.headcount - comp.headcount;
      const hcPercent =
        comp.headcount > 0 ? parseFloat(((hcDelta / comp.headcount) * 100).toFixed(1)) : 0;

      // Employee variances and anomaly detection (variance >= 20%)
      const anomalousQuery = `
        SELECT
          e.employee_code,
          e.full_name,
          d.name AS department_name,
          s_cur.gross_pay::text AS current_gross,
          s_comp.gross_pay::text AS compare_gross,
          s_cur.net_pay::text AS current_net,
          s_comp.net_pay::text AS compare_net
        FROM payroll_slips s_cur
        JOIN employees e ON e.id = s_cur.employee_id AND e.organization_id = s_cur.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN payroll_slips s_comp ON s_comp.employee_id = s_cur.employee_id AND s_comp.period_id = $3 AND s_comp.organization_id = s_cur.organization_id
        WHERE s_cur.organization_id = $1 AND s_cur.period_id = $2
        ORDER BY e.employee_code ASC
      `;
      const anomRes = await pool.query(anomalousQuery, [
        identity.orgId,
        periodId,
        comparePeriodId || '00000000-0000-0000-0000-000000000000',
      ]);
      const evaluatedEmployees = [];
      const anomalousEmployees = [];

      for (const row of anomRes.rows) {
        if (!row.compare_gross) continue;
        const curAmt = toCents(row.current_gross);
        const compAmt = toCents(row.compare_gross);
        const curNet = toCents(row.current_net);
        const compNet = toCents(row.compare_net);
        const diff = curNet - compNet;
        let percent = 0;
        if (compNet > 0n) {
          percent = parseFloat(((Number(diff) / Number(compNet)) * 100).toFixed(1));
        } else if (curNet > 0n) {
          percent = 100;
        }
        const isAnomalous = Math.abs(percent) >= 20;

        const empItem = {
          employeeCode: row.employee_code,
          fullName: row.full_name,
          departmentName: row.department_name || 'Chưa phân bổ',
          previousGross: toDecimal(compAmt),
          currentGross: toDecimal(curAmt),
          previousNetPay: toDecimal(compNet),
          currentNetPay: toDecimal(curNet),
          variancePercent: percent,
          percentChange: percent,
          isAnomalous,
        };

        evaluatedEmployees.push(empItem);
        if (isAnomalous) {
          anomalousEmployees.push(empItem);
        }
      }

      const previousPeriod = compPeriod
        ? {
            id: compPeriod.id,
            code: compPeriod.code,
            name: compPeriod.name,
            status: compPeriod.status,
            headcount: comp.headcount,
            totalGross: toDecimal(compGrossCents),
            totalNet: toDecimal(compNetCents),
            totalDeductions: toDecimal(compDedCents),
          }
        : null;

      res.json({
        currentPeriod: {
          id: curPeriod.id,
          code: curPeriod.code,
          name: curPeriod.name,
          status: curPeriod.status,
          headcount: cur.headcount,
          totalGross: toDecimal(curGrossCents),
          totalNet: toDecimal(curNetCents),
          totalDeductions: toDecimal(curDedCents),
        },
        comparePeriod: previousPeriod,
        previousPeriod,
        variance: {
          headcountDelta: hcDelta,
          headcountPercent: hcPercent,
          grossDelta: toDecimal(grossDeltaCents),
          grossPercent,
          netDelta: toDecimal(netDeltaCents),
          netPercent,
          deductionsDelta: toDecimal(dedDeltaCents),
          deductionsPercent: dedPercent,
        },
        metrics: {
          currentGrossTotal: toDecimal(curGrossCents),
          previousGrossTotal: toDecimal(compGrossCents),
          grossDelta: toDecimal(grossDeltaCents),
          grossVariancePercent: grossPercent,
          currentNetTotal: toDecimal(curNetCents),
          previousNetTotal: toDecimal(compNetCents),
          netDelta: toDecimal(netDeltaCents),
          netVariancePercent: netPercent,
          currentHeadcount: cur.headcount,
          previousHeadcount: comp.headcount,
          headcountDelta: hcDelta,
          anomalousCount: anomalousEmployees.length,
        },
        anomalousEmployees,
        items: evaluatedEmployees,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 9. P0 REPORT: RPT-ACC-01 (DEPARTMENTAL COST ALLOCATION & ACCRUAL)
  // =========================================================================

  app.get(`${prefix}/cost-allocation`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      let periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;

      if (!periodId) {
        const latestPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId],
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({ period: null, metrics: null, departments: [] });
      }

      const periodRes = await pool.query<{
        id: string;
        code: string;
        name: string;
        status: string;
      }>(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId],
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      const params: QueryParameter[] = [identity.orgId, periodId];
      let where = `s.organization_id = $1 AND s.period_id = $2`;
      if (departmentId) {
        where += ` AND e.department_id = $3`;
        params.push(departmentId);
      }

      // Group slips by department
      const deptCostQuery = `
        SELECT
          COALESCE(d.id, '00000000-0000-0000-0000-000000000000') AS department_id,
          COALESCE(d.code, 'UNASSIGNED') AS department_code,
          COALESCE(d.name, 'Chưa phân bổ') AS department_name,
          count(s.id)::int AS headcount,
          sum(s.gross_pay)::text AS total_gross
        FROM payroll_slips s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        WHERE ${where}
        GROUP BY d.id, d.code, d.name
        ORDER BY sum(s.gross_pay) DESC
      `;
      const deptRes = await pool.query(deptCostQuery, params);

      let orgGrossCents = 0n;
      let orgEmployerSiCents = 0n;
      let orgEmployerUnionCents = 0n;
      let orgCtcCents = 0n;
      let totalHeadcount = 0;

      const departments = deptRes.rows.map((d) => {
        const grossCents = toCents(d.total_gross);
        // Employer statutory insurance = 21.5% (17.5% BHXH + 3% BHYT + 1% BHTN)
        const employerSiCents = (grossCents * 215n) / 1000n;
        // Trade union fee = 2%
        const unionCents = (grossCents * 20n) / 1000n;
        const totalCtcCents = grossCents + employerSiCents + unionCents;

        orgGrossCents += grossCents;
        orgEmployerSiCents += employerSiCents;
        orgEmployerUnionCents += unionCents;
        orgCtcCents += totalCtcCents;
        totalHeadcount += d.headcount;

        const codeLower = d.department_code.toLowerCase();
        const isSales = /sale|kinh doanh|marketing/i.test(codeLower);
        const vasCode = isSales ? '6421' : '6422';
        const vasLabel = isSales ? 'Chi phí bán hàng' : 'Chi phí quản lý doanh nghiệp';

        return {
          departmentId: d.department_id,
          departmentCode: d.department_code,
          departmentName: d.department_name,
          headcount: d.headcount,
          grossSalary: toDecimal(grossCents),
          employerInsurance: toDecimal(employerSiCents),
          employerUnion: toDecimal(unionCents),
          totalCostToCompany: toDecimal(totalCtcCents),
          vasAccount: vasCode,
          vasAccountCode: vasCode,
          vasAccountName: vasLabel,
          vasAccountFull: `${vasCode} - ${vasLabel}`,
        };
      });

      const costPerEmployeeCents = totalHeadcount > 0 ? orgCtcCents / BigInt(totalHeadcount) : 0n;

      res.json({
        period: {
          id: period.id,
          code: period.code,
          name: period.name,
          status: period.status,
          isDraft: period.status !== 'CLOSED',
        },
        metrics: {
          totalHeadcount,
          totalGross: toDecimal(orgGrossCents),
          totalGrossSalary: toDecimal(orgGrossCents),
          totalEmployerInsurance: toDecimal(orgEmployerSiCents),
          totalEmployerStatutory: toDecimal(orgEmployerSiCents),
          totalEmployerUnion: toDecimal(orgEmployerUnionCents),
          totalTradeUnion: toDecimal(orgEmployerUnionCents),
          totalCostToCompany: toDecimal(orgCtcCents),
          totalCompanyCost: toDecimal(orgCtcCents),
          costPerEmployee: toDecimal(costPerEmployeeCents),
        },
        departments,
        allocations: departments.map((d) => ({
          ...d,
          employerStatutory: d.employerInsurance,
          tradeUnion: d.employerUnion,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 10. P0 REPORT: RPT-ACC-02 (PAYROLL LIABILITIES & RECONCILIATION)
  // =========================================================================

  app.get(`${prefix}/payroll-liabilities`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      let periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const status = req.query.status ? String(req.query.status).toUpperCase() : 'ALL';

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      if (!periodId) {
        const latestPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId],
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({
          period: null,
          metrics: null,
          pagination: { page, pageSize, totalRows: 0, totalPages: 1 },
          items: [],
        });
      }

      const periodRes = await pool.query<{
        id: string;
        code: string;
        name: string;
        status: string;
      }>(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId],
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      // 1. Overall liability (Có 3341)
      const liabRes = await pool.query<{ total_payable: string }>(
        `SELECT COALESCE(sum(net_pay), 0)::text AS total_payable
         FROM payroll_slips
         WHERE organization_id = $1 AND period_id = $2`,
        [identity.orgId, periodId],
      );
      const payableLiabilityCents = toCents(liabRes.rows[0]?.total_payable || '0');

      // 2. Total disbursed payments (Nợ 3341 / Có 1121, 1111)
      const disbRes = await pool.query<{ total_disbursed: string; count: number }>(
        `SELECT COALESCE(sum(amount), 0)::text AS total_disbursed, count(*)::int AS count
         FROM payroll_disbursements
         WHERE organization_id = $1 AND period_id = $2`,
        [identity.orgId, periodId],
      );
      const disbursedPaymentCents = toCents(disbRes.rows[0]?.total_disbursed || '0');
      const remainingLiabilityCents =
        payableLiabilityCents > disbursedPaymentCents
          ? payableLiabilityCents - disbursedPaymentCents
          : 0n;

      const settlementRate =
        payableLiabilityCents > 0n
          ? parseFloat(
              ((Number(disbursedPaymentCents) / Number(payableLiabilityCents)) * 100).toFixed(1),
            )
          : 100;

      // 3. Employee breakdown with bank details and disbursement sums
      const empQuery = `
        SELECT
          e.id AS employee_id,
          e.employee_code,
          e.full_name,
          d.name AS department_name,
          s.net_pay::text AS net_pay,
          COALESCE(e.bank_account_number, '') AS bank_account_number,
          COALESCE(e.bank_name, '') AS bank_name,
          COALESCE((
            SELECT sum(disb.amount)
            FROM payroll_disbursements disb
            WHERE disb.employee_id = e.id AND disb.period_id = s.period_id AND disb.organization_id = s.organization_id
          ), 0)::text AS total_paid
        FROM payroll_slips s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        WHERE s.organization_id = $1 AND s.period_id = $2
        ORDER BY e.employee_code ASC
      `;
      const empRes = await pool.query(empQuery, [identity.orgId, periodId]);

      const processedItems = [];
      for (const row of empRes.rows) {
        const netCents = toCents(row.net_pay);
        const paidCents = toCents(row.total_paid);
        const remainCents = netCents > paidCents ? netCents - paidCents : 0n;

        let settlementStatus = 'UNPAID';
        if (paidCents >= netCents && netCents > 0n) {
          settlementStatus = 'PAID';
        } else if (paidCents > 0n) {
          settlementStatus = 'PARTIAL';
        }

        if (status === 'ALL' || !status || settlementStatus === status) {
          processedItems.push({
            employeeId: row.employee_id,
            employeeCode: row.employee_code,
            fullName: row.full_name,
            departmentName: row.department_name || 'Chưa phân bổ',
            bankAccountNumber: row.bank_account_number || '—',
            bankName: row.bank_name || '—',
            netPayable: toDecimal(netCents),
            totalPaid: toDecimal(paidCents),
            remainingBalance: toDecimal(remainCents),
            settlementStatus,
          });
        }
      }

      const totalFiltered = processedItems.length;
      const paginatedItems = processedItems.slice(offset, offset + pageSize);

      res.json({
        period: {
          id: period.id,
          code: period.code,
          name: period.name,
          status: period.status,
          isDraft: period.status !== 'CLOSED',
        },
        metrics: {
          payableLiability: toDecimal(payableLiabilityCents),
          disbursedPayment: toDecimal(disbursedPaymentCents),
          remainingLiability: toDecimal(remainingLiabilityCents),
          disbursementCount: disbRes.rows[0]?.count || 0,
          settlementRate,
        },
        pagination: {
          page,
          pageSize,
          totalRows: totalFiltered,
          totalPages: Math.ceil(totalFiltered / pageSize) || 1,
        },
        items: paginatedItems,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 11. P1 REPORT: RPT-ACC-03 (GENERAL LEDGER JOURNAL ENTRIES)
  // =========================================================================

  app.get(`${prefix}/journal-entries`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      const periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
      const accountId = req.query.accountId ? uuid.parse(req.query.accountId) : undefined;

      const params: QueryParameter[] = [identity.orgId];
      let paramIdx = 2;

      let where = `e.organization_id = $1`;
      if (periodId) {
        where += ` AND e.period_id = $${paramIdx++}`;
        params.push(periodId);
      }
      if (status && ['DRAFT', 'POSTED', 'REVERSED'].includes(status)) {
        where += ` AND e.status = $${paramIdx++}`;
        params.push(status);
      }

      const entriesQuery = `
        SELECT
          e.id,
          e.entry_number,
          e.entry_date::text AS entry_date,
          e.status,
          e.total_debit::text AS total_debit,
          e.total_credit::text AS total_credit,
          e.description,
          p.code AS period_code,
          u_post.full_name AS posted_by_name,
          e.posted_at::text AS posted_at,
          u_rev.full_name AS reversed_by_name,
          e.reversed_at::text AS reversed_at,
          rev.entry_number AS reversal_entry_number
        FROM payroll_journal_entries e
        JOIN payroll_periods p ON p.id = e.period_id AND p.organization_id = e.organization_id
        LEFT JOIN users u_post ON u_post.id = e.posted_by
        LEFT JOIN users u_rev ON u_rev.id = e.reversed_by
        LEFT JOIN payroll_journal_entries rev ON rev.id = e.reversal_entry_id
        WHERE ${where}
        ORDER BY e.entry_date DESC, e.entry_number DESC
      `;
      const entriesRes = await pool.query(entriesQuery, params);

      // Fetch lines for these entries
      const entryIds = entriesRes.rows.map((r) => r.id);
      const linesMap = new Map<string, JournalLineSummary[]>();

      if (entryIds.length > 0) {
        let linesWhere = `l.entry_id = ANY($1::uuid[]) AND l.organization_id = $2`;
        const linesParams: QueryParameter[] = [entryIds, identity.orgId];
        if (accountId) {
          linesWhere += ` AND l.account_id = $3`;
          linesParams.push(accountId);
        }

        const linesQuery = `
          SELECT
            l.id,
            l.entry_id,
            l.account_id,
            a.code AS account_code,
            a.name AS account_name,
            a.type AS account_type,
            d.name AS department_name,
            l.debit_amount::text AS debit_amount,
            l.credit_amount::text AS credit_amount,
            l.description,
            l.line_order
          FROM payroll_journal_entry_lines l
          JOIN accounting_accounts a ON a.id = l.account_id AND a.organization_id = l.organization_id
          LEFT JOIN departments d ON d.id = l.department_id AND d.organization_id = l.organization_id
          WHERE ${linesWhere}
          ORDER BY l.entry_id ASC, l.line_order ASC
        `;
        const linesRes = await pool.query(linesQuery, linesParams);
        for (const line of linesRes.rows) {
          const arr = linesMap.get(line.entry_id) || [];
          arr.push({
            id: line.id,
            accountCode: line.account_code,
            accountName: line.account_name,
            accountType: line.account_type,
            departmentName: line.department_name || '—',
            debitAmount: toDecimal(toCents(line.debit_amount)),
            creditAmount: toDecimal(toCents(line.credit_amount)),
            description: line.description || '',
            lineOrder: line.line_order,
          });
          linesMap.set(line.entry_id, arr);
        }
      }

      let totalDebitCents = 0n;
      let totalCreditCents = 0n;
      let postedCount = 0;
      let draftCount = 0;
      let reversedCount = 0;

      const items = entriesRes.rows.map((r) => {
        const debitCents = toCents(r.total_debit);
        const creditCents = toCents(r.total_credit);
        totalDebitCents += debitCents;
        totalCreditCents += creditCents;

        if (r.status === 'POSTED') postedCount++;
        else if (r.status === 'DRAFT') draftCount++;
        else if (r.status === 'REVERSED') reversedCount++;

        return {
          id: r.id,
          entryNumber: r.entry_number,
          entryDate: r.entry_date,
          status: r.status,
          totalDebit: toDecimal(debitCents),
          totalCredit: toDecimal(creditCents),
          description: r.description || '',
          periodCode: r.period_code,
          postedByName: r.posted_by_name || '—',
          postedAt: r.posted_at,
          reversedByName: r.reversed_by_name || '—',
          reversedAt: r.reversed_at,
          reversalEntryNumber: r.reversal_entry_number || null,
          lines: linesMap.get(r.id) || [],
        };
      });

      res.json({
        metrics: {
          totalEntries: items.length,
          postedEntries: postedCount,
          draftEntries: draftCount,
          reversedEntries: reversedCount,
          totalDebit: toDecimal(totalDebitCents),
          totalCredit: toDecimal(totalCreditCents),
          isBalanced: totalDebitCents === totalCreditCents,
        },
        items,
      });
    } catch (err) {
      next(err);
    }
  });
}
