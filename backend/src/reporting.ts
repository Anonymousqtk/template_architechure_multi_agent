import type { Express, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { managementScope } from './management-scope.js';
import { escapeLike, type OrgStructureDeps } from './organization-structure.js';
import { fail, type Authed, type Identity } from './types.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export interface ReportCatalogItem {
  id?: string;
  code: string;
  category: 'EMPLOYEE' | 'ORGANIZATION' | 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'ACCOUNTING' | 'COMPLIANCE' | 'OTHER';
  name: string;
  description: string;
  minRole: 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE';
  displayOrder: number;
  supportedFilters: string[];
}

export const DEFAULT_REPORT_CATALOG: ReportCatalogItem[] = [
  {
    code: 'RPT-EMP-01',
    category: 'EMPLOYEE',
    name: 'Báo cáo nhân sự & biến động nhân sự',
    description: 'Tổng hợp danh sách nhân viên, trạng thái hoạt động, cơ cấu phòng ban, chức vụ, loại hợp đồng và thâm niên làm việc.',
    minRole: 'MANAGER',
    displayOrder: 1,
    supportedFilters: ['departmentId', 'positionId', 'status', 'contractType', 'search', 'hireDateFrom', 'hireDateTo']
  },
  {
    code: 'RPT-ORG-01',
    category: 'ORGANIZATION',
    name: 'Báo cáo cơ cấu tổ chức & phòng ban',
    description: 'Thống kê sơ đồ phân cấp phòng ban, chức vụ, số lượng nhân sự định biên và độ bao phủ quản lý.',
    minRole: 'MANAGER',
    displayOrder: 2,
    supportedFilters: ['departmentId', 'isActive']
  },
  {
    code: 'RPT-ATT-01',
    category: 'ATTENDANCE',
    name: 'Báo cáo tổng hợp chấm công & ca làm việc',
    description: 'Thống kê chi tiết ca làm việc, số ngày công, đi muộn, về sớm, tăng ca và tỷ lệ hiện diện.',
    minRole: 'EMPLOYEE',
    displayOrder: 3,
    supportedFilters: ['startDate', 'endDate', 'departmentId', 'employeeId', 'status', 'search']
  },
  {
    code: 'RPT-LEAVE-01',
    category: 'LEAVE',
    name: 'Báo cáo tình hình nghỉ phép & số dư phép',
    description: 'Theo dõi hạn mức phép, số ngày đã sử dụng, số dư còn lại và chi tiết các đơn xin nghỉ phép.',
    minRole: 'EMPLOYEE',
    displayOrder: 4,
    supportedFilters: ['startDate', 'endDate', 'departmentId', 'leaveTypeId', 'employeeId', 'status', 'search']
  },
  {
    code: 'RPT-PAY-01',
    category: 'PAYROLL',
    name: 'Bảng lương tổng hợp & chi tiết theo kỳ',
    description: 'Tổng hợp quỹ lương Gross, lương cơ bản, phụ cấp, thưởng, khấu trừ và thực lĩnh (Net) theo từng kỳ lương.',
    minRole: 'MANAGER',
    displayOrder: 5,
    supportedFilters: ['periodId', 'departmentId', 'search']
  },
  {
    code: 'RPT-PAY-02',
    category: 'PAYROLL',
    name: 'Báo cáo cơ cấu phụ cấp, thưởng & khấu trừ',
    description: 'Phân tích chi tiết từng cấu phần phụ cấp (chịu thuế/miễn thuế), thưởng và các khoản khấu trừ bảo hiểm, thuế, tạm ứng.',
    minRole: 'HR',
    displayOrder: 6,
    supportedFilters: ['periodId', 'componentType', 'departmentId']
  },
  {
    code: 'RPT-PAY-03',
    category: 'PAYROLL',
    name: 'Báo cáo biến động quỹ lương giữa các kỳ (MoM)',
    description: 'So sánh biến động quỹ lương Gross, Net, số lượng nhân sự và tỷ lệ tăng giảm giữa hai kỳ lương liên tiếp.',
    minRole: 'HR',
    displayOrder: 7,
    supportedFilters: ['periodId', 'comparePeriodId']
  },
  {
    code: 'RPT-ACC-01',
    category: 'ACCOUNTING',
    name: 'Báo cáo phân bổ chi phí lương theo phòng ban & đơn vị',
    description: 'Phân bổ chi phí lương Gross, bảo hiểm bắt buộc người sử dụng LĐ (21.5%) và kinh phí công đoàn (2%) sang tài khoản chi phí VAS (6422, 6421).',
    minRole: 'HR',
    displayOrder: 8,
    supportedFilters: ['periodId', 'departmentId']
  },
  {
    code: 'RPT-ACC-02',
    category: 'ACCOUNTING',
    name: 'Báo cáo công nợ lương & đối chiếu thanh toán',
    description: 'Đối chiếu công nợ lương phải trả người lao động (TK 3341), số tiền đã chi trả thực tế qua ngân hàng và số dư còn phải trả.',
    minRole: 'HR',
    displayOrder: 9,
    supportedFilters: ['periodId', 'status']
  },
  {
    code: 'RPT-ACC-03',
    category: 'ACCOUNTING',
    name: 'Báo cáo sổ nhật ký bút toán kế toán lương',
    description: 'Kiểm toán sổ nhật ký chung các bút toán kế toán lương, kiểm tra cân đối tổng Nợ = tổng Có và lưu vết đảo bút toán.',
    minRole: 'HR',
    displayOrder: 10,
    supportedFilters: ['periodId', 'status', 'accountId']
  }
];

