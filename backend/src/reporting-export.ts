// CSV export engine with audit logging (split from reporting.ts, behavior unchanged).
import type { Express, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { calculatePitTax } from './payroll-compliance.js';
import { fail, type Authed } from './types.js';
import {
  uuid,
  DEFAULT_PIT_BRACKETS,
  ANNUAL_PIT_BRACKETS,
  DEFAULT_REPORT_CATALOG,
  canAccessReport,
  toCents,
  toDecimal,
  buildEmployeeScopeClause,
  escapeCsvCell,
  type QueryParameter,
  type ReportPeriod,
  type PayrollSlipItemRow,
} from './reporting-shared.js';
import type { ReportingContext } from './reporting-context.js';

export function registerReportExportRoutes(app: Express, ctx: ReportingContext) {
  const { pool, audit, prefix, identityFor } = ctx;

  // =========================================================================
  // 6. SHARED REPORTING ENGINE: EXPORT TO CSV (WITH AUDIT LOGGING)
  // =========================================================================

  app.post(`${prefix}/export`, async (req: Authed, res: Response, next) => {
    try {
      const identity = identityFor(req);
      const schema = z.object({
        reportCode: z.enum([
          'RPT-EMP-01',
          'RPT-ORG-01',
          'RPT-ATT-01',
          'RPT-LEAVE-01',
          'RPT-PAY-01',
          'RPT-PAY-02',
          'RPT-PAY-03',
          'RPT-ACC-01',
          'RPT-ACC-02',
          'RPT-ACC-03',
          'RPT-TAX-01',
          'RPT-TAX-02',
          'RPT-INS-01',
          'RPT-INS-02',
          'RPT-LAB-01',
        ]),
        format: z.enum(['CSV', 'EXCEL', 'PDF', 'JSON']).default('CSV'),
        filters: z.record(z.string(), z.string()).default({}),
      });

      const body = schema.parse(req.body);
      const reportDef = DEFAULT_REPORT_CATALOG.find((r) => r.code === body.reportCode);
      if (!reportDef) throw fail(404, 'REPORT_NOT_FOUND');

      if (!canAccessReport(identity.role, reportDef.minRole)) {
        fail(403, 'FORBIDDEN');
      }

      let csvContent = '\uFEFF'; // UTF-8 BOM for Excel compatibility
      let rowCount = 0;
      const exportTime = new Date().toISOString();

      if (body.reportCode === 'RPT-EMP-01') {
        csvContent += `BÁO CÁO NHÂN SỰ & BIẾN ĐỘNG (RPT-EMP-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n`;
        csvContent += `Người xuất: ${identity.email} (${identity.role})\r\n\r\n`;

        const params: QueryParameter[] = [identity.orgId];
        const scope = await buildEmployeeScopeClause(pool, identity, 2);
        params.push(...scope.params);

        let where = `e.organization_id = $1 AND ${scope.clause}`;
        if (body.filters.departmentId) {
          params.push(body.filters.departmentId);
          where += ` AND e.department_id = $${params.length}`;
        }
        if (body.filters.status) {
          params.push(body.filters.status);
          where += ` AND e.employment_status = $${params.length}`;
        }

        const query = `
          SELECT
            e.employee_code, e.full_name, e.hire_date::text AS hire_date, e.employment_status,
            e.phone, e.personal_email, d.name AS department_name, p.title AS position_title,
            c.contract_type, c.contract_number,
            (EXTRACT(YEAR FROM age(CURRENT_DATE, e.hire_date)) * 12 + EXTRACT(MONTH FROM age(CURRENT_DATE, e.hire_date)))::int AS tenure_months
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
          LEFT JOIN positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
          LEFT JOIN LATERAL (
            SELECT contract_number, contract_type FROM employee_contracts c
            WHERE c.employee_id = e.id AND c.organization_id = e.organization_id AND c.status = 'ACTIVE'
            ORDER BY c.start_date DESC LIMIT 1
          ) c ON true
          WHERE ${where}
          ORDER BY e.employee_code ASC
        `;
        const result = await pool.query(query, params);
        rowCount = result.rows.length;

        csvContent += `Mã NV,Họ và tên,Phòng ban,Chức danh,Trạng thái,Loại hợp đồng,Số hợp đồng,Ngày vào làm,Thâm niên (tháng),Số điện thoại,Email\r\n`;
        for (const r of result.rows) {
          csvContent +=
            [
              escapeCsvCell(r.employee_code),
              escapeCsvCell(r.full_name),
              escapeCsvCell(r.department_name || 'Chưa phân bổ'),
              escapeCsvCell(r.position_title || 'Chưa phân bổ'),
              escapeCsvCell(r.employment_status),
              escapeCsvCell(r.contract_type || '—'),
              escapeCsvCell(r.contract_number || '—'),
              escapeCsvCell(r.hire_date),
              escapeCsvCell(r.tenure_months || 0),
              escapeCsvCell(r.phone || ''),
              escapeCsvCell(r.personal_email || ''),
            ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-ORG-01') {
        csvContent += `BÁO CÁO CƠ CẤU TỔ CHỨC & PHÒNG BAN (RPT-ORG-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n`;
        csvContent += `Người xuất: ${identity.email}\r\n\r\n`;

        const query = `
          SELECT
            d.code, d.name, p_dept.name AS parent_name, u.full_name AS manager_name,
            d.is_active,
            (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id AND e.organization_id = d.organization_id AND e.employment_status = 'ACTIVE') AS active_employees,
            (SELECT count(*)::int FROM positions p WHERE p.department_id = d.id AND p.organization_id = d.organization_id AND p.is_active = true) AS position_count
          FROM departments d
          LEFT JOIN departments p_dept ON p_dept.id = d.parent_id AND p_dept.organization_id = d.organization_id
          LEFT JOIN users u ON u.id = d.manager_user_id
          WHERE d.organization_id = $1
          ORDER BY d.code ASC
        `;
        const result = await pool.query(query, [identity.orgId]);
        rowCount = result.rows.length;

        csvContent += `Mã phòng ban,Tên phòng ban,Phòng ban cấp trên,Trưởng bộ phận,Trạng thái,Số nhân sự đang hoạt động,Số vị trí chức danh\r\n`;
        for (const r of result.rows) {
          csvContent +=
            [
              escapeCsvCell(r.code),
              escapeCsvCell(r.name),
              escapeCsvCell(r.parent_name || '—'),
              escapeCsvCell(r.manager_name || 'Chưa phân công'),
              escapeCsvCell(r.is_active ? 'Đang hoạt động' : 'Tạm dừng'),
              escapeCsvCell(r.active_employees),
              escapeCsvCell(r.position_count),
            ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-ATT-01') {
        csvContent += `BÁO CÁO TỔNG HỢP CHẤM CÔNG & CA LÀM VIỆC (RPT-ATT-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const startDate =
          body.filters.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const endDate = body.filters.endDate || new Date().toISOString().slice(0, 10);

        const params: QueryParameter[] = [identity.orgId, startDate, endDate];
        const scope = await buildEmployeeScopeClause(pool, identity, 4);
        params.push(...scope.params);

        const query = `
          SELECT
            s.work_date::text AS work_date, e.employee_code, e.full_name,
            d.name AS department_name, ws.name AS shift_name,
            s.starts_at::text AS starts_at, s.ends_at::text AS ends_at,
            p.checked_in_at::text AS checked_in_at, p.checked_out_at::text AS checked_out_at
          FROM work_schedule s
          JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
          LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
          LEFT JOIN work_shifts ws ON ws.id = s.shift_id AND ws.organization_id = s.organization_id
          LEFT JOIN attendance_punches p ON p.schedule_id = s.id AND p.organization_id = s.organization_id
          WHERE s.organization_id = $1 AND s.work_date >= $2 AND s.work_date <= $3 AND ${scope.clause}
          ORDER BY s.work_date DESC, e.employee_code ASC
        `;
        const result = await pool.query(query, params);
        rowCount = result.rows.length;

        csvContent += `Ngày làm việc,Mã NV,Họ và tên,Phòng ban,Ca làm việc,Giờ bắt đầu ca,Giờ kết thúc ca,Giờ vào thực tế,Giờ ra thực tế\r\n`;
        for (const r of result.rows) {
          csvContent +=
            [
              escapeCsvCell(r.work_date),
              escapeCsvCell(r.employee_code),
              escapeCsvCell(r.full_name),
              escapeCsvCell(r.department_name || 'Chưa phân bổ'),
              escapeCsvCell(r.shift_name || 'Ca chuẩn'),
              escapeCsvCell(r.starts_at),
              escapeCsvCell(r.ends_at),
              escapeCsvCell(r.checked_in_at || '—'),
              escapeCsvCell(r.checked_out_at || '—'),
            ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-LEAVE-01') {
        csvContent += `BÁO CÁO NGHỈ PHÉP & SỐ DƯ PHÉP (RPT-LEAVE-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: QueryParameter[] = [identity.orgId];
        const scope = await buildEmployeeScopeClause(pool, identity, 2);
        params.push(...scope.params);

        const query = `
          SELECT
            e.employee_code, e.full_name, d.name AS department_name, lt.name AS leave_type_name,
            COALESCE(lb.allowance_minutes, 0) AS allowance_minutes,
            COALESCE((
              SELECT sum(lr.charge_minutes)::int
              FROM leave_requests lr
              WHERE lr.employee_id = e.id AND lr.leave_type_id = lt.id AND lr.status = 'APPROVED'
            ), 0) AS charged_minutes
          FROM employees e
          CROSS JOIN leave_types lt
          LEFT JOIN leave_balances lb ON lb.employee_id = e.id AND lb.leave_type_id = lt.id AND lb.organization_id = e.organization_id
          LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
          WHERE e.organization_id = $1 AND lt.organization_id = e.organization_id AND lt.active = true AND ${scope.clause}
          ORDER BY e.employee_code ASC, lt.name ASC
        `;
        const result = await pool.query(query, params);
        rowCount = result.rows.length;

        csvContent += `Mã NV,Họ và tên,Phòng ban,Loại phép,Hạn mức (ngày),Đã sử dụng (ngày),Còn lại (ngày),Tỷ lệ sử dụng (%)\r\n`;
        for (const r of result.rows) {
          const allowance = r.allowance_minutes || 0;
          const charged = r.charged_minutes || 0;
          const remaining = Math.max(0, allowance - charged);
          const rate = allowance > 0 ? ((charged / allowance) * 100).toFixed(1) : '0';

          csvContent +=
            [
              escapeCsvCell(r.employee_code),
              escapeCsvCell(r.full_name),
              escapeCsvCell(r.department_name || 'Chưa phân bổ'),
              escapeCsvCell(r.leave_type_name),
              escapeCsvCell((allowance / 480).toFixed(2)),
              escapeCsvCell((charged / 480).toFixed(2)),
              escapeCsvCell((remaining / 480).toFixed(2)),
              escapeCsvCell(rate),
            ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-PAY-01') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId],
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{
            code: string;
            name: string;
            start_date: string;
            end_date: string;
            status: string;
          }>(
            `SELECT code, name, start_date::text, end_date::text, status
             FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId],
          );
          const p = periodRes.rows[0];
          csvContent += `BÁO CÁO BẢNG LƯƠNG TỔNG HỢP & CHI TIẾT THEO KỲ (RPT-PAY-01)\r\n`;
          csvContent += `Kỳ lương: ${p?.name || '—'} (${p?.start_date || '—'} - ${p?.end_date || '—'}) | Trạng thái: ${p?.status === 'CLOSED' ? 'ĐÃ CHỐT' : 'DỰ THẢO'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n`;
          csvContent += `Người xuất: ${identity.email}\r\n\r\n`;

          const params: QueryParameter[] = [identity.orgId, periodId];
          const scope = await buildEmployeeScopeClause(pool, identity, 3);
          params.push(...scope.params);

          let whereClause = `s.organization_id = $1 AND s.period_id = $2 AND ${scope.clause}`;
          if (body.filters.departmentId) {
            params.push(body.filters.departmentId);
            whereClause += ` AND e.department_id = $${params.length}`;
          }

          const slips = await pool.query<{
            employee_code: string;
            full_name: string;
            department_name: string | null;
            position_title: string | null;
            base_salary: string;
            prorated_base_salary: string;
            total_allowances: string;
            total_bonuses: string;
            total_deductions: string;
            gross_pay: string;
            net_pay: string;
            status: string;
          }>(
            `SELECT
              e.employee_code, e.full_name, d.name AS department_name, pos.title AS position_title,
              s.base_salary::text, s.prorated_base_salary::text,
              s.total_allowances::text, s.total_bonuses::text,
              s.total_deductions::text, s.gross_pay::text,
              s.net_pay::text, s.status
            FROM payroll_slips s
            JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
            LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
            LEFT JOIN positions pos ON pos.id = e.position_id AND pos.organization_id = e.organization_id
            WHERE ${whereClause}
            ORDER BY e.employee_code ASC`,
            params,
          );
          rowCount = slips.rows.length;

          csvContent += `Mã NV,Họ và tên,Phòng ban,Chức danh,Lương cơ bản (VND),Lương tính công (VND),Phụ cấp (VND),Thưởng (VND),Tổng thu nhập Gross (VND),Tổng khấu trừ (VND),Thực lĩnh Net (VND),Trạng thái phiếu\r\n`;
          for (const s of slips.rows) {
            csvContent +=
              [
                escapeCsvCell(s.employee_code),
                escapeCsvCell(s.full_name),
                escapeCsvCell(s.department_name || 'Chưa phân bổ'),
                escapeCsvCell(s.position_title || 'Chưa phân bổ'),
                escapeCsvCell(toDecimal(toCents(s.base_salary))),
                escapeCsvCell(toDecimal(toCents(s.prorated_base_salary))),
                escapeCsvCell(toDecimal(toCents(s.total_allowances))),
                escapeCsvCell(toDecimal(toCents(s.total_bonuses))),
                escapeCsvCell(toDecimal(toCents(s.gross_pay))),
                escapeCsvCell(toDecimal(toCents(s.total_deductions))),
                escapeCsvCell(toDecimal(toCents(s.net_pay))),
                escapeCsvCell(s.status),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-PAY-02') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId],
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId],
          );
          csvContent += `BÁO CÁO CƠ CẤU PHỤ CẤP, THƯỞNG & KHẤU TRỪ (RPT-PAY-02)\r\n`;
          csvContent += `Kỳ lương: ${periodRes.rows[0]?.name || '—'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

          const params: QueryParameter[] = [identity.orgId, periodId];
          const scope = await buildEmployeeScopeClause(pool, identity, 3);
          params.push(...scope.params);

          const itemsRes = await pool.query<{
            component_name: string;
            type: string;
            recipient_count: number;
            total_amount: string;
          }>(
            `SELECT
              it.component_name, it.type,
              count(DISTINCT it.slip_id)::int AS recipient_count,
              sum(it.amount)::text AS total_amount
            FROM payroll_slip_items it
            JOIN payroll_slips s ON s.id = it.slip_id AND s.organization_id = it.organization_id
            JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
            WHERE s.organization_id = $1 AND s.period_id = $2 AND ${scope.clause}
            GROUP BY it.component_name, it.type
            ORDER BY it.type ASC, sum(it.amount) DESC`,
            params,
          );
          rowCount = itemsRes.rows.length;

          csvContent += `Tên khoản mục,Phân loại,Tính chịu thuế,Số người nhận,Tổng số tiền (VND)\r\n`;
          for (const it of itemsRes.rows) {
            const nameLower = it.component_name.toLowerCase();
            const isNonTaxable =
              /ăn trưa|xăng xe|đồng phục|trang phục|công tác phí|điện thoại/i.test(nameLower);
            const taxableText =
              it.type === 'ALLOWANCE'
                ? isNonTaxable
                  ? 'Miễn thuế'
                  : 'Chịu thuế'
                : it.type === 'BONUS'
                  ? 'Chịu thuế'
                  : 'Khấu trừ';

            csvContent +=
              [
                escapeCsvCell(it.component_name),
                escapeCsvCell(it.type),
                escapeCsvCell(taxableText),
                escapeCsvCell(it.recipient_count),
                escapeCsvCell(toDecimal(toCents(it.total_amount))),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-PAY-03') {
        let currentPeriodId = body.filters.currentPeriodId
          ? uuid.parse(body.filters.currentPeriodId)
          : undefined;
        let previousPeriodId = body.filters.previousPeriodId
          ? uuid.parse(body.filters.previousPeriodId)
          : undefined;

        if (!currentPeriodId) {
          const latestTwo = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 2`,
            [identity.orgId],
          );
          if (latestTwo.rowCount && latestTwo.rows[0]) currentPeriodId = latestTwo.rows[0].id;
          if (latestTwo.rowCount && latestTwo.rows.length > 1 && !previousPeriodId)
            previousPeriodId = latestTwo.rows[1].id;
        }

        csvContent += `BÁO CÁO BIẾN ĐỘNG QUỸ LƯƠNG GIỮA CÁC KỲ (RPT-PAY-03)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        if (currentPeriodId) {
          const scope = await buildEmployeeScopeClause(pool, identity, 4);
          const currRes = await pool.query<{
            employee_id: string;
            employee_code: string;
            full_name: string;
            department_name: string | null;
            net_pay: string;
          }>(
            `SELECT s.employee_id, e.employee_code, e.full_name, d.name AS department_name, s.net_pay::text AS net_pay
             FROM payroll_slips s
             JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
             LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
             WHERE s.organization_id = $1 AND s.period_id = $2 AND ${scope.clause}
             ORDER BY e.employee_code ASC`,
            [identity.orgId, currentPeriodId, ...scope.params],
          );

          const prevMap = new Map<string, bigint>();
          if (previousPeriodId) {
            const prevRes = await pool.query<{ employee_id: string; net_pay: string }>(
              `SELECT s.employee_id, s.net_pay::text AS net_pay
               FROM payroll_slips s
               WHERE s.organization_id = $1 AND s.period_id = $2`,
              [identity.orgId, previousPeriodId],
            );
            for (const r of prevRes.rows) {
              prevMap.set(r.employee_id, toCents(r.net_pay));
            }
          }

          rowCount = currRes.rows.length;
          csvContent += `Mã NV,Họ và tên,Phòng ban,Thực lĩnh kỳ trước (VND),Thực lĩnh kỳ này (VND),Chênh lệch (VND),Tỷ lệ biến động (%),Cảnh báo\r\n`;
          for (const curr of currRes.rows) {
            const currNet = toCents(curr.net_pay);
            const prevNet = prevMap.get(curr.employee_id) || 0n;
            const diff = currNet - prevNet;
            let variancePct = 0;
            if (prevNet > 0n) {
              variancePct = Number((diff * 10000n) / prevNet) / 100;
            } else if (currNet > 0n) {
              variancePct = 100;
            }
            const isAnomaly = Math.abs(variancePct) >= 20;

            csvContent +=
              [
                escapeCsvCell(curr.employee_code),
                escapeCsvCell(curr.full_name),
                escapeCsvCell(curr.department_name || 'Chưa phân bổ'),
                escapeCsvCell(toDecimal(prevNet)),
                escapeCsvCell(toDecimal(currNet)),
                escapeCsvCell(toDecimal(diff)),
                escapeCsvCell(`${variancePct.toFixed(2)}%`),
                escapeCsvCell(isAnomaly ? 'BIẾN ĐỘNG MẠNH (>=20%)' : 'Bình thường'),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-ACC-01') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId],
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId],
          );
          csvContent += `BÁO CÁO PHÂN BỔ CHI PHÍ LƯƠNG THEO PHÒNG BAN & TÀI KHOẢN KẾ TOÁN (VAS) (RPT-ACC-01)\r\n`;
          csvContent += `Kỳ lương: ${periodRes.rows[0]?.name || '—'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

          const params: QueryParameter[] = [identity.orgId, periodId];
          const scope = await buildEmployeeScopeClause(pool, identity, 3);
          params.push(...scope.params);

          const deptRes = await pool.query<{
            department_code: string | null;
            department_name: string | null;
            headcount: number;
            gross_amount: string;
          }>(
            `SELECT
              d.code AS department_code, d.name AS department_name,
              count(s.id)::int AS headcount,
              sum(s.gross_pay)::text AS gross_amount
            FROM payroll_slips s
            JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
            LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
            WHERE s.organization_id = $1 AND s.period_id = $2 AND ${scope.clause}
            GROUP BY d.code, d.name
            ORDER BY d.name ASC NULLS LAST`,
            params,
          );
          rowCount = deptRes.rows.length;

          csvContent += `Mã phòng ban,Tên phòng ban,Tài khoản VAS,Tên tài khoản,Số nhân sự,Lương & phụ cấp (VND),BH bắt buộc DN 21.5% (VND),Kinh phí CĐ 2% (VND),Tổng chi phí CTC (VND)\r\n`;
          for (const d of deptRes.rows) {
            const grossCents = toCents(d.gross_amount);
            const statutoryCents = (grossCents * 215n) / 1000n;
            const unionCents = (grossCents * 20n) / 1000n;
            const ctcCents = grossCents + statutoryCents + unionCents;

            const deptCode = (d.department_code || '').toUpperCase();
            const vasAccount =
              deptCode.includes('SALE') || deptCode.includes('MKT') || deptCode.includes('KD')
                ? '6421'
                : '6422';
            const vasName = vasAccount === '6421' ? 'Chi phí bán hàng' : 'Chi phí quản lý DN';

            csvContent +=
              [
                escapeCsvCell(d.department_code || 'UNASSIGNED'),
                escapeCsvCell(d.department_name || 'Chưa phân bổ'),
                escapeCsvCell(vasAccount),
                escapeCsvCell(vasName),
                escapeCsvCell(d.headcount),
                escapeCsvCell(toDecimal(grossCents)),
                escapeCsvCell(toDecimal(statutoryCents)),
                escapeCsvCell(toDecimal(unionCents)),
                escapeCsvCell(toDecimal(ctcCents)),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-ACC-02') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId],
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId],
          );
          csvContent += `BÁO CÁO CÔNG NỢ LƯƠNG & ĐỐI CHIẾU THANH TOÁN (RPT-ACC-02)\r\n`;
          csvContent += `Kỳ lương: ${periodRes.rows[0]?.name || '—'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

          const params: QueryParameter[] = [identity.orgId, periodId];
          const scope = await buildEmployeeScopeClause(pool, identity, 3);
          params.push(...scope.params);

          const slipsRes = await pool.query<{
            employee_id: string;
            employee_code: string;
            full_name: string;
            department_name: string | null;
            net_pay: string;
          }>(
            `SELECT s.employee_id, e.employee_code, e.full_name, d.name AS department_name, s.net_pay::text AS net_pay
             FROM payroll_slips s
             JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
             LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
             WHERE s.organization_id = $1 AND s.period_id = $2 AND ${scope.clause}
             ORDER BY e.employee_code ASC`,
            params,
          );

          const disbRes = await pool.query<{ employee_id: string; disbursed_amount: string }>(
            `SELECT employee_id, sum(amount)::text AS disbursed_amount
             FROM payroll_disbursements
             WHERE organization_id = $1 AND period_id = $2 AND status = 'COMPLETED'
             GROUP BY employee_id`,
            [identity.orgId, periodId],
          );
          const disbMap = new Map<string, bigint>();
          for (const d of disbRes.rows) disbMap.set(d.employee_id, toCents(d.disbursed_amount));

          rowCount = slipsRes.rows.length;
          csvContent += `Mã NV,Họ và tên,Phòng ban,Phải trả người LĐ TK 3341 (VND),Đã thanh toán TK 1121/1111 (VND),Còn phải trả (VND),Trạng thái thanh toán\r\n`;
          for (const s of slipsRes.rows) {
            const payable = toCents(s.net_pay);
            const disbursed = disbMap.get(s.employee_id) || 0n;
            const remaining = payable > disbursed ? payable - disbursed : 0n;
            let status = 'Chưa thanh toán';
            if (disbursed >= payable && payable > 0n) status = 'Đã thanh toán đủ';
            else if (disbursed > 0n) status = 'Thanh toán một phần';

            csvContent +=
              [
                escapeCsvCell(s.employee_code),
                escapeCsvCell(s.full_name),
                escapeCsvCell(s.department_name || 'Chưa phân bổ'),
                escapeCsvCell(toDecimal(payable)),
                escapeCsvCell(toDecimal(disbursed)),
                escapeCsvCell(toDecimal(remaining)),
                escapeCsvCell(status),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-ACC-03') {
        const periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        const status = body.filters.status ? String(body.filters.status).toUpperCase() : undefined;

        csvContent += `BÁO CÁO SỔ NHẬT KÝ BÚT TOÁN KẾ TOÁN LƯƠNG (RPT-ACC-03)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: QueryParameter[] = [identity.orgId];
        let whereClause = `je.organization_id = $1`;
        if (periodId) {
          params.push(periodId);
          whereClause += ` AND je.period_id = $${params.length}`;
        }
        if (status && ['DRAFT', 'POSTED', 'REVERSED'].includes(status)) {
          params.push(status);
          whereClause += ` AND je.status = $${params.length}`;
        }

        const entriesRes = await pool.query<{
          id: string;
          entry_number: string;
          entry_date: string;
          description: string;
          status: string;
        }>(
          `SELECT id, entry_number, entry_date::text, description, status
           FROM payroll_journal_entries je
           WHERE ${whereClause}
           ORDER BY entry_date DESC, entry_number DESC`,
          params,
        );

        const entryIds = entriesRes.rows.map((r) => r.id);
        if (entryIds.length > 0) {
          const linesRes = await pool.query<{
            entry_id: string;
            account_code: string;
            account_name: string;
            debit_amount: string;
            credit_amount: string;
            department_name: string | null;
          }>(
            `SELECT
              jl.entry_id, a.code AS account_code, a.name AS account_name,
              jl.debit_amount::text, jl.credit_amount::text,
              d.name AS department_name
            FROM payroll_journal_entry_lines jl
            JOIN accounting_accounts a ON a.id = jl.account_id AND a.organization_id = jl.organization_id
            LEFT JOIN departments d ON d.id = jl.department_id AND d.organization_id = jl.organization_id
            WHERE jl.entry_id = ANY($1)
            ORDER BY jl.line_order ASC`,
            [entryIds],
          );

          const entryMap = new Map(entriesRes.rows.map((e) => [e.id, e]));
          rowCount = linesRes.rows.length;

          csvContent += `Số chứng từ,Ngày hạch toán,Diễn giải nghiệp vụ,Tài khoản,Tên tài khoản,Nợ/Có,Số tiền (VND),Phòng ban,Trạng thái chứng từ\r\n`;
          for (const l of linesRes.rows) {
            const entry = entryMap.get(l.entry_id);
            const deb = toCents(l.debit_amount);
            const cred = toCents(l.credit_amount);
            const direction = deb > 0n ? 'NỢ' : 'CÓ';
            const amount = deb > 0n ? deb : cred;

            csvContent +=
              [
                escapeCsvCell(entry?.entry_number || '—'),
                escapeCsvCell(entry?.entry_date || '—'),
                escapeCsvCell(entry?.description || '—'),
                escapeCsvCell(l.account_code),
                escapeCsvCell(l.account_name),
                escapeCsvCell(direction),
                escapeCsvCell(toDecimal(amount)),
                escapeCsvCell(l.department_name || 'Chung'),
                escapeCsvCell(entry?.status || '—'),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-TAX-01') {
        csvContent += `BÁO CÁO THUẾ THU NHẬP CÁ NHÂN ĐỊNH KỲ (RPT-TAX-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n`;
        csvContent += `Người xuất: ${identity.email} (${identity.role})\r\n\r\n`;

        const periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        let period: ReportPeriod | undefined;
        if (periodId) {
          const pRes = await pool.query(
            `SELECT id, code, name, status, start_date::text AS start_date, end_date::text AS end_date
             FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId],
          );
          if (pRes.rows.length > 0) period = pRes.rows[0];
        }
        if (!period) {
          const pRes = await pool.query(
            `SELECT id, code, name, status, start_date::text AS start_date, end_date::text AS end_date
             FROM payroll_periods WHERE organization_id = $1
             ORDER BY (status = 'CLOSED') DESC, end_date DESC LIMIT 1`,
            [identity.orgId],
          );
          if (pRes.rows.length > 0) period = pRes.rows[0];
        }

        if (period) {
          csvContent += `Kỳ thuế: ${period.name} (${period.code}) - Trạng thái: ${period.status}\r\n\r\n`;
          const params: QueryParameter[] = [
            identity.orgId,
            period.id,
            period.start_date,
            period.end_date,
          ];
          let where = 's.organization_id = $1 AND s.period_id = $2';
          if (body.filters.departmentId) {
            params.push(body.filters.departmentId);
            where += ` AND e.department_id = $${params.length}`;
          }

          const q = `
            SELECT
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
            WHERE ${where}
            ORDER BY e.employee_code ASC
          `;
          const slipsRes = await pool.query(q, params);
          rowCount = slipsRes.rows.length;

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

          csvContent += `Mã NV,Họ và tên,Phòng ban,Tổng thu nhập chịu thuế (VND),Giảm trừ bản thân (VND),Số người phụ thuộc,Giảm trừ người phụ thuộc (VND),Giảm trừ BH bắt buộc (VND),Thu nhập tính thuế (VND),Thuế TNCN khấu trừ (VND)\r\n`;
          for (const r of slipsRes.rows) {
            const grossCents = toCents(r.gross_pay);
            const slipItems = itemsMap.get(r.slip_id) || [];
            let nonTaxableCents = 0n;
            let insuranceCents = 0n;

            for (const it of slipItems) {
              const amt = toCents(it.amount);
              const nameLower = (it.component_name || '').toLowerCase();
              if (
                it.type === 'ALLOWANCE' &&
                (nameLower.includes('ăn trưa') || nameLower.includes('lunch'))
              ) {
                nonTaxableCents += amt > 730_000_00n ? 730_000_00n : amt;
              } else if (
                it.type === 'DEDUCTION' &&
                (nameLower.includes('bhxh') ||
                  nameLower.includes('bhyt') ||
                  nameLower.includes('bhtn') ||
                  nameLower.includes('bảo hiểm'))
              ) {
                insuranceCents += amt;
              }
            }

            const taxableCents = grossCents > nonTaxableCents ? grossCents - nonTaxableCents : 0n;
            const personalCents = 11_000_000_00n;
            const dependentCents = BigInt(r.dependent_count) * 4_400_000_00n;
            const totalDeductionsCents = personalCents + dependentCents + insuranceCents;
            const assessableCents =
              taxableCents > totalDeductionsCents ? taxableCents - totalDeductionsCents : 0n;
            const computedPitCents = calculatePitTax(assessableCents, DEFAULT_PIT_BRACKETS);

            csvContent +=
              [
                escapeCsvCell(r.employee_code),
                escapeCsvCell(r.full_name),
                escapeCsvCell(r.department_name || 'Chung'),
                escapeCsvCell(toDecimal(taxableCents)),
                escapeCsvCell(toDecimal(personalCents)),
                escapeCsvCell(r.dependent_count),
                escapeCsvCell(toDecimal(dependentCents)),
                escapeCsvCell(toDecimal(insuranceCents)),
                escapeCsvCell(toDecimal(assessableCents)),
                escapeCsvCell(toDecimal(computedPitCents)),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-TAX-02') {
        const taxYear = body.filters.year
          ? parseInt(String(body.filters.year), 10)
          : new Date().getFullYear();
        csvContent += `BÁO CÁO QUYẾT TOÁN THUẾ THU NHẬP CÁ NHÂN NĂM (RPT-TAX-02)\r\n`;
        csvContent += `Năm quyết toán: ${taxYear}\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: QueryParameter[] = [identity.orgId, `${taxYear}-01-01`, `${taxYear}-12-31`];
        let where = 'e.organization_id = $1';
        if (body.filters.departmentId) {
          params.push(body.filters.departmentId);
          where += ` AND e.department_id = $${params.length}`;
        }

        const rowsRes = await pool.query(
          `SELECT
            e.id AS employee_id, e.employee_code, e.full_name, d.name AS department_name,
            ec.contract_type,
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
          WHERE ${where}
          GROUP BY e.id, e.employee_code, e.full_name, d.name, ec.contract_type
          ORDER BY e.employee_code ASC`,
          params,
        );
        rowCount = rowsRes.rows.length;

        csvContent += `Mã NV,Họ và tên,Phòng ban,Loại HĐLĐ,Số tháng làm việc,Tổng thu nhập chịu thuế cả năm (VND),Tổng giảm trừ cả năm (VND),Thu nhập tính thuế cả năm (VND),Số thuế phải nộp (VND),Số thuế đã khấu trừ (VND),Chênh lệch thừa/thiếu (VND),Ủy quyền quyết toán\r\n`;
        for (const r of rowsRes.rows) {
          const annualGrossCents = toCents(r.annual_gross);
          const months = Math.min(12, Math.max(1, r.months_worked || 12));
          const personalCents = BigInt(months) * 11_000_000_00n;
          const dependentCents = BigInt(months) * BigInt(r.dependent_count) * 4_400_000_00n;
          const insuranceCents = toCents(r.annual_deductions);
          const annualDeductionsCents = personalCents + dependentCents + insuranceCents;
          const assessableCents =
            annualGrossCents > annualDeductionsCents
              ? annualGrossCents - annualDeductionsCents
              : 0n;

          const annualTaxLiabilityCents = calculatePitTax(assessableCents, ANNUAL_PIT_BRACKETS);
          const taxWithheldCents = annualTaxLiabilityCents;
          const balanceCents = annualTaxLiabilityCents - taxWithheldCents;
          const isAuthorizedProxy =
            r.contract_type === 'INDEFINITE' || r.contract_type === 'FIXED_TERM';

          csvContent +=
            [
              escapeCsvCell(r.employee_code),
              escapeCsvCell(r.full_name),
              escapeCsvCell(r.department_name || 'Chung'),
              escapeCsvCell(r.contract_type || '—'),
              escapeCsvCell(months),
              escapeCsvCell(toDecimal(annualGrossCents)),
              escapeCsvCell(toDecimal(annualDeductionsCents)),
              escapeCsvCell(toDecimal(assessableCents)),
              escapeCsvCell(toDecimal(annualTaxLiabilityCents)),
              escapeCsvCell(toDecimal(taxWithheldCents)),
              escapeCsvCell(toDecimal(balanceCents)),
              escapeCsvCell(isAuthorizedProxy ? 'Có' : 'Không'),
            ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-INS-01') {
        csvContent += `BÁO CÁO TRÍCH NỘP BHXH, BHYT, BHTN & KINH PHÍ CÔNG ĐOÀN (RPT-INS-01)\r\n`;
        csvContent += `Tỷ lệ trích nộp: Người lao động 10.5% | Doanh nghiệp 21.5% | Kinh phí CĐ 2.0% | Tổng cộng 34.0%\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n`;
        csvContent += `Người xuất: ${identity.email} (${identity.role})\r\n\r\n`;

        const periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        let period: ReportPeriod | undefined;
        if (periodId) {
          const pRes = await pool.query(
            `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId],
          );
          if (pRes.rows.length > 0) period = pRes.rows[0];
        }
        if (!period) {
          const pRes = await pool.query(
            `SELECT id, code, name, status FROM payroll_periods WHERE organization_id = $1
             ORDER BY (status = 'CLOSED') DESC, end_date DESC LIMIT 1`,
            [identity.orgId],
          );
          if (pRes.rows.length > 0) period = pRes.rows[0];
        }

        if (period) {
          csvContent += `Kỳ lương: ${period.name} (${period.code})\r\n\r\n`;
          const params: QueryParameter[] = [identity.orgId, period.id];
          let where = 's.organization_id = $1 AND s.period_id = $2';
          if (body.filters.departmentId) {
            params.push(body.filters.departmentId);
            where += ` AND e.department_id = $${params.length}`;
          }

          const q = `
            SELECT
              s.id AS slip_id, s.employee_id, s.base_salary, s.gross_pay,
              e.employee_code, e.full_name, d.name AS department_name,
              esi.si_code, esi.si_salary
            FROM payroll_slips s
            JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
            LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
            LEFT JOIN employee_social_insurance esi ON esi.employee_id = e.id AND esi.organization_id = e.organization_id AND esi.status = 'ACTIVE'
            WHERE ${where}
            ORDER BY e.employee_code ASC
          `;
          const slipsRes = await pool.query(q, params);
          rowCount = slipsRes.rows.length;

          const siCapCents = 46_800_000_00n;
          const uiCapCents = 99_200_000_00n;

          csvContent += `Mã NV,Họ và tên,Phòng ban,Mã số BHXH,Lương đóng BHXH (VND),Lương tính BHXH/BHYT sau trần (VND),Lương tính BHTN sau trần (VND),BHXH NLĐ 8% (VND),BHYT NLĐ 1.5% (VND),BHTN NLĐ 1% (VND),Tổng trừ NLĐ 10.5% (VND),BHXH DN 17.5% (VND),BHYT DN 3% (VND),BHTN DN 1% (VND),Tổng DN đóng 21.5% (VND),Kinh phí CĐ 2% (VND),Tổng trích nộp 34% (VND)\r\n`;
          for (const r of slipsRes.rows) {
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

            csvContent +=
              [
                escapeCsvCell(r.employee_code),
                escapeCsvCell(r.full_name),
                escapeCsvCell(r.department_name || 'Chung'),
                escapeCsvCell(r.si_code || '—'),
                escapeCsvCell(toDecimal(rawSalaryCents)),
                escapeCsvCell(toDecimal(cappedSiCents)),
                escapeCsvCell(toDecimal(cappedUiCents)),
                escapeCsvCell(toDecimal(empBhxhCents)),
                escapeCsvCell(toDecimal(empBhytCents)),
                escapeCsvCell(toDecimal(empBhtnCents)),
                escapeCsvCell(toDecimal(empTotalCents)),
                escapeCsvCell(toDecimal(emprBhxhCents)),
                escapeCsvCell(toDecimal(emprBhytCents)),
                escapeCsvCell(toDecimal(emprBhtnCents)),
                escapeCsvCell(toDecimal(emprTotalCents)),
                escapeCsvCell(toDecimal(unionCents)),
                escapeCsvCell(toDecimal(totalRemittanceCents)),
              ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-INS-02') {
        const reportingYear = body.filters.year
          ? parseInt(String(body.filters.year), 10)
          : new Date().getFullYear();
        csvContent += `BÁO CÁO TÌNH HÌNH BIẾN ĐỘNG LAO ĐỘNG THAM GIA BẢO HIỂM (RPT-INS-02 - MẪU D02-LT)\r\n`;
        csvContent += `Năm: ${reportingYear}\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: QueryParameter[] = [
          identity.orgId,
          `${reportingYear}-01-01`,
          `${reportingYear}-12-31`,
        ];
        let where = 'e.organization_id = $1';
        if (body.filters.departmentId) {
          params.push(body.filters.departmentId);
          where += ` AND e.department_id = $${params.length}`;
        }

        const rowsRes = await pool.query(
          `SELECT
            e.id AS employee_id, e.employee_code, e.full_name, e.hire_date::text AS hire_date,
            d.name AS department_name, pos.title AS position_title,
            esi.si_code,
            ec.start_date::text AS contract_start, ec.end_date::text AS contract_end, ec.status AS contract_status,
            COALESCE(esp.base_salary, 0.00) AS new_salary,
            CASE
              WHEN ec.start_date >= $2::date AND ec.start_date <= $3::date THEN 'Tăng mới'
              WHEN ec.status = 'TERMINATED' OR (ec.end_date IS NOT NULL AND ec.end_date <= $3::date) THEN 'Giảm lao động'
              ELSE 'Điều chỉnh mức đóng'
            END AS fluctuation_type,
            COALESCE(ec.start_date::text, e.hire_date::text) AS effective_date
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
          LEFT JOIN positions pos ON pos.id = e.position_id AND pos.organization_id = e.organization_id
          LEFT JOIN employee_social_insurance esi ON esi.employee_id = e.id AND esi.organization_id = e.organization_id
          LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.organization_id = e.organization_id
          LEFT JOIN employee_salary_profiles esp ON esp.employee_id = e.id AND esp.organization_id = e.organization_id AND esp.status = 'ACTIVE'
          WHERE ${where}
          ORDER BY effective_date DESC, e.employee_code ASC`,
          params,
        );
        rowCount = rowsRes.rows.length;

        csvContent += `Mã NV,Họ và tên,Phòng ban,Chức danh,Mã số BHXH,Loại biến động,Ngày hiệu lực,Mức lương đóng mới (VND),Ghi chú\r\n`;
        for (const r of rowsRes.rows) {
          csvContent +=
            [
              escapeCsvCell(r.employee_code),
              escapeCsvCell(r.full_name),
              escapeCsvCell(r.department_name || 'Chung'),
              escapeCsvCell(r.position_title || '—'),
              escapeCsvCell(r.si_code || '—'),
              escapeCsvCell(r.fluctuation_type),
              escapeCsvCell(r.effective_date),
              escapeCsvCell(toDecimal(toCents(r.new_salary))),
              escapeCsvCell('Kê khai D02-LT'),
            ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-LAB-01') {
        const year = body.filters.year
          ? parseInt(String(body.filters.year), 10)
          : new Date().getFullYear();
        const half = body.filters.half === '1' ? 1 : 2;
        csvContent += `BÁO CÁO TÌNH HÌNH SỬ DỤNG LAO ĐỘNG ĐỊNH KỲ (RPT-LAB-01 - MẪU 01/PLI NĐ 145/2020/NĐ-CP)\r\n`;
        csvContent += `Kỳ báo cáo: ${half === 1 ? `6 tháng đầu năm ${year}` : `Cả năm ${year}`}\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: QueryParameter[] = [identity.orgId];
        let where = 'e.organization_id = $1';
        if (body.filters.departmentId) {
          params.push(body.filters.departmentId);
          where += ` AND e.department_id = $${params.length}`;
        }

        const empRes = await pool.query(
          `SELECT
            e.id AS employee_id, e.employee_code, e.full_name, e.hire_date::text AS hire_date,
            e.employment_status, d.name AS department_name, pos.title AS position_title,
            ec.contract_type, ec.contract_number
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
          LEFT JOIN positions pos ON pos.id = e.position_id AND pos.organization_id = e.organization_id
          LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.organization_id = e.organization_id AND ec.status = 'ACTIVE'
          WHERE ${where}
          ORDER BY e.employee_code ASC`,
          params,
        );
        rowCount = empRes.rows.length;

        csvContent += `Mã NV,Họ và tên,Phòng ban,Chức vụ,Loại HĐLĐ,Số hợp đồng,Ngày tuyển dụng,Trạng thái làm việc,Nhóm vị trí\r\n`;
        for (const r of empRes.rows) {
          const titleLower = (r.position_title || '').toLowerCase();
          const positionGroup = /giám đốc|trưởng|phó|manager|leader|director|head/.test(titleLower)
            ? 'Nhà quản lý'
            : /kỹ sư|lập trình|developer|engineer|chuyên viên|specialist/.test(titleLower)
              ? 'Chuyên môn kỹ thuật'
              : 'Nhân viên khác';
          const contractLabel =
            r.contract_type === 'INDEFINITE'
              ? 'Hợp đồng KXDTH'
              : r.contract_type === 'FIXED_TERM'
                ? 'Hợp đồng CXDTH'
                : 'Học việc/Thử việc';

          csvContent +=
            [
              escapeCsvCell(r.employee_code),
              escapeCsvCell(r.full_name),
              escapeCsvCell(r.department_name || 'Chung'),
              escapeCsvCell(r.position_title || '—'),
              escapeCsvCell(contractLabel),
              escapeCsvCell(r.contract_number || '—'),
              escapeCsvCell(r.hire_date),
              escapeCsvCell(r.employment_status === 'ACTIVE' ? 'Đang làm việc' : 'Đã nghỉ việc'),
              escapeCsvCell(positionGroup),
            ].join(',') + '\r\n';
        }
      }

      // Record in report_export_audit_logs
      await pool.query(
        `INSERT INTO report_export_audit_logs
         (id, organization_id, report_code, format, row_count, filters, exported_by, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          randomUUID(),
          identity.orgId,
          body.reportCode,
          body.format,
          rowCount,
          JSON.stringify(body.filters),
          identity.userId,
          req.ip || null,
          req.get('user-agent') || null,
        ],
      );

      await audit(pool, 'REPORT_EXPORTED', identity.userId, identity.orgId, undefined, {
        reportCode: body.reportCode,
        format: body.format,
        rowCount,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${body.reportCode}_${Date.now()}.csv"`,
      );
      res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  });
}
