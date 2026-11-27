// PIT, insurance and labor utilization reports (split from reporting.ts, behavior unchanged).
import type { Express } from 'express';
import { escapeLike } from './organization-structure.js';
import { calculatePitTax } from './payroll-compliance.js';
import { fail, type Authed } from './types.js';
import {
  uuid,
  DEFAULT_PIT_BRACKETS,
  ANNUAL_PIT_BRACKETS,
  canAccessReport,
  toCents,
  toDecimal,
  type QueryParameter,
  type ReportPeriod,
  type PayrollSlipItemRow,
} from './reporting-shared.js';
import type { ReportingContext } from './reporting-context.js';

export function registerTaxInsuranceReportRoutes(app: Express, ctx: ReportingContext) {
  const { pool, prefix, identityFor } = ctx;

  // =========================================================================
  // 12. P0 REPORT: RPT-TAX-01 (PIT WITHHOLDING & SUMMARY 05/KK-TNCN)
  // =========================================================================

  app.get(`${prefix}/tax-summary`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      let periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : '';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      let period: ReportPeriod;
      if (periodId) {
        const pRes = await pool.query<ReportPeriod>(
          `SELECT id, code, name, status, start_date::text AS start_date, end_date::text AS end_date
           FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
          [periodId, identity.orgId],
        );
        const selectedPeriod = pRes.rows[0];
        if (!selectedPeriod) fail(404, 'PERIOD_NOT_FOUND');
        period = selectedPeriod;
      } else {
        const pRes = await pool.query<ReportPeriod>(
          `SELECT id, code, name, status, start_date::text AS start_date, end_date::text AS end_date
           FROM payroll_periods WHERE organization_id = $1
           ORDER BY (status = 'CLOSED') DESC, end_date DESC LIMIT 1`,
          [identity.orgId],
        );
        const selectedPeriod = pRes.rows[0];
        if (!selectedPeriod) {
          return res.json({
            period: null,
            metrics: {
              totalEmployees: 0,
              taxableEmployees: 0,
              totalGrossIncome: '0.00',
              totalTaxableIncome: '0.00',
              totalPersonalDeductions: '0.00',
              totalDependentDeductions: '0.00',
              totalInsuranceDeductions: '0.00',
              totalPitWithheld: '0.00',
              totalSlipPit: '0.00',
              varianceAmount: '0.00',
              isReconciled: true,
            },
            pagination: { page: 1, pageSize, totalRows: 0, totalPages: 0 },
            items: [],
          });
        }
        period = selectedPeriod;
        periodId = period.id;
      }

      const params: QueryParameter[] = [
        identity.orgId,
        period.id,
        period.start_date,
        period.end_date,
      ];
      let paramIdx = 5;

      let filterWhere = '';
      if (departmentId) {
        filterWhere += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (search) {
        filterWhere += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      const slipsRes = await pool.query(
        `SELECT
          s.id AS slip_id, s.employee_id, s.gross_pay, s.net_pay, s.total_deductions,
          e.employee_code, e.full_name, d.name AS department_name,
          COALESCE((
            SELECT count(*)::int FROM employee_dependents ed
            WHERE ed.employee_id = s.employee_id AND ed.organization_id = s.organization_id
              AND ed.is_verified = true
              AND ed.effective_from <= $4::date
              AND (ed.effective_to IS NULL OR ed.effective_to >= $3::date)
          ), 0) AS dependent_count
        FROM payroll_slips s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        WHERE s.organization_id = $1 AND s.period_id = $2 ${filterWhere}
        ORDER BY e.employee_code ASC`,
        params,
      );

      const slipIds = slipsRes.rows.map((r) => r.slip_id);
      const itemsMap = new Map<string, PayrollSlipItemRow[]>();
      if (slipIds.length > 0) {
        const iRes = await pool.query<PayrollSlipItemRow>(
          `SELECT slip_id, component_name, type, amount
           FROM payroll_slip_items
           WHERE organization_id = $1 AND slip_id = ANY($2::uuid[])`,
          [identity.orgId, slipIds],
        );
        for (const item of iRes.rows) {
          const arr = itemsMap.get(item.slip_id) || [];
          arr.push(item);
          itemsMap.set(item.slip_id, arr);
        }
      }

      let totalGrossCents = 0n;
      let totalTaxableCents = 0n;
      let totalPersonalCents = 0n;
      let totalDependentCents = 0n;
      let totalInsuranceCents = 0n;
      let totalPitWithheldCents = 0n;
      let totalSlipPitCents = 0n;
      let totalVarianceCents = 0n;
      let taxableCount = 0;

      const items = slipsRes.rows.map((r) => {
        const grossCents = toCents(r.gross_pay);
        const slipItems = itemsMap.get(r.slip_id) || [];

        let nonTaxableCents = 0n;
        let insuranceCents = 0n;
        let slipPitCents = 0n;

        for (const it of slipItems) {
          const amt = toCents(it.amount);
          const nameLower = (it.component_name || '').toLowerCase();
          if (
            it.type === 'ALLOWANCE' &&
            (nameLower.includes('ăn trưa') || nameLower.includes('lunch'))
          ) {
            nonTaxableCents += amt > 730_000_00n ? 730_000_00n : amt;
          } else if (it.type === 'DEDUCTION') {
            if (
              nameLower.includes('bhxh') ||
              nameLower.includes('bhyt') ||
              nameLower.includes('bhtn') ||
              nameLower.includes('bảo hiểm')
            ) {
              insuranceCents += amt;
            } else if (
              nameLower.includes('thuế') ||
              nameLower.includes('pit') ||
              nameLower.includes('tncn')
            ) {
              slipPitCents += amt;
            }
          }
        }

        const taxableCents = grossCents > nonTaxableCents ? grossCents - nonTaxableCents : 0n;
        const personalCents = 11_000_000_00n;
        const dependentCents = BigInt(r.dependent_count) * 4_400_000_00n;
        const totalDeductionsCents = personalCents + dependentCents + insuranceCents;
        const assessableCents =
          taxableCents > totalDeductionsCents ? taxableCents - totalDeductionsCents : 0n;

        const computedPitCents = calculatePitTax(assessableCents, DEFAULT_PIT_BRACKETS);
        const varianceCents = computedPitCents - slipPitCents;

        totalGrossCents += grossCents;
        totalTaxableCents += taxableCents;
        totalPersonalCents += personalCents;
        totalDependentCents += dependentCents;
        totalInsuranceCents += insuranceCents;
        totalPitWithheldCents += computedPitCents;
        totalSlipPitCents += slipPitCents;
        totalVarianceCents += varianceCents < 0n ? -varianceCents : varianceCents;
        if (assessableCents > 0n) taxableCount++;

        return {
          slipId: r.slip_id,
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name,
          grossIncome: toDecimal(grossCents),
          nonTaxableAllowances: toDecimal(nonTaxableCents),
          taxableIncome: toDecimal(taxableCents),
          dependentCount: r.dependent_count,
          personalDeduction: toDecimal(personalCents),
          dependentDeduction: toDecimal(dependentCents),
          insuranceDeduction: toDecimal(insuranceCents),
          totalDeductions: toDecimal(totalDeductionsCents),
          assessableIncome: toDecimal(assessableCents),
          computedPit: toDecimal(computedPitCents),
          slipPit: toDecimal(slipPitCents),
          variance: toDecimal(varianceCents),
        };
      });

      const totalRows = items.length;
      const paginatedItems = items.slice(offset, offset + pageSize);

      res.json({
        period: {
          id: period.id,
          code: period.code,
          name: period.name,
          status: period.status,
          isDraft: period.status !== 'CLOSED',
        },
        metrics: {
          totalEmployees: totalRows,
          taxableEmployees: taxableCount,
          totalGrossIncome: toDecimal(totalGrossCents),
          totalTaxableIncome: toDecimal(totalTaxableCents),
          totalPersonalDeductions: toDecimal(totalPersonalCents),
          totalDependentDeductions: toDecimal(totalDependentCents),
          totalInsuranceDeductions: toDecimal(totalInsuranceCents),
          totalPitWithheld: toDecimal(totalPitWithheldCents),
          totalSlipPit: toDecimal(totalSlipPitCents),
          varianceAmount: toDecimal(totalVarianceCents),
          isReconciled: totalVarianceCents === 0n,
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1,
        },
        items: paginatedItems,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 13. P0 REPORT: RPT-TAX-02 (ANNUAL PIT SETTLEMENT 05/QTT-TNCN)
  // =========================================================================

  app.get(`${prefix}/tax-settlement`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      const taxYear = req.query.year
        ? parseInt(String(req.query.year), 10)
        : new Date().getFullYear();
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : '';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      const yearStart = `${taxYear}-01-01`;
      const yearEnd = `${taxYear}-12-31`;

      const params: QueryParameter[] = [identity.orgId, yearStart, yearEnd];
      let paramIdx = 4;

      let filterWhere = '';
      if (departmentId) {
        filterWhere += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (search) {
        filterWhere += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      const rowsRes = await pool.query(
        `SELECT
          e.id AS employee_id, e.employee_code, e.full_name, d.name AS department_name,
          ec.contract_type, ec.start_date AS contract_start, ec.end_date AS contract_end,
          COALESCE(count(DISTINCT p.id), 0)::int AS months_worked,
          COALESCE(sum(s.gross_pay), 0.00) AS annual_gross,
          COALESCE(sum(s.total_deductions), 0.00) AS annual_deductions,
          COALESCE((
            SELECT count(*)::int FROM employee_dependents ed
            WHERE ed.employee_id = e.id AND ed.organization_id = e.organization_id
              AND ed.is_verified = true
              AND ed.effective_from <= $3::date
              AND (ed.effective_to IS NULL OR ed.effective_to >= $2::date)
          ), 0) AS dependent_count
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.organization_id = e.organization_id AND ec.status = 'ACTIVE'
        JOIN payroll_slips s ON s.employee_id = e.id AND s.organization_id = e.organization_id
        JOIN payroll_periods p ON p.id = s.period_id AND p.organization_id = s.organization_id
          AND p.start_date >= $2::date AND p.end_date <= $3::date
        WHERE e.organization_id = $1 ${filterWhere}
        GROUP BY e.id, e.employee_code, e.full_name, d.name, ec.contract_type, ec.start_date, ec.end_date
        ORDER BY e.employee_code ASC`,
        params,
      );

      let totalIndividuals = 0;
      let authorizedProxyCount = 0;
      let totalAnnualGrossCents = 0n;
      let totalAnnualDeductionsCents = 0n;
      let totalTaxWithheldCents = 0n;
      let totalAnnualTaxLiabilityCents = 0n;
      let totalRefundableCents = 0n;
      let totalAdditionalPayableCents = 0n;

      const processed = rowsRes.rows.map((r) => {
        const annualGrossCents = toCents(r.annual_gross);
        const months = Math.min(12, Math.max(1, r.months_worked || 12));
        const personalCents = BigInt(months) * 11_000_000_00n;
        const dependentCents = BigInt(months) * BigInt(r.dependent_count) * 4_400_000_00n;

        const insuranceCents = toCents(r.annual_deductions);
        const annualDeductionsCents = personalCents + dependentCents + insuranceCents;
        const assessableCents =
          annualGrossCents > annualDeductionsCents ? annualGrossCents - annualDeductionsCents : 0n;

        const annualTaxLiabilityCents = calculatePitTax(assessableCents, ANNUAL_PIT_BRACKETS);
        const taxWithheldCents = annualTaxLiabilityCents;
        const balanceCents = annualTaxLiabilityCents - taxWithheldCents;

        if (balanceCents > 0n) totalAdditionalPayableCents += balanceCents;
        else if (balanceCents < 0n) totalRefundableCents += -balanceCents;

        const isAuthorizedProxy =
          r.contract_type === 'INDEFINITE' || r.contract_type === 'FIXED_TERM';
        if (isAuthorizedProxy) authorizedProxyCount++;

        let settlementStatus = 'BALANCED';
        if (balanceCents > 0n) settlementStatus = 'ADDITIONAL_PAYABLE';
        else if (balanceCents < 0n) settlementStatus = 'REFUNDABLE';

        totalIndividuals++;
        totalAnnualGrossCents += annualGrossCents;
        totalAnnualDeductionsCents += annualDeductionsCents;
        totalTaxWithheldCents += taxWithheldCents;
        totalAnnualTaxLiabilityCents += annualTaxLiabilityCents;

        return {
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name,
          contractType: r.contract_type || 'INDEFINITE',
          monthsWorked: months,
          annualGross: toDecimal(annualGrossCents),
          annualDeductions: toDecimal(annualDeductionsCents),
          annualAssessable: toDecimal(assessableCents),
          annualTaxLiability: toDecimal(annualTaxLiabilityCents),
          taxWithheld: toDecimal(taxWithheldCents),
          balance: toDecimal(balanceCents),
          settlementStatus,
          isAuthorizedProxy,
        };
      });

      const totalRows = processed.length;
      const paginatedItems = processed.slice(offset, offset + pageSize);
      const netBalanceCents = totalAdditionalPayableCents - totalRefundableCents;

      res.json({
        year: taxYear,
        metrics: {
          totalIndividuals,
          totalEmployees: totalIndividuals,
          residentEmployees: totalIndividuals,
          qualifyingEmployees: authorizedProxyCount,
          authorizedProxyCount,
          totalAnnualGross: toDecimal(totalAnnualGrossCents),
          totalAnnualDeductions: toDecimal(totalAnnualDeductionsCents),
          totalPersonalDeductions: toDecimal(BigInt(totalIndividuals) * 12n * 11_000_000_00n),
          totalTaxWithheld: toDecimal(totalTaxWithheldCents),
          totalAnnualTaxLiability: toDecimal(totalAnnualTaxLiabilityCents),
          netBalance: toDecimal(netBalanceCents),
          totalRefundable: toDecimal(totalRefundableCents),
          totalAdditionalPayable: toDecimal(totalAdditionalPayableCents),
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1,
        },
        items: paginatedItems,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 14. P0 REPORT: RPT-INS-01 (STATUTORY INSURANCE REMITTANCE)
  // =========================================================================

  app.get(`${prefix}/insurance-contributions`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      let periodId = req.query.periodId ? uuid.parse(req.query.periodId) : undefined;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : '';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      let period: ReportPeriod;
      if (periodId) {
        const pRes = await pool.query<ReportPeriod>(
          `SELECT id, code, name, status, start_date::text AS start_date, end_date::text AS end_date
           FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
          [periodId, identity.orgId],
        );
        const selectedPeriod = pRes.rows[0];
        if (!selectedPeriod) fail(404, 'PERIOD_NOT_FOUND');
        period = selectedPeriod;
      } else {
        const pRes = await pool.query<ReportPeriod>(
          `SELECT id, code, name, status, start_date::text AS start_date, end_date::text AS end_date
           FROM payroll_periods WHERE organization_id = $1
           ORDER BY (status = 'CLOSED') DESC, end_date DESC LIMIT 1`,
          [identity.orgId],
        );
        const selectedPeriod = pRes.rows[0];
        if (!selectedPeriod) {
          return res.json({
            period: null,
            metrics: {
              totalInsuredEmployees: 0,
              totalEmployees: 0,
              totalContractSalary: '0.00',
              totalCappedSiSalary: '0.00',
              totalCappedUiSalary: '0.00',
              totalSiFund: '0.00',
              totalEmployeeInsurance: '0.00',
              employeeTotalCents: '0.00',
              totalEmployerInsurance: '0.00',
              employerTotalCents: '0.00',
              totalTradeUnion: '0.00',
              unionTotalCents: '0.00',
              grandTotalContribution: '0.00',
              totalStatutoryRemittance: '0.00',
              isReconciled: true,
            },
            pagination: { page: 1, pageSize, totalRows: 0, totalPages: 0 },
            items: [],
          });
        }
        period = selectedPeriod;
        periodId = period.id;
      }

      const params: QueryParameter[] = [identity.orgId, period.id];
      let paramIdx = 3;

      let filterWhere = '';
      if (departmentId) {
        filterWhere += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (search) {
        filterWhere += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      const slipsRes = await pool.query(
        `SELECT
          s.id AS slip_id, s.employee_id, s.base_salary, s.prorated_base_salary, s.gross_pay,
          e.employee_code, e.full_name, d.name AS department_name,
          esi.si_code, esi.si_salary
        FROM payroll_slips s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN employee_social_insurance esi ON esi.employee_id = e.id AND esi.organization_id = e.organization_id AND esi.status = 'ACTIVE'
        WHERE s.organization_id = $1 AND s.period_id = $2 ${filterWhere}
        ORDER BY e.employee_code ASC`,
        params,
      );

      const siCapCents = 46_800_000_00n;
      const uiCapCents = 99_200_000_00n;

      let totalContractSalaryCents = 0n;
      let totalCappedSiCents = 0n;
      let totalCappedUiCents = 0n;
      let totalEmpCents = 0n;
      let totalEmprCents = 0n;
      let totalUnionCents = 0n;

      const processed = slipsRes.rows.map((r) => {
        const rawSalaryCents = r.si_salary ? toCents(r.si_salary) : toCents(r.base_salary);
        const cappedSiCents = rawSalaryCents > siCapCents ? siCapCents : rawSalaryCents;
        const cappedUiCents = rawSalaryCents > uiCapCents ? uiCapCents : rawSalaryCents;

        const empBhxhCents = (cappedSiCents * 800n) / 10000n;
        const empBhytCents = (cappedSiCents * 150n) / 10000n;
        const empBhtnCents = (cappedUiCents * 100n) / 10000n;
        const empTotalCents = empBhxhCents + empBhytCents + empBhtnCents;

        const emprBhxhCents = (cappedSiCents * 1750n) / 10000n;
        const emprBhytCents = (cappedSiCents * 300n) / 10000n;
        const emprBhtnCents = (cappedUiCents * 100n) / 10000n;
        const emprTotalCents = emprBhxhCents + emprBhytCents + emprBhtnCents;

        const unionCents = (cappedSiCents * 200n) / 10000n;
        const totalRemittanceCents = empTotalCents + emprTotalCents + unionCents;

        totalContractSalaryCents += rawSalaryCents;
        totalCappedSiCents += cappedSiCents;
        totalCappedUiCents += cappedUiCents;
        totalEmpCents += empTotalCents;
        totalEmprCents += emprTotalCents;
        totalUnionCents += unionCents;

        return {
          slipId: r.slip_id,
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name,
          siCode: r.si_code || '—',
          contractSalary: toDecimal(rawSalaryCents),
          siSalary: toDecimal(rawSalaryCents),
          employeeSiCents: toDecimal(empBhxhCents),
          empBhxh: toDecimal(empBhxhCents),
          employeeHiCents: toDecimal(empBhytCents),
          empBhyt: toDecimal(empBhytCents),
          employeeUiCents: toDecimal(empBhtnCents),
          empBhtn: toDecimal(empBhtnCents),
          employeeTotalCents: toDecimal(empTotalCents),
          employeeTotal: toDecimal(empTotalCents),
          employerTotalCents: toDecimal(emprTotalCents),
          employerTotal: toDecimal(emprTotalCents),
          unionTotalCents: toDecimal(unionCents),
          tradeUnionFee: toDecimal(unionCents),
          totalContributionCents: toDecimal(totalRemittanceCents),
          totalRemittance: toDecimal(totalRemittanceCents),
        };
      });

      const totalRows = processed.length;
      const paginatedItems = processed.slice(offset, offset + pageSize);
      const grandTotalRemittanceCents = totalEmpCents + totalEmprCents + totalUnionCents;

      res.json({
        period: {
          id: period.id,
          code: period.code,
          name: period.name,
          status: period.status,
          isDraft: period.status !== 'CLOSED',
        },
        metrics: {
          totalInsuredEmployees: totalRows,
          totalEmployees: totalRows,
          totalContractSalary: toDecimal(totalContractSalaryCents),
          totalCappedSiSalary: toDecimal(totalCappedSiCents),
          totalCappedUiSalary: toDecimal(totalCappedUiCents),
          totalSiFund: toDecimal(totalContractSalaryCents),
          totalEmployeeInsurance: toDecimal(totalEmpCents),
          employeeTotalCents: toDecimal(totalEmpCents),
          totalEmployerInsurance: toDecimal(totalEmprCents),
          employerTotalCents: toDecimal(totalEmprCents),
          totalTradeUnion: toDecimal(totalUnionCents),
          unionTotalCents: toDecimal(totalUnionCents),
          grandTotalContribution: toDecimal(grandTotalRemittanceCents),
          totalStatutoryRemittance: toDecimal(grandTotalRemittanceCents),
          isReconciled: true,
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1,
        },
        items: paginatedItems,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 15. P1 REPORT: RPT-INS-02 (INSURANCE PARTICIPATION FLUCTUATIONS D02-LT)
  // =========================================================================

  app.get(`${prefix}/insurance-fluctuations`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : '';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      const now = new Date();
      const reportingYear = req.query.year
        ? parseInt(String(req.query.year), 10)
        : now.getFullYear();
      const reportingMonth = req.query.month
        ? String(req.query.month).slice(0, 7)
        : `${reportingYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const params: QueryParameter[] = [
        identity.orgId,
        `${reportingYear}-01-01`,
        `${reportingYear}-12-31`,
      ];
      let paramIdx = 4;

      let filterWhere = '';
      if (departmentId) {
        filterWhere += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (search) {
        filterWhere += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      const rowsRes = await pool.query(
        `SELECT
          e.id AS employee_id, e.employee_code, e.full_name, e.hire_date::text AS hire_date,
          d.name AS department_name, pos.title AS position_title,
          esi.si_code,
          ec.start_date::text AS contract_start, ec.end_date::text AS contract_end, ec.status AS contract_status,
          COALESCE(esp.base_salary, 0.00) AS new_salary,
          CASE
            WHEN ec.start_date >= $2::date AND ec.start_date <= $3::date THEN 'INCREASE'
            WHEN ec.status = 'TERMINATED' OR (ec.end_date IS NOT NULL AND ec.end_date <= $3::date) THEN 'DECREASE'
            ELSE 'ADJUSTMENT'
          END AS fluctuation_type,
          COALESCE(ec.start_date::text, e.hire_date::text) AS effective_date,
          'Biến động tham gia BHXH theo quy định D02-LT' AS notes
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN positions pos ON pos.id = e.position_id AND pos.organization_id = e.organization_id
        LEFT JOIN employee_social_insurance esi ON esi.employee_id = e.id AND esi.organization_id = e.organization_id
        LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.organization_id = e.organization_id
        LEFT JOIN employee_salary_profiles esp ON esp.employee_id = e.id AND esp.organization_id = e.organization_id AND esp.status = 'ACTIVE'
        WHERE e.organization_id = $1 ${filterWhere}
        ORDER BY effective_date DESC, e.employee_code ASC`,
        params,
      );

      let increaseCount = 0;
      let decreaseCount = 0;
      let adjustmentCount = 0;

      const items = rowsRes.rows.map((r) => {
        if (r.fluctuation_type === 'INCREASE') increaseCount++;
        else if (r.fluctuation_type === 'DECREASE') decreaseCount++;
        else adjustmentCount++;

        return {
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name,
          positionTitle: r.position_title,
          siCode: r.si_code || '—',
          fluctuationType: r.fluctuation_type,
          effectiveDate: r.effective_date,
          newSalary: toDecimal(toCents(r.new_salary)),
          notes: r.notes,
        };
      });

      const totalRows = items.length;
      const paginatedItems = items.slice(offset, offset + pageSize);

      res.json({
        year: reportingYear,
        reportingMonth,
        metrics: {
          totalFluctuations: totalRows,
          increaseCount,
          decreaseCount,
          adjustmentCount,
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1,
        },
        items: paginatedItems,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 16. P1 REPORT: RPT-LAB-01 (PERIODIC LABOR UTILIZATION REPORT 01/PLI)
  // =========================================================================

  app.get(`${prefix}/labor-utilization`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'HR')) fail(403, 'FORBIDDEN');

      const year = req.query.year ? parseInt(String(req.query.year), 10) : new Date().getFullYear();
      const half = req.query.half === '1' ? 1 : 2;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : '';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      const periodStart = `${year}-01-01`;
      const periodEnd = half === 1 ? `${year}-06-30` : `${year}-12-31`;

      const params: QueryParameter[] = [identity.orgId];
      let paramIdx = 2;

      let filterWhere = '';
      if (departmentId) {
        filterWhere += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (search) {
        filterWhere += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      const empRes = await pool.query(
        `SELECT
          e.id AS employee_id, e.employee_code, e.full_name, e.hire_date::text AS hire_date,
          e.employment_status, d.name AS department_name, pos.title AS position_title,
          ec.contract_type, ec.contract_number, ec.start_date::text AS contract_start, ec.end_date::text AS contract_end
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN positions pos ON pos.id = e.position_id AND pos.organization_id = e.organization_id
        LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.organization_id = e.organization_id AND ec.status = 'ACTIVE'
        WHERE e.organization_id = $1 ${filterWhere}
        ORDER BY e.employee_code ASC`,
        params,
      );

      let beginningCount = 0;
      let increaseCount = 0;
      let decreaseCount = 0;
      let endingCount = 0;
      let indefiniteCount = 0;
      let fixedTermCount = 0;
      let probationCount = 0;
      let managerCount = 0;
      let professionalCount = 0;

      const items = empRes.rows.map((r) => {
        const hireDate = r.hire_date;
        const isHiredBefore = hireDate < periodStart;
        const isHiredDuring = hireDate >= periodStart && hireDate <= periodEnd;
        const isTerminated = r.employment_status === 'TERMINATED';

        if (isHiredBefore && !isTerminated) beginningCount++;
        if (isHiredDuring) increaseCount++;
        if (isTerminated) decreaseCount++;
        if (!isTerminated) endingCount++;

        if (r.contract_type === 'INDEFINITE') indefiniteCount++;
        else if (r.contract_type === 'FIXED_TERM') fixedTermCount++;
        else probationCount++;

        const titleLower = (r.position_title || '').toLowerCase();
        if (/giám đốc|trưởng|phó|manager|leader|director|head/.test(titleLower)) managerCount++;
        else if (/kỹ sư|lập trình|developer|engineer|chuyên viên|specialist/.test(titleLower))
          professionalCount++;

        return {
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          hireDate: r.hire_date,
          employmentStatus: r.employment_status,
          departmentName: r.department_name,
          positionTitle: r.position_title,
          contractType: r.contract_type,
          contractNumber: r.contract_number,
          positionGroup: /giám đốc|trưởng|phó|manager|leader|director|head/.test(titleLower)
            ? 'Nhà quản lý'
            : /kỹ sư|lập trình|developer|engineer|chuyên viên|specialist/.test(titleLower)
              ? 'Chuyên môn kỹ thuật'
              : 'Nhân viên khác',
        };
      });

      const totalRows = items.length;
      const paginatedItems = items.slice(offset, offset + pageSize);

      res.json({
        year,
        half,
        reportingPeriod:
          half === 1
            ? `6 tháng đầu năm ${year} (Mẫu 01/PLI - NĐ 145/2020/NĐ-CP)`
            : `Cả năm ${year} (Mẫu 01/PLI - NĐ 145/2020/NĐ-CP)`,
        metrics: {
          beginningHeadcount: beginningCount,
          increaseHeadcount: increaseCount,
          decreaseHeadcount: decreaseCount,
          newHires: increaseCount,
          terminations: decreaseCount,
          endingHeadcount: endingCount,
          contractBreakdown: {
            indefinite: indefiniteCount,
            fixedTerm: fixedTermCount,
            probation: probationCount,
          },
          positionBreakdown: {
            manager: managerCount,
            professional: professionalCount,
            other: endingCount - managerCount - professionalCount,
          },
          indefiniteContracts: indefiniteCount,
          fixedTermContracts: fixedTermCount,
          probationContracts: probationCount,
          managerCount,
          professionalCount,
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1,
        },
        items: paginatedItems,
      });
    } catch (err) {
      next(err);
    }
  });
}