const ROLE_RANKS: Record<string, number> = {
  ADMIN: 4,
  HR: 3,
  MANAGER: 2,
  EMPLOYEE: 1
};

export function canAccessReport(userRole: string, minRole: string): boolean {
  const userRank = ROLE_RANKS[userRole] ?? 0;
  const minRank = ROLE_RANKS[minRole] ?? 99;
  return userRank >= minRank;
}

export function toCents(amount: number | string | bigint): bigint {
  if (typeof amount === 'bigint') return amount;
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'));
  return BigInt(Math.round(num * 100));
}

export function toDecimal(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

// Build scope SQL clause for employees table (alias e)
async function buildEmployeeScopeClause(
  db: Db,
  identity: Identity,
  startParamIndex: number
): Promise<{ clause: string; params: any[]; nextIndex: number }> {
  if (['ADMIN', 'HR'].includes(identity.role)) {
    return { clause: '1=1', params: [], nextIndex: startParamIndex };
  }

  if (identity.role === 'EMPLOYEE') {
    return {
      clause: `e.user_id = $${startParamIndex}`,
      params: [identity.userId],
      nextIndex: startParamIndex + 1
    };
  }

  // MANAGER role: query managementScope
  const scope = await managementScope(db, identity);
  if (!scope) {
    return {
      clause: `e.user_id = $${startParamIndex}`,
      params: [identity.userId],
      nextIndex: startParamIndex + 1
    };
  }

  const deptParamIdx = startParamIndex;
  const userParamIdx = startParamIndex + 1;
  const selfParamIdx = startParamIndex + 2;

  return {
    clause: `(e.department_id = ANY($${deptParamIdx}::uuid[]) OR e.user_id = ANY($${userParamIdx}::uuid[]) OR e.manager_user_id = $${selfParamIdx} OR e.user_id = $${selfParamIdx})`,
    params: [scope.departments, scope.users, identity.userId],
    nextIndex: startParamIndex + 3
  };
}

// Helper to sanitize CSV cells
function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function registerReportingRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const prefix = '/api/organizations/:organizationId/reports';

  function identityFor(req: Authed): Identity {
    const identity = requireIdentity(req);
    uuid.parse(req.params.organizationId);
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  // Ensure default catalog exists for organization
  async function ensureDefaultCatalog(orgId: string): Promise<void> {
    const countRes = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM report_catalog WHERE organization_id = $1',
      [orgId]
    );
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      for (const item of DEFAULT_REPORT_CATALOG) {
        await pool.query(
          `INSERT INTO report_catalog (id, organization_id, code, category, name, description, min_role, display_order, supported_filters)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (organization_id, code) DO NOTHING`,
          [
            randomUUID(),
            orgId,
            item.code,
            item.category,
            item.name,
            item.description,
            item.minRole,
            item.displayOrder,
            JSON.stringify(item.supportedFilters)
          ]
        );
      }
    }
  }

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
        supported_filters: any;
      }>(
        `SELECT id, code, category, name, description, min_role, display_order, supported_filters
         FROM report_catalog
         WHERE organization_id = $1 AND is_active = true
         ORDER BY display_order ASC, code ASC`,
        [identity.orgId]
      );

      // Filter catalog based on caller role
      const available = rows.rows
        .filter(r => canAccessReport(identity.role, r.min_role))
        .map(r => ({
          id: r.id,
          code: r.code,
          category: r.category,
          name: r.name,
          description: r.description,
          minRole: r.min_role,
          displayOrder: r.display_order,
          supportedFilters: r.supported_filters
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
            JSON.stringify(item.supportedFilters)
          ]
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
      const contractType = req.query.contractType ? String(req.query.contractType).toUpperCase() : undefined;
      const search = req.query.search ? String(req.query.search).trim() : undefined;
      const hireDateFrom = req.query.hireDateFrom ? isoDate.parse(req.query.hireDateFrom) : undefined;
      const hireDateTo = req.query.hireDateTo ? isoDate.parse(req.query.hireDateTo) : undefined;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      // Base query params
      const params: any[] = [identity.orgId];
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
      let contractJoin = `LEFT JOIN LATERAL (
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
        avg_tenure_months: 0
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
          departmentBreakdown: deptBreakdownRes.rows.map(r => ({ name: r.department_name, count: r.count })),
          contractBreakdown: contractBreakdownRes.rows.map(r => ({ type: r.contract_type, count: r.count }))
        },
        pagination: {
          page,
          pageSize,
          totalRows: summary.total_employees,
          totalPages: Math.ceil(summary.total_employees / pageSize) || 1
        },
        items: listRes.rows.map(r => ({
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
          tenureMonths: r.tenure_months || 0
        }))
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

      const params: any[] = [identity.orgId];
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
      const posRes = await pool.query(posQuery, [identity.orgId]);
      const positionsByDept = new Map<string, any[]>();
      for (const pos of posRes.rows) {
        const dId = pos.department_id || 'unassigned';
        const arr = positionsByDept.get(dId) || [];
        arr.push({
          id: pos.id,
          code: pos.code,
          title: pos.title,
          employeeCount: pos.employee_count
        });
        positionsByDept.set(dId, arr);
      }

      const totalDepartments = deptListRes.rows.length;
      let totalAssignedEmployees = 0;
      let totalPositions = 0;
      let withManagerCount = 0;

      const departments = deptListRes.rows.map(d => {
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
          positions: positionsByDept.get(d.id) || []
        };
      });

      res.json({
        metrics: {
          totalDepartments,
          totalPositions,
          totalAssignedEmployees,
          departmentsWithManager: withManagerCount,
          departmentsWithoutManager: totalDepartments - withManagerCount
        },
        items: departments
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
      const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const defaultEnd = now.toISOString().slice(0, 10);

      const startDate = req.query.startDate ? isoDate.parse(req.query.startDate) : defaultStart;
      const endDate = req.query.endDate ? isoDate.parse(req.query.endDate) : defaultEnd;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      const params: any[] = [identity.orgId, startDate, endDate];
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
            earlyMinutes: earlyMins
          });
        }
      }

      const totalFiltered = processedRows.length;
      const paginatedItems = processedRows.slice(offset, offset + pageSize);
      const attendanceRate = totalSchedules > 0 ? parseFloat(((presentCount / totalSchedules) * 100).toFixed(1)) : 100;

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
          attendanceRate
        },
        pagination: {
          page,
          pageSize,
          totalRows: totalFiltered,
          totalPages: Math.ceil(totalFiltered / pageSize) || 1
        },
        items: paginatedItems
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
      const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
      const defaultEnd = now.toISOString().slice(0, 10);

      const startDate = req.query.startDate ? isoDate.parse(req.query.startDate) : defaultStart;
      const endDate = req.query.endDate ? isoDate.parse(req.query.endDate) : defaultEnd;

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
      const offset = (page - 1) * pageSize;

      // 1. Balances query
      const bParams: any[] = [identity.orgId];
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

      const balances = balanceRes.rows.map(r => {
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
          utilizationRate: rate
        };
      });

      // 2. Leave requests in date range
      const rParams: any[] = [identity.orgId, startDate, endDate];
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
      const approvedCount = requestsRes.rows.filter(r => r.status === 'APPROVED').length;
      const pendingCount = requestsRes.rows.filter(r => r.status === 'PENDING').length;
      const rejectedCount = requestsRes.rows.filter(r => r.status === 'REJECTED').length;

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
          rejectedRequests: rejectedCount
        },
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.ceil(totalRows / pageSize) || 1
        },
        balances: paginatedBalances,
        requests: requestsRes.rows.map(r => ({
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
          createdAt: r.created_at
        }))
      });
    } catch (err) {
      next(err);
    }
  });

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
          [identity.orgId]
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
            totalActualDays: 0
          },
          pagination: { page, pageSize, totalRows: 0, totalPages: 1 },
          items: []
        });
      }

      const periodRes = await pool.query<{
        id: string; code: string; name: string; start_date: string; end_date: string;
        payment_date: string | null; standard_working_days: string; status: string;
      }>(
        `SELECT id, code, name, start_date::text, end_date::text, payment_date::text, standard_working_days::text, status
         FROM payroll_periods
         WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      const params: any[] = [identity.orgId, periodId];
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
          isDraft: period.status !== 'CLOSED'
        },
        metrics: {
          totalSlips,
          totalGross: toDecimal(toCents(agg?.sum_gross || '0')),
          totalNet: toDecimal(toCents(agg?.sum_net || '0')),
          totalDeductions: toDecimal(toCents(agg?.sum_deductions || '0')),
          totalAllowances: toDecimal(toCents(agg?.sum_allowances || '0')),
          totalBonuses: toDecimal(toCents(agg?.sum_bonuses || '0')),
          totalStandardDays: parseFloat(agg?.sum_standard_days || '0'),
          totalActualDays: parseFloat(agg?.sum_actual_days || '0')
        },
        pagination: {
          page,
          pageSize,
          totalRows: totalSlips,
          totalPages: Math.ceil(totalSlips / pageSize) || 1
        },
        items: listRes.rows.map(r => ({
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
          status: r.status
        }))
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
      const componentType = req.query.componentType ? String(req.query.componentType).toUpperCase() : undefined;
      const departmentId = req.query.departmentId ? uuid.parse(req.query.departmentId) : undefined;

      if (!periodId) {
        const latestPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId]
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
            nonTaxableAllowances: '0.00'
          },
          items: []
        });
      }

      const periodRes = await pool.query<{ id: string; code: string; name: string; status: string }>(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      const params: any[] = [identity.orgId, periodId];
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

      const items = resRows.rows.map(r => {
        const amtCents = toCents(r.total_amount);
        const nameLower = r.component_name.toLowerCase();
        const isNonTaxable = /ăn trưa|xăng xe|đồng phục|trang phục|công tác phí|điện thoại/i.test(nameLower);

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
          isTaxable: r.type === 'ALLOWANCE' ? !isNonTaxable : true
        };
      });

      res.json({
        period: { id: period.id, code: period.code, name: period.name, status: period.status, isDraft: period.status !== 'CLOSED' },
        metrics: {
          totalAllowances: toDecimal(allowanceCents),
          totalBonuses: toDecimal(bonusCents),
          totalDeductions: toDecimal(deductionCents),
          taxableAllowances: toDecimal(taxableAllowanceCents),
          nonTaxableAllowances: toDecimal(nonTaxableAllowanceCents)
        },
        items
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
          [identity.orgId]
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({ current: null, compare: null, variance: null, anomalousEmployees: [] });
      }

      const curPeriodRes = await pool.query<{ id: string; code: string; name: string; start_date: string; status: string }>(
        `SELECT id, code, name, start_date::text, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!curPeriodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const curPeriod = curPeriodRes.rows[0];

      // If comparePeriodId not specified, take the one directly before start_date
      if (!comparePeriodId) {
        const compPeriodRes = await pool.query<{ id: string }>(
          `SELECT id FROM payroll_periods
           WHERE organization_id = $1 AND start_date < $2::date
           ORDER BY start_date DESC LIMIT 1`,
          [identity.orgId, curPeriod.start_date]
        );
        if (compPeriodRes.rowCount && compPeriodRes.rows[0]) {
          comparePeriodId = compPeriodRes.rows[0].id;
        }
      }

      // Query totals for current period
      const curSummary = await pool.query<{
        headcount: number; sum_gross: string; sum_net: string; sum_deductions: string;
      }>(
        `SELECT
           count(*)::int AS headcount,
           COALESCE(sum(gross_pay), 0)::text AS sum_gross,
           COALESCE(sum(net_pay), 0)::text AS sum_net,
           COALESCE(sum(total_deductions), 0)::text AS sum_deductions
         FROM payroll_slips
         WHERE organization_id = $1 AND period_id = $2`,
        [identity.orgId, periodId]
      );
      const cur = curSummary.rows[0] || { headcount: 0, sum_gross: '0', sum_net: '0', sum_deductions: '0' };

      let comp: { headcount: number; sum_gross: string; sum_net: string; sum_deductions: string } = {
        headcount: 0, sum_gross: '0', sum_net: '0', sum_deductions: '0'
      };
      let compPeriod = null;

      if (comparePeriodId) {
        const compPeriodRow = await pool.query<{ id: string; code: string; name: string; status: string }>(
          `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
          [comparePeriodId, identity.orgId]
        );
        if (compPeriodRow.rowCount && compPeriodRow.rows[0]) {
          compPeriod = compPeriodRow.rows[0];
          const compRes = await pool.query<{
            headcount: number; sum_gross: string; sum_net: string; sum_deductions: string;
          }>(
            `SELECT
               count(*)::int AS headcount,
               COALESCE(sum(gross_pay), 0)::text AS sum_gross,
               COALESCE(sum(net_pay), 0)::text AS sum_net,
               COALESCE(sum(total_deductions), 0)::text AS sum_deductions
             FROM payroll_slips
             WHERE organization_id = $1 AND period_id = $2`,
            [identity.orgId, comparePeriodId]
          );
          comp = compRes.rows[0] || comp;
        }
      }

      const curGrossCents = toCents(cur.sum_gross);
      const compGrossCents = toCents(comp.sum_gross);
      const grossDeltaCents = curGrossCents - compGrossCents;
      const grossPercent = compGrossCents > 0n ? parseFloat(((Number(grossDeltaCents) / Number(compGrossCents)) * 100).toFixed(2)) : 0;

      const curNetCents = toCents(cur.sum_net);
      const compNetCents = toCents(comp.sum_net);
      const netDeltaCents = curNetCents - compNetCents;
      const netPercent = compNetCents > 0n ? parseFloat(((Number(netDeltaCents) / Number(compNetCents)) * 100).toFixed(2)) : 0;

      const curDedCents = toCents(cur.sum_deductions);
      const compDedCents = toCents(comp.sum_deductions);
      const dedDeltaCents = curDedCents - compDedCents;
      const dedPercent = compDedCents > 0n ? parseFloat(((Number(dedDeltaCents) / Number(compDedCents)) * 100).toFixed(2)) : 0;

      const hcDelta = cur.headcount - comp.headcount;
      const hcPercent = comp.headcount > 0 ? parseFloat(((hcDelta / comp.headcount) * 100).toFixed(1)) : 0;

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
      const anomRes = await pool.query(anomalousQuery, [identity.orgId, periodId, comparePeriodId || '00000000-0000-0000-0000-000000000000']);
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
          isAnomalous
        };

        evaluatedEmployees.push(empItem);
        if (isAnomalous) {
          anomalousEmployees.push(empItem);
        }
      }

      const previousPeriod = compPeriod ? {
        id: compPeriod.id,
        code: compPeriod.code,
        name: compPeriod.name,
        status: compPeriod.status,
        headcount: comp.headcount,
        totalGross: toDecimal(compGrossCents),
        totalNet: toDecimal(compNetCents),
        totalDeductions: toDecimal(compDedCents)
      } : null;

      res.json({
        currentPeriod: {
          id: curPeriod.id,
          code: curPeriod.code,
          name: curPeriod.name,
          status: curPeriod.status,
          headcount: cur.headcount,
          totalGross: toDecimal(curGrossCents),
          totalNet: toDecimal(curNetCents),
          totalDeductions: toDecimal(curDedCents)
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
          deductionsPercent: dedPercent
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
          anomalousCount: anomalousEmployees.length
        },
        anomalousEmployees,
        items: evaluatedEmployees
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
          [identity.orgId]
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({ period: null, metrics: null, departments: [] });
      }

      const periodRes = await pool.query<{ id: string; code: string; name: string; status: string }>(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      const params: any[] = [identity.orgId, periodId];
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

      const departments = deptRes.rows.map(d => {
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
          vasAccountFull: `${vasCode} - ${vasLabel}`
        };
      });

      const costPerEmployeeCents = totalHeadcount > 0 ? orgCtcCents / BigInt(totalHeadcount) : 0n;

      res.json({
        period: { id: period.id, code: period.code, name: period.name, status: period.status, isDraft: period.status !== 'CLOSED' },
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
          costPerEmployee: toDecimal(costPerEmployeeCents)
        },
        departments,
        allocations: departments.map(d => ({
          ...d,
          employerStatutory: d.employerInsurance,
          tradeUnion: d.employerUnion
        }))
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
          [identity.orgId]
        );
        if (latestPeriodRes.rowCount && latestPeriodRes.rows[0]) {
          periodId = latestPeriodRes.rows[0].id;
        }
      }

      if (!periodId) {
        return res.json({ period: null, metrics: null, pagination: { page, pageSize, totalRows: 0, totalPages: 1 }, items: [] });
      }

      const periodRes = await pool.query<{ id: string; code: string; name: string; status: string }>(
        `SELECT id, code, name, status FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
        [periodId, identity.orgId]
      );
      if (!periodRes.rowCount) fail(404, 'PERIOD_NOT_FOUND');
      const period = periodRes.rows[0];

      // 1. Overall liability (Có 3341)
      const liabRes = await pool.query<{ total_payable: string }>(
        `SELECT COALESCE(sum(net_pay), 0)::text AS total_payable
         FROM payroll_slips
         WHERE organization_id = $1 AND period_id = $2`,
        [identity.orgId, periodId]
      );
      const payableLiabilityCents = toCents(liabRes.rows[0]?.total_payable || '0');

      // 2. Total disbursed payments (Nợ 3341 / Có 1121, 1111)
      const disbRes = await pool.query<{ total_disbursed: string; count: number }>(
        `SELECT COALESCE(sum(amount), 0)::text AS total_disbursed, count(*)::int AS count
         FROM payroll_disbursements
         WHERE organization_id = $1 AND period_id = $2`,
        [identity.orgId, periodId]
      );
      const disbursedPaymentCents = toCents(disbRes.rows[0]?.total_disbursed || '0');
      const remainingLiabilityCents = payableLiabilityCents > disbursedPaymentCents
        ? payableLiabilityCents - disbursedPaymentCents
        : 0n;

      const settlementRate = payableLiabilityCents > 0n
        ? parseFloat(((Number(disbursedPaymentCents) / Number(payableLiabilityCents)) * 100).toFixed(1))
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
            settlementStatus
          });
        }
      }

      const totalFiltered = processedItems.length;
      const paginatedItems = processedItems.slice(offset, offset + pageSize);

      res.json({
        period: { id: period.id, code: period.code, name: period.name, status: period.status, isDraft: period.status !== 'CLOSED' },
        metrics: {
          payableLiability: toDecimal(payableLiabilityCents),
          disbursedPayment: toDecimal(disbursedPaymentCents),
          remainingLiability: toDecimal(remainingLiabilityCents),
          disbursementCount: disbRes.rows[0]?.count || 0,
          settlementRate
        },
        pagination: {
          page,
          pageSize,
          totalRows: totalFiltered,
          totalPages: Math.ceil(totalFiltered / pageSize) || 1
        },
        items: paginatedItems
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

      const params: any[] = [identity.orgId];
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
      const entryIds = entriesRes.rows.map(r => r.id);
      const linesMap = new Map<string, any[]>();

      if (entryIds.length > 0) {
        let linesWhere = `l.entry_id = ANY($1::uuid[]) AND l.organization_id = $2`;
        const linesParams: any[] = [entryIds, identity.orgId];
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
            lineOrder: line.line_order
          });
          linesMap.set(line.entry_id, arr);
        }
      }

      let totalDebitCents = 0n;
      let totalCreditCents = 0n;
      let postedCount = 0;
      let draftCount = 0;
      let reversedCount = 0;

      const items = entriesRes.rows.map(r => {
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
          lines: linesMap.get(r.id) || []
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
          isBalanced: totalDebitCents === totalCreditCents
        },
        items
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 6. SHARED REPORTING ENGINE: EXPORT TO CSV (WITH AUDIT LOGGING)
  // =========================================================================

  app.post(`${prefix}/export`, async (req: Authed, res: Response, next) => {
    try {
      const identity = identityFor(req);
      const schema = z.object({
        reportCode: z.enum([
          'RPT-EMP-01', 'RPT-ORG-01', 'RPT-ATT-01', 'RPT-LEAVE-01',
          'RPT-PAY-01', 'RPT-PAY-02', 'RPT-PAY-03',
          'RPT-ACC-01', 'RPT-ACC-02', 'RPT-ACC-03'
        ]),
        format: z.enum(['CSV', 'EXCEL', 'PDF', 'JSON']).default('CSV'),
        filters: z.record(z.string(), z.any()).default({})
      });

      const body = schema.parse(req.body);
      const reportDef = DEFAULT_REPORT_CATALOG.find(r => r.code === body.reportCode);
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

        const params: any[] = [identity.orgId];
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
          csvContent += [
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
            escapeCsvCell(r.personal_email || '')
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
          csvContent += [
            escapeCsvCell(r.code),
            escapeCsvCell(r.name),
            escapeCsvCell(r.parent_name || '—'),
            escapeCsvCell(r.manager_name || 'Chưa phân công'),
            escapeCsvCell(r.is_active ? 'Đang hoạt động' : 'Tạm dừng'),
            escapeCsvCell(r.active_employees),
            escapeCsvCell(r.position_count)
          ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-ATT-01') {
        csvContent += `BÁO CÁO TỔNG HỢP CHẤM CÔNG & CA LÀM VIỆC (RPT-ATT-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const startDate = body.filters.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const endDate = body.filters.endDate || new Date().toISOString().slice(0, 10);

        const params: any[] = [identity.orgId, startDate, endDate];
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
          csvContent += [
            escapeCsvCell(r.work_date),
            escapeCsvCell(r.employee_code),
            escapeCsvCell(r.full_name),
            escapeCsvCell(r.department_name || 'Chưa phân bổ'),
            escapeCsvCell(r.shift_name || 'Ca chuẩn'),
            escapeCsvCell(r.starts_at),
            escapeCsvCell(r.ends_at),
            escapeCsvCell(r.checked_in_at || '—'),
            escapeCsvCell(r.checked_out_at || '—')
          ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-LEAVE-01') {
        csvContent += `BÁO CÁO NGHỈ PHÉP & SỐ DƯ PHÉP (RPT-LEAVE-01)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: any[] = [identity.orgId];
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

          csvContent += [
            escapeCsvCell(r.employee_code),
            escapeCsvCell(r.full_name),
            escapeCsvCell(r.department_name || 'Chưa phân bổ'),
            escapeCsvCell(r.leave_type_name),
            escapeCsvCell((allowance / 480).toFixed(2)),
            escapeCsvCell((charged / 480).toFixed(2)),
            escapeCsvCell((remaining / 480).toFixed(2)),
            escapeCsvCell(rate)
          ].join(',') + '\r\n';
        }
      } else if (body.reportCode === 'RPT-PAY-01') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId]
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
            [periodId, identity.orgId]
          );
          const p = periodRes.rows[0];
          csvContent += `BÁO CÁO BẢNG LƯƠNG TỔNG HỢP & CHI TIẾT THEO KỲ (RPT-PAY-01)\r\n`;
          csvContent += `Kỳ lương: ${p?.name || '—'} (${p?.start_date || '—'} - ${p?.end_date || '—'}) | Trạng thái: ${p?.status === 'CLOSED' ? 'ĐÃ CHỐT' : 'DỰ THẢO'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n`;
          csvContent += `Người xuất: ${identity.email}\r\n\r\n`;

          const params: any[] = [identity.orgId, periodId];
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
            params
          );
          rowCount = slips.rows.length;

          csvContent += `Mã NV,Họ và tên,Phòng ban,Chức danh,Lương cơ bản (VND),Lương tính công (VND),Phụ cấp (VND),Thưởng (VND),Tổng thu nhập Gross (VND),Tổng khấu trừ (VND),Thực lĩnh Net (VND),Trạng thái phiếu\r\n`;
          for (const s of slips.rows) {
            csvContent += [
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
              escapeCsvCell(s.status)
            ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-PAY-02') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId]
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId]
          );
          csvContent += `BÁO CÁO CƠ CẤU PHỤ CẤP, THƯỞNG & KHẤU TRỪ (RPT-PAY-02)\r\n`;
          csvContent += `Kỳ lương: ${periodRes.rows[0]?.name || '—'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

          const params: any[] = [identity.orgId, periodId];
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
            params
          );
          rowCount = itemsRes.rows.length;

          csvContent += `Tên khoản mục,Phân loại,Tính chịu thuế,Số người nhận,Tổng số tiền (VND)\r\n`;
          for (const it of itemsRes.rows) {
            const nameLower = it.component_name.toLowerCase();
            const isNonTaxable = /ăn trưa|xăng xe|đồng phục|trang phục|công tác phí|điện thoại/i.test(nameLower);
            const taxableText = it.type === 'ALLOWANCE' ? (isNonTaxable ? 'Miễn thuế' : 'Chịu thuế') : (it.type === 'BONUS' ? 'Chịu thuế' : 'Khấu trừ');

            csvContent += [
              escapeCsvCell(it.component_name),
              escapeCsvCell(it.type),
              escapeCsvCell(taxableText),
              escapeCsvCell(it.recipient_count),
              escapeCsvCell(toDecimal(toCents(it.total_amount)))
            ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-PAY-03') {
        let currentPeriodId = body.filters.currentPeriodId ? uuid.parse(body.filters.currentPeriodId) : undefined;
        let previousPeriodId = body.filters.previousPeriodId ? uuid.parse(body.filters.previousPeriodId) : undefined;

        if (!currentPeriodId) {
          const latestTwo = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 2`,
            [identity.orgId]
          );
          if (latestTwo.rowCount && latestTwo.rows[0]) currentPeriodId = latestTwo.rows[0].id;
          if (latestTwo.rowCount && latestTwo.rows.length > 1 && !previousPeriodId) previousPeriodId = latestTwo.rows[1].id;
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
            [identity.orgId, currentPeriodId, ...scope.params]
          );

          const prevMap = new Map<string, bigint>();
          if (previousPeriodId) {
            const prevRes = await pool.query<{ employee_id: string; net_pay: string }>(
              `SELECT s.employee_id, s.net_pay::text AS net_pay
               FROM payroll_slips s
               WHERE s.organization_id = $1 AND s.period_id = $2`,
              [identity.orgId, previousPeriodId]
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

            csvContent += [
              escapeCsvCell(curr.employee_code),
              escapeCsvCell(curr.full_name),
              escapeCsvCell(curr.department_name || 'Chưa phân bổ'),
              escapeCsvCell(toDecimal(prevNet)),
              escapeCsvCell(toDecimal(currNet)),
              escapeCsvCell(toDecimal(diff)),
              escapeCsvCell(`${variancePct.toFixed(2)}%`),
              escapeCsvCell(isAnomaly ? 'BIẾN ĐỘNG MẠNH (>=20%)' : 'Bình thường')
            ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-ACC-01') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId]
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId]
          );
          csvContent += `BÁO CÁO PHÂN BỔ CHI PHÍ LƯƠNG THEO PHÒNG BAN & TÀI KHOẢN KẾ TOÁN (VAS) (RPT-ACC-01)\r\n`;
          csvContent += `Kỳ lương: ${periodRes.rows[0]?.name || '—'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

          const params: any[] = [identity.orgId, periodId];
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
            params
          );
          rowCount = deptRes.rows.length;

          csvContent += `Mã phòng ban,Tên phòng ban,Tài khoản VAS,Tên tài khoản,Số nhân sự,Lương & phụ cấp (VND),BH bắt buộc DN 21.5% (VND),Kinh phí CĐ 2% (VND),Tổng chi phí CTC (VND)\r\n`;
          for (const d of deptRes.rows) {
            const grossCents = toCents(d.gross_amount);
            const statutoryCents = (grossCents * 215n) / 1000n;
            const unionCents = (grossCents * 20n) / 1000n;
            const ctcCents = grossCents + statutoryCents + unionCents;

            const deptCode = (d.department_code || '').toUpperCase();
            const vasAccount = (deptCode.includes('SALE') || deptCode.includes('MKT') || deptCode.includes('KD')) ? '6421' : '6422';
            const vasName = vasAccount === '6421' ? 'Chi phí bán hàng' : 'Chi phí quản lý DN';

            csvContent += [
              escapeCsvCell(d.department_code || 'UNASSIGNED'),
              escapeCsvCell(d.department_name || 'Chưa phân bổ'),
              escapeCsvCell(vasAccount),
              escapeCsvCell(vasName),
              escapeCsvCell(d.headcount),
              escapeCsvCell(toDecimal(grossCents)),
              escapeCsvCell(toDecimal(statutoryCents)),
              escapeCsvCell(toDecimal(unionCents)),
              escapeCsvCell(toDecimal(ctcCents))
            ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-ACC-02') {
        let periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        if (!periodId) {
          const latest = await pool.query<{ id: string }>(
            `SELECT id FROM payroll_periods WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [identity.orgId]
          );
          if (latest.rowCount && latest.rows[0]) periodId = latest.rows[0].id;
        }

        if (periodId) {
          const periodRes = await pool.query<{ code: string; name: string }>(
            `SELECT code, name FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
            [periodId, identity.orgId]
          );
          csvContent += `BÁO CÁO CÔNG NỢ LƯƠNG & ĐỐI CHIẾU THANH TOÁN (RPT-ACC-02)\r\n`;
          csvContent += `Kỳ lương: ${periodRes.rows[0]?.name || '—'}\r\n`;
          csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

          const params: any[] = [identity.orgId, periodId];
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
            params
          );

          const disbRes = await pool.query<{ employee_id: string; disbursed_amount: string }>(
            `SELECT employee_id, sum(amount)::text AS disbursed_amount
             FROM payroll_disbursements
             WHERE organization_id = $1 AND period_id = $2 AND status = 'COMPLETED'
             GROUP BY employee_id`,
            [identity.orgId, periodId]
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

            csvContent += [
              escapeCsvCell(s.employee_code),
              escapeCsvCell(s.full_name),
              escapeCsvCell(s.department_name || 'Chưa phân bổ'),
              escapeCsvCell(toDecimal(payable)),
              escapeCsvCell(toDecimal(disbursed)),
              escapeCsvCell(toDecimal(remaining)),
              escapeCsvCell(status)
            ].join(',') + '\r\n';
          }
        }
      } else if (body.reportCode === 'RPT-ACC-03') {
        const periodId = body.filters.periodId ? uuid.parse(body.filters.periodId) : undefined;
        const status = body.filters.status ? String(body.filters.status).toUpperCase() : undefined;

        csvContent += `BÁO CÁO SỔ NHẬT KÝ BÚT TOÁN KẾ TOÁN LƯƠNG (RPT-ACC-03)\r\n`;
        csvContent += `Thời điểm xuất: ${exportTime}\r\n\r\n`;

        const params: any[] = [identity.orgId];
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
          params
        );

        const entryIds = entriesRes.rows.map(r => r.id);
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
            [entryIds]
          );

          const entryMap = new Map(entriesRes.rows.map(e => [e.id, e]));
          rowCount = linesRes.rows.length;

          csvContent += `Số chứng từ,Ngày hạch toán,Diễn giải nghiệp vụ,Tài khoản,Tên tài khoản,Nợ/Có,Số tiền (VND),Phòng ban,Trạng thái chứng từ\r\n`;
          for (const l of linesRes.rows) {
            const entry = entryMap.get(l.entry_id);
            const deb = toCents(l.debit_amount);
            const cred = toCents(l.credit_amount);
            const direction = deb > 0n ? 'NỢ' : 'CÓ';
            const amount = deb > 0n ? deb : cred;

            csvContent += [
              escapeCsvCell(entry?.entry_number || '—'),
              escapeCsvCell(entry?.entry_date || '—'),
              escapeCsvCell(entry?.description || '—'),
              escapeCsvCell(l.account_code),
              escapeCsvCell(l.account_name),
              escapeCsvCell(direction),
              escapeCsvCell(toDecimal(amount)),
              escapeCsvCell(l.department_name || 'Chung'),
              escapeCsvCell(entry?.status || '—')
            ].join(',') + '\r\n';
          }
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
          req.get('user-agent') || null
        ]
      );

      await audit(pool, 'REPORT_EXPORTED', identity.userId, identity.orgId, undefined, {
        reportCode: body.reportCode,
        format: body.format,
        rowCount
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${body.reportCode}_${Date.now()}.csv"`);
      res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 7. SAVED TEMPLATES & EXPORT AUDIT LOGS
  // =========================================================================

  // GET /api/organizations/:orgId/reports/templates
  app.get(`${prefix}/templates`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const rows = await pool.query<{
        id: string;
        report_code: string;
        template_name: string;
        filters: any;
        created_at: string;
      }>(
        `SELECT id, report_code, template_name, filters, created_at::text AS created_at
         FROM report_saved_templates
         WHERE organization_id = $1 AND user_id = $2
         ORDER BY template_name ASC`,
        [identity.orgId, identity.userId]
      );

      res.json({
        templates: rows.rows.map(r => ({
          id: r.id,
          reportCode: r.report_code,
          templateName: r.template_name,
          filters: r.filters,
          createdAt: r.created_at
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/organizations/:orgId/reports/templates
  app.post(`${prefix}/templates`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const schema = z.object({
        reportCode: z.string().min(1),
        templateName: z.string().trim().min(1).max(100),
        filters: z.record(z.string(), z.any()).default({})
      });
      const body = schema.parse(req.body);

      const id = randomUUID();
      await pool.query(
        `INSERT INTO report_saved_templates (id, organization_id, report_code, user_id, template_name, filters)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (organization_id, user_id, template_name) DO UPDATE
         SET report_code = EXCLUDED.report_code,
             filters = EXCLUDED.filters,
             updated_at = now()`,
        [id, identity.orgId, body.reportCode, identity.userId, body.templateName, JSON.stringify(body.filters)]
      );

      res.status(201).json({ id, message: 'Template saved successfully' });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/organizations/:orgId/reports/templates/:id
  app.delete(`${prefix}/templates/:id`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      const templateId = uuid.parse(req.params.id);

      const del = await pool.query(
        `DELETE FROM report_saved_templates
         WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [templateId, identity.orgId, identity.userId]
      );

      if (!del.rowCount) fail(404, 'TEMPLATE_NOT_FOUND');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/organizations/:orgId/reports/export-audit
  app.get(`${prefix}/export-audit`, async (req: Authed, res, next) => {
    try {
      const identity = identityFor(req);
      if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');

      const rows = await pool.query<{
        id: string;
        report_code: string;
        format: string;
        row_count: number;
        filters: any;
        exported_by: string;
        user_name: string;
        user_email: string;
        exported_at: string;
      }>(
        `SELECT
          a.id, a.report_code, a.format, a.row_count, a.filters,
          a.exported_by, u.full_name AS user_name, u.email AS user_email,
          a.exported_at::text AS exported_at
        FROM report_export_audit_logs a
        JOIN users u ON u.id = a.exported_by
        WHERE a.organization_id = $1
        ORDER BY a.exported_at DESC
        LIMIT 100`,
        [identity.orgId]
      );

      res.json({
        auditLogs: rows.rows.map(r => ({
          id: r.id,
          reportCode: r.report_code,
          format: r.format,
          rowCount: r.row_count,
          filters: r.filters,
          exportedBy: r.exported_by,
          userName: r.user_name,
          userEmail: r.user_email,
          exportedAt: r.exported_at
        }))
      });
    } catch (err) {
      next(err);
    }
  });
}
