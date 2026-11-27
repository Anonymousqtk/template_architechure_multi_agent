// Catalog, roster, org structure, attendance and leave reports (split from reporting.ts, behavior unchanged).
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { managementScope } from './management-scope.js';
import { escapeLike } from './organization-structure.js';
import { fail, type Authed } from './types.js';
import {
  uuid,
  isoDate,
  DEFAULT_REPORT_CATALOG,
  canAccessReport,
  buildEmployeeScopeClause,
  type QueryParameter,
  type PositionSummary,
} from './reporting-shared.js';
import type { ReportingContext } from './reporting-context.js';

export function registerHrReportRoutes(app: Express, ctx: ReportingContext) {
  const { pool, audit, prefix, identityFor, ensureDefaultCatalog } = ctx;

  // =========================================================================
  // 1. REPORT CATALOG ENDPOINTS
  // =========================================================================

  // GET /api/organizations/:orgId/reports/catalog
  app.get(`${prefix}/catalog`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      await ensureDefaultCatalog(identity.orgId);

      const rows = await pool.query<{
        id: string;
        code: string;
        category: string;
        name: string;
        description: string;
        min_role: string;
        display_order: number;
        supported_filters: string[];
      }>(
        `SELECT id, code, category, name, description, min_role, display_order, supported_filters
         FROM report_catalog
         WHERE organization_id = $1 AND is_active = true
         ORDER BY display_order ASC, code ASC`,
        [identity.orgId],
      );

      // Filter catalog based on caller role
      const available = rows.rows
        .filter((r) => canAccessReport(identity.role, r.min_role))
        .map((r) => ({
          id: r.id,
          code: r.code,
          category: r.category,
          name: r.name,
          description: r.description,
          minRole: r.min_role,
          displayOrder: r.display_order,
          supportedFilters: r.supported_filters,
        }));

      res.json({ reports: available });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/organizations/:orgId/reports/catalog/seed-defaults
  app.post(`${prefix}/catalog/seed-defaults`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');

      for (const item of DEFAULT_REPORT_CATALOG) {
        await pool.query(
          `INSERT INTO report_catalog (id, organization_id, code, category, name, description, min_role, display_order, supported_filters)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (organization_id, code) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               min_role = EXCLUDED.min_role,
               display_order = EXCLUDED.display_order,
               supported_filters = EXCLUDED.supported_filters,
               updated_at = now()`,
          [
            randomUUID(),
            identity.orgId,
            item.code,
            item.category,
            item.name,
            item.description,
            item.minRole,
            item.displayOrder,
            JSON.stringify(item.supportedFilters),
          ],
        );
      }

      await audit(pool, 'REPORT_CATALOG_SEEDED', identity.userId, identity.orgId);
      res.json({ success: true, count: DEFAULT_REPORT_CATALOG.length });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 2. P0 REPORT: RPT-EMP-01 (EMPLOYEE HEADCOUNT & ROSTER)
  // =========================================================================

  app.get(`${prefix}/emp-roster`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'MANAGER')) fail(403, 'FORBIDDEN');

      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const positionId = req.query.positionId ? uuid.parse(req.query.positionId) : undefined;
      const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
      const contractType = req.query.contractType
        ? String(req.query.contractType).toUpperCase()
        : undefined;
      const search = req.query.search ? String(req.query.search).trim() : undefined;
      const hireDateFrom = req.query.hireDateFrom
        ? isoDate.parse(req.query.hireDateFrom)
        : undefined;
      const hireDateTo = req.query.hireDateTo ? isoDate.parse(req.query.hireDateTo) : undefined;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      // Base query params
      const params: QueryParameter[] = [identity.orgId];
      let paramIdx = 2;

      // Employee scope clause
      const scope = await buildEmployeeScopeClause(pool, identity, paramIdx);
      params.push(...scope.params);
      paramIdx = scope.nextIndex;

      let whereClause = `e.organization_id = $1 AND ${scope.clause}`;

      if (departmentId) {
        whereClause += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (positionId) {
        whereClause += ` AND e.position_id = $${paramIdx++}`;
        params.push(positionId);
      }
      if (status && ['ACTIVE', 'ON_LEAVE', 'TERMINATED'].includes(status)) {
        whereClause += ` AND e.employment_status = $${paramIdx++}`;
        params.push(status);
      }
      if (hireDateFrom) {
        whereClause += ` AND e.hire_date >= $${paramIdx++}`;
        params.push(hireDateFrom);
      }
      if (hireDateTo) {
        whereClause += ` AND e.hire_date <= $${paramIdx++}`;
        params.push(hireDateTo);
      }
      if (search) {
        whereClause += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx} OR e.personal_email ILIKE $${paramIdx} OR e.phone ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      // If contractType filter is requested
      const contractJoin = `LEFT JOIN LATERAL (
        SELECT contract_number, contract_type, status, start_date, end_date
        FROM employee_contracts c
        WHERE c.employee_id = e.id AND c.organization_id = e.organization_id AND c.status = 'ACTIVE'
        ORDER BY c.start_date DESC LIMIT 1
      ) c ON true`;

      if (contractType && ['PROBATION', 'FIXED_TERM', 'INDEFINITE'].includes(contractType)) {
        whereClause += ` AND c.contract_type = $${paramIdx++}`;
        params.push(contractType);
      }

      // 1. Total counts & summary metrics
      const summaryQuery = `
        SELECT
          count(*)::int AS total_employees,
          count(*) FILTER (WHERE e.employment_status = 'ACTIVE')::int AS active_count,
          count(*) FILTER (WHERE e.employment_status = 'ON_LEAVE')::int AS on_leave_count,
          count(*) FILTER (WHERE e.employment_status = 'TERMINATED')::int AS terminated_count,
          COALESCE(AVG(EXTRACT(YEAR FROM age(CURRENT_DATE, e.hire_date)) * 12 + EXTRACT(MONTH FROM age(CURRENT_DATE, e.hire_date))), 0)::numeric(10,1) AS avg_tenure_months
        FROM employees e
        ${contractJoin}
        WHERE ${whereClause}
      `;
      const summaryRes = await pool.query(summaryQuery, params);
      const summary = summaryRes.rows[0] || {
        total_employees: 0,
        active_count: 0,
        on_leave_count: 0,
        terminated_count: 0,
        avg_tenure_months: 0,
      };

      // 2. Department Breakdown
      const deptBreakdownQuery = `
        SELECT COALESCE(d.name, 'Chưa phân bổ') AS department_name, count(*)::int AS count
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        ${contractJoin}
        WHERE ${whereClause}
        GROUP BY d.name
        ORDER BY count DESC
      `;
      const deptBreakdownRes = await pool.query(deptBreakdownQuery, params);

      // 3. Contract Breakdown
      const contractBreakdownQuery = `
        SELECT COALESCE(c.contract_type, 'KHÔNG CÓ / KHÁC') AS contract_type, count(*)::int AS count
        FROM employees e
        ${contractJoin}
        WHERE ${whereClause}
        GROUP BY c.contract_type
        ORDER BY count DESC
      `;
      const contractBreakdownRes = await pool.query(contractBreakdownQuery, params);

      // 4. Paginated list
      const listParams = [...params, pageSize, offset];
      const listQuery = `
        SELECT
          e.id,
          e.employee_code,
          e.full_name,
          e.hire_date::text AS hire_date,
          e.employment_status,
          e.phone,
          e.personal_email,
          d.name AS department_name,
          p.title AS position_title,
          m_user.full_name AS manager_name,
          c.contract_type,
          c.contract_number,
          (EXTRACT(YEAR FROM age(CURRENT_DATE, e.hire_date)) * 12 + EXTRACT(MONTH FROM age(CURRENT_DATE, e.hire_date)))::int AS tenure_months
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
        LEFT JOIN memberships m ON m.user_id = e.manager_user_id AND m.organization_id = e.organization_id
        LEFT JOIN users m_user ON m_user.id = m.user_id
        ${contractJoin}
        WHERE ${whereClause}
        ORDER BY e.employee_code ASC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const listRes = await pool.query(listQuery, listParams);

      res.json({
        metrics: {
          totalEmployees: summary.total_employees,
          activeEmployees: summary.active_count,
          onLeaveEmployees: summary.on_leave_count,
          terminatedEmployees: summary.terminated_count,
          averageTenureMonths: parseFloat(summary.avg_tenure_months || 0),
          departmentBreakdown: deptBreakdownRes.rows.map((r) => ({
            name: r.department_name,
            count: r.count,
          })),
          contractBreakdown: contractBreakdownRes.rows.map((r) => ({
            type: r.contract_type,
            count: r.count,
          })),
        },
        pagination: {
          page,
          pageSize,
          totalRows: summary.total_employees,
          totalPages: Math.ceil(summary.total_employees / pageSize) || 1,
        },
        items: listRes.rows.map((r) => ({
          id: r.id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          hireDate: r.hire_date,
          employmentStatus: r.employment_status,
          phone: r.phone,
          personalEmail: r.personal_email,
          departmentName: r.department_name || 'Chưa phân bổ',
          positionTitle: r.position_title || 'Chưa phân bổ',
          managerName: r.manager_name || '—',
          contractType: r.contract_type || '—',
          contractNumber: r.contract_number || '—',
          tenureMonths: r.tenure_months || 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 3. P0 REPORT: RPT-ORG-01 (DEPARTMENT & POSITION STRUCTURE)
  // =========================================================================

  app.get(`${prefix}/org-structure`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!canAccessReport(identity.role, 'MANAGER')) fail(403, 'FORBIDDEN');

      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : true;

      const params: QueryParameter[] = [identity.orgId];
      let paramIdx = 2;

      let whereDept = `d.organization_id = $1`;
      if (isActive !== undefined) {
        whereDept += ` AND d.is_active = $${paramIdx++}`;
        params.push(isActive);
      }
      if (departmentId) {
        whereDept += ` AND (d.id = $${paramIdx} OR d.parent_id = $${paramIdx})`;
        params.push(departmentId);
        paramIdx++;
      }

      // If MANAGER, restrict to managed departments
      if (identity.role === 'MANAGER') {
        const scope = await managementScope(pool, identity);
        if (scope && scope.departments.length > 0) {
          whereDept += ` AND d.id = ANY($${paramIdx++}::uuid[])`;
          params.push(scope.departments);
        } else {
          whereDept += ` AND d.manager_user_id = $${paramIdx++}`;
          params.push(identity.userId);
        }
      }

      // 1. Department Summary Metrics
      const deptListQuery = `
        SELECT
          d.id,
          d.code,
          d.name,
          d.description,
          d.parent_id,
          p_dept.name AS parent_name,
          d.is_active,
          u.full_name AS manager_name,
          d.created_at::text AS created_at,
          (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id AND e.organization_id = d.organization_id AND e.employment_status = 'ACTIVE') AS active_employee_count,
          (SELECT count(*)::int FROM positions p WHERE p.department_id = d.id AND p.organization_id = d.organization_id AND p.is_active = true) AS position_count
        FROM departments d
        LEFT JOIN departments p_dept ON p_dept.id = d.parent_id AND p_dept.organization_id = d.organization_id
        LEFT JOIN users u ON u.id = d.manager_user_id
        WHERE ${whereDept}
        ORDER BY d.code ASC
      `;
      const deptListRes = await pool.query(deptListQuery, params);

      // 2. Positions by Department
      const posQuery = `
        SELECT
          p.id,
          p.department_id,
          p.code,
          p.title,
          p.is_active,
          (SELECT count(*)::int FROM employees e WHERE e.position_id = p.id AND e.organization_id = p.organization_id AND e.employment_status = 'ACTIVE') AS employee_count
        FROM positions p
        WHERE p.organization_id = $1 AND p.is_active = true
        ORDER BY p.code ASC
      `;
      const posRes = await pool.query<{
        id: string;
        department_id: string | null;
        code: string;
        title: string;
        employee_count: number;
      }>(posQuery, [identity.orgId]);
      const positionsByDept = new Map<string, PositionSummary[]>();
      for (const pos of posRes.rows) {
        const dId = pos.department_id || 'unassigned';
        const arr = positionsByDept.get(dId) || [];
        arr.push({
          id: pos.id,
          code: pos.code,
          title: pos.title,
          employeeCount: pos.employee_count,
        });
        positionsByDept.set(dId, arr);
      }

      const totalDepartments = deptListRes.rows.length;
      let totalAssignedEmployees = 0;
      let totalPositions = 0;
      let withManagerCount = 0;

      const departments = deptListRes.rows.map((d) => {
        totalAssignedEmployees += d.active_employee_count;
        totalPositions += d.position_count;
        if (d.manager_name) withManagerCount++;

        return {
          id: d.id,
          code: d.code,
          name: d.name,
          parentId: d.parent_id,
          parentName: d.parent_name || '—',
          managerName: d.manager_name || 'Chưa phân công',
          isActive: d.is_active,
          employeeCount: d.active_employee_count,
          positionCount: d.position_count,
          positions: positionsByDept.get(d.id) || [],
        };
      });

      res.json({
        metrics: {
          totalDepartments,
          totalPositions,
          totalAssignedEmployees,
          departmentsWithManager: withManagerCount,
          departmentsWithoutManager: totalDepartments - withManagerCount,
        },
        items: departments,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 4. P0 REPORT: RPT-ATT-01 (ATTENDANCE & SHIFT SUMMARY)
  // =========================================================================

  app.get(`${prefix}/attendance-summary`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const employeeId = req.query.employeeId ? uuid.parse(req.query.employeeId) : undefined;
      const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
      const search = req.query.search ? String(req.query.search).trim() : undefined;

      const now = new Date();
      const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10);
      const defaultEnd = now.toISOString().slice(0, 10);

      const startDate = req.query.startDate ? isoDate.parse(req.query.startDate) : defaultStart;
      const endDate = req.query.endDate ? isoDate.parse(req.query.endDate) : defaultEnd;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      const params: QueryParameter[] = [identity.orgId, startDate, endDate];
      let paramIdx = 4;

      const scope = await buildEmployeeScopeClause(pool, identity, paramIdx);
      params.push(...scope.params);
      paramIdx = scope.nextIndex;

      let whereClause = `s.organization_id = $1 AND s.work_date >= $2 AND s.work_date <= $3 AND ${scope.clause}`;

      if (departmentId) {
        whereClause += ` AND e.department_id = $${paramIdx++}`;
        params.push(departmentId);
      }
      if (employeeId) {
        whereClause += ` AND s.employee_id = $${paramIdx++}`;
        params.push(employeeId);
      }
      if (search) {
        whereClause += ` AND (e.employee_code ILIKE $${paramIdx} OR e.full_name ILIKE $${paramIdx})`;
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      // Query raw schedules with punches and shifts
      const scheduleQuery = `
        SELECT
          s.id AS schedule_id,
          s.work_date::text AS work_date,
          s.starts_at,
          s.ends_at,
          s.attendance_kind,
          s.label,
          s.early_check_in,
          s.late_grace,
          s.early_grace,
          e.id AS employee_id,
          e.employee_code,
          e.full_name,
          d.name AS department_name,
          ws.name AS shift_name,
          p.checked_in_at,
          p.checked_out_at
        FROM work_schedule s
        JOIN employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN work_shifts ws ON ws.id = s.shift_id AND ws.organization_id = s.organization_id
        LEFT JOIN attendance_punches p ON p.schedule_id = s.id AND p.organization_id = s.organization_id
        WHERE ${whereClause}
        ORDER BY s.work_date DESC, e.employee_code ASC
      `;

      const allRes = await pool.query(scheduleQuery, params);

      // Process rows to compute status and late/early minutes
      let totalSchedules = 0;
      let presentCount = 0;
      let onTimeCount = 0;
      let lateCount = 0;
      let earlyLeaveCount = 0;
      let absentCount = 0;
      let totalLateMinutes = 0;
      let totalEarlyMinutes = 0;

      const processedRows = [];

      for (const row of allRes.rows) {
        totalSchedules++;

        let attStatus = 'SCHEDULED';
        let lateMins = 0;
        let earlyMins = 0;

        if (row.checked_in_at) {
          presentCount++;
          const checkIn = new Date(row.checked_in_at).getTime();
          const plannedStart = new Date(row.starts_at).getTime();
          const graceMs = (row.late_grace || 0) * 60 * 1000;

          if (checkIn > plannedStart + graceMs) {
            lateMins = Math.max(0, Math.floor((checkIn - plannedStart) / (60 * 1000)));
            totalLateMinutes += lateMins;
          }

          if (row.checked_out_at) {
            const checkOut = new Date(row.checked_out_at).getTime();
            const plannedEnd = new Date(row.ends_at).getTime();
            const earlyGraceMs = (row.early_grace || 0) * 60 * 1000;

            if (checkOut < plannedEnd - earlyGraceMs) {
              earlyMins = Math.max(0, Math.floor((plannedEnd - checkOut) / (60 * 1000)));
              totalEarlyMinutes += earlyMins;
            }
          }

          if (lateMins > 0 && earlyMins > 0) {
            attStatus = 'LATE_AND_EARLY';
            lateCount++;
            earlyLeaveCount++;
          } else if (lateMins > 0) {
            attStatus = 'LATE';
            lateCount++;
          } else if (earlyMins > 0) {
            attStatus = 'EARLY_LEAVE';
            earlyLeaveCount++;
          } else {
            attStatus = 'ON_TIME';
            onTimeCount++;
          }
        } else {
          const scheduleDate = new Date(row.work_date);
          const today = new Date(now.toISOString().slice(0, 10));
          if (scheduleDate < today && row.attendance_kind !== 'OFF') {
            attStatus = 'ABSENT';
            absentCount++;
          }
        }

        if (!status || status === 'ALL' || attStatus === status) {
          processedRows.push({
            scheduleId: row.schedule_id,
            workDate: row.work_date,
            employeeCode: row.employee_code,
            fullName: row.full_name,
            departmentName: row.department_name || 'Chưa phân bổ',
            shiftName: row.shift_name || row.label || 'Ca chuẩn',
            plannedStart: row.starts_at,
            plannedEnd: row.ends_at,
            checkedInAt: row.checked_in_at || null,
            checkedOutAt: row.checked_out_at || null,
            status: attStatus,
            lateMinutes: lateMins,
            earlyMinutes: earlyMins,
          });
        }
      }

      const totalFiltered = processedRows.length;
      const paginatedItems = processedRows.slice(offset, offset + pageSize);
      const attendanceRate =
        totalSchedules > 0 ? parseFloat(((presentCount / totalSchedules) * 100).toFixed(1)) : 100;

      res.json({
        metrics: {
          totalSchedules,
          presentCount,
          onTimeCount,
          lateCount,
          earlyLeaveCount,
          absentCount,
          totalLateMinutes,
          totalEarlyMinutes,
          attendanceRate,
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
  // 5. P0 REPORT: RPT-LEAVE-01 (LEAVE UTILIZATION & BALANCES)
  // =========================================================================

  app.get(`${prefix}/leave-summary`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;
      const leaveTypeId = req.query.leaveTypeId ? uuid.parse(req.query.leaveTypeId) : undefined;
      const employeeId = req.query.employeeId ? uuid.parse(req.query.employeeId) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : undefined;

      const now = new Date();
      const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
        .toISOString()
        .slice(0, 10);
      const defaultEnd = now.toISOString().slice(0, 10);

      const startDate = req.query.startDate ? isoDate.parse(req.query.startDate) : defaultStart;
      const endDate = req.query.endDate ? isoDate.parse(req.query.endDate) : defaultEnd;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      // 1. Balances query
      const bParams: QueryParameter[] = [identity.orgId];
      let bIdx = 2;

      const bScope = await buildEmployeeScopeClause(pool, identity, bIdx);
      bParams.push(...bScope.params);
      bIdx = bScope.nextIndex;

      let bWhere = `e.organization_id = $1 AND ${bScope.clause}`;
      if (departmentId) {
        bWhere += ` AND e.department_id = $${bIdx++}`;
        bParams.push(departmentId);
      }
      if (employeeId) {
        bWhere += ` AND e.id = $${bIdx++}`;
        bParams.push(employeeId);
      }
      if (leaveTypeId) {
        bWhere += ` AND lt.id = $${bIdx++}`;
        bParams.push(leaveTypeId);
      }
      if (search) {
        bWhere += ` AND (e.employee_code ILIKE $${bIdx} OR e.full_name ILIKE $${bIdx})`;
        bParams.push(`%${escapeLike(search)}%`);
        bIdx++;
      }

      const balanceQuery = `
        SELECT
          e.id AS employee_id,
          e.employee_code,
          e.full_name,
          d.name AS department_name,
          lt.id AS leave_type_id,
          lt.name AS leave_type_name,
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
        WHERE ${bWhere} AND lt.organization_id = e.organization_id AND lt.active = true
        ORDER BY e.employee_code ASC, lt.name ASC
      `;

      const balanceRes = await pool.query(balanceQuery, bParams);

      let totalAllowanceMinutes = 0;
      let totalChargedMinutes = 0;
      let totalRemainingMinutes = 0;

      const balances = balanceRes.rows.map((r) => {
        const allowance = r.allowance_minutes || 0;
        const charged = r.charged_minutes || 0;
        const remaining = Math.max(0, allowance - charged);
        const rate = allowance > 0 ? parseFloat(((charged / allowance) * 100).toFixed(1)) : 0;

        totalAllowanceMinutes += allowance;
        totalChargedMinutes += charged;
        totalRemainingMinutes += remaining;

        return {
          employeeId: r.employee_id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name || 'Chưa phân bổ',
          leaveTypeId: r.leave_type_id,
          leaveTypeName: r.leave_type_name,
          allowanceMinutes: allowance,
          allowanceDays: parseFloat((allowance / 480).toFixed(2)),
          chargedMinutes: charged,
          chargedDays: parseFloat((charged / 480).toFixed(2)),
          remainingMinutes: remaining,
          remainingDays: parseFloat((remaining / 480).toFixed(2)),
          utilizationRate: rate,
        };
      });

      // 2. Leave requests in date range
      const rParams: QueryParameter[] = [identity.orgId, startDate, endDate];
      let rIdx = 4;

      const rScope = await buildEmployeeScopeClause(pool, identity, rIdx);
      rParams.push(...rScope.params);
      rIdx = rScope.nextIndex;

      let rWhere = `lr.organization_id = $1 AND lr.starts_at::date >= $2 AND lr.starts_at::date <= $3 AND ${rScope.clause}`;
      if (departmentId) {
        rWhere += ` AND e.department_id = $${rIdx++}`;
        rParams.push(departmentId);
      }
      if (employeeId) {
        rWhere += ` AND lr.employee_id = $${rIdx++}`;
        rParams.push(employeeId);
      }
      if (leaveTypeId) {
        rWhere += ` AND lr.leave_type_id = $${rIdx++}`;
        rParams.push(leaveTypeId);
      }

      const requestsQuery = `
        SELECT
          lr.id,
          e.employee_code,
          e.full_name,
          d.name AS department_name,
          lt.name AS leave_type_name,
          lr.starts_at::text AS starts_at,
          lr.ends_at::text AS ends_at,
          lr.charge_minutes,
          lr.status,
          lr.reason,
          u_rev.full_name AS reviewer_name,
          lr.created_at::text AS created_at
        FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id AND e.organization_id = lr.organization_id
        LEFT JOIN departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
        LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id AND lt.organization_id = lr.organization_id
        LEFT JOIN users u_rev ON u_rev.id = lr.reviewed_by
        WHERE ${rWhere}
        ORDER BY lr.created_at DESC
        LIMIT 50
      `;

      const requestsRes = await pool.query(requestsQuery, rParams);

      const totalLeaveRequests = requestsRes.rows.length;
      const approvedCount = requestsRes.rows.filter((r) => r.status === 'APPROVED').length;
      const pendingCount = requestsRes.rows.filter((r) => r.status === 'PENDING').length;
      const rejectedCount = requestsRes.rows.filter((r) => r.status === 'REJECTED').length;

      const overallUtilizationRate =
        totalAllowanceMinutes > 0
          ? parseFloat(((totalChargedMinutes / totalAllowanceMinutes) * 100).toFixed(1))
          : 0;

      const totalRows = balances.length;
      const paginatedBalances = balances.slice(offset, offset + pageSize);

      res.json({
        metrics: {
          totalAllowanceDays: parseFloat((totalAllowanceMinutes / 480).toFixed(2)),
          totalChargedDays: parseFloat((totalChargedMinutes / 480).toFixed(2)),
          totalRemainingDays: parseFloat((totalRemainingMinutes / 480).toFixed(2)),
          overallUtilizationRate,
          totalLeaveRequests,
          approvedRequests: approvedCount,
          pendingRequests: pendingCount,
          rejectedRequests: rejectedCount,
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1,
        },
        balances: paginatedBalances,
        requests: requestsRes.rows.map((r) => ({
          id: r.id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          departmentName: r.department_name || 'Chưa phân bổ',
          leaveTypeName: r.leave_type_name,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          chargeMinutes: r.charge_minutes || 0,
          chargeDays: parseFloat(((r.charge_minutes || 0) / 480).toFixed(2)),
          status: r.status,
          reason: r.reason,
          reviewerName: r.reviewer_name || '—',
          createdAt: r.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });
}
