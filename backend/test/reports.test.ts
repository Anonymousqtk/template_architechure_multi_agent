import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import type { Mailer } from '../src/mail.js';

if (process.env.MIGRATION_TEST_BACKEND !== 'true' || !process.env.DATABASE_URL) {
  throw new Error('Run through backend/test-runner.mjs; a disposable PostgreSQL database is required.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const origin = 'http://localhost:3000';
const password = 'Correct horse test password 7!';
const config = { requireMfa: false, origin, production: false, csrfSecret: 'test-only-secret-'.repeat(4) };
const servers: Server[] = [];
let base: string;
let orgA: string;
let orgB: string;
let adminId: string;
let hrId: string;
let managerId: string;
let employeeId: string;
let employeeId2: string;
let passwordHash: string;
const mailer: Mailer = { mode: 'SMTP', async send() { return 'SENT'; } };

let deptDevId: string;
let deptSalesId: string;
let posDevId: string;
let empDevRecordId: string;
let empSalesRecordId: string;
let shiftMorningId: string;

async function start() {
  const app = createApp({ pool, config, mailer, rateLimit: 500 });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP listener');
  return `http://127.0.0.1:${address.port}`;
}

class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(public url = base) {}
  async request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(this.url + path, {
      method,
      headers: {
        Cookie: [...this.cookies.values()].join('; '),
        ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      this.cookies.set(pair.split('=')[0], pair);
    }
    const text = await response.text();
    let parsed: any = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return { status: response.status, headers: response.headers, body: parsed, text };
  }
  async initialize() {
    const res = await this.request('/api/auth/csrf');
    this.csrf = res.body.csrfToken;
    return this;
  }
  async login(email: string) {
    await this.initialize();
    return this.request('/api/auth/login', 'POST', { email, password });
  }
  delete(path: string, body: unknown = {}) {
    return this.request(path, 'DELETE', body);
  }
}

async function createUser(email: string, org: string, role: string, fullName = 'User') {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users(id, email, full_name, password_hash, email_verified_at, is_active) VALUES($1, $2, $3, $4, now(), true)',
    [id, email.toLowerCase(), fullName, passwordHash]
  );
  await pool.query(
    'INSERT INTO memberships(id, user_id, organization_id, role, is_active) VALUES($1, $2, $3, $4, true)',
    [randomUUID(), id, org, role]
  );
  return id;
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
  base = await start();
}, 30000);

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE report_export_audit_logs, report_saved_templates, report_catalog, attendance_punches, work_schedule, work_shifts, leave_requests, leave_balances, leave_types, employee_contracts, employee_work_history, employee_documents, employees, positions, departments, auth_audit_events, user_sessions, password_reset_tokens, invitations, memberships, users, organizations, auth_rate_limits CASCADE'
  );

  orgA = randomUUID();
  orgB = randomUUID();
  await pool.query('INSERT INTO organizations(id, name, code) VALUES($1, $2, $3), ($4, $5, $6)', [
    orgA, 'Acme Corp', 'ACME',
    orgB, 'Beta Corp', 'BETA'
  ]);

  adminId = await createUser('admin@acme.test', orgA, 'ADMIN', 'Admin User');
  hrId = await createUser('hr@acme.test', orgA, 'HR', 'HR User');
  managerId = await createUser('manager@acme.test', orgA, 'MANAGER', 'Manager User');
  employeeId = await createUser('dev@acme.test', orgA, 'EMPLOYEE', 'Dev Employee');
  employeeId2 = await createUser('sales@acme.test', orgA, 'EMPLOYEE', 'Sales Employee');

  // Create departments
  deptDevId = randomUUID();
  deptSalesId = randomUUID();
  await pool.query(
    `INSERT INTO departments(id, organization_id, code, name, manager_user_id)
     VALUES ($1, $2, 'DEV', 'Phòng Công nghệ', $3),
            ($4, $2, 'SALES', 'Phòng Kinh doanh', NULL)`,
    [deptDevId, orgA, managerId, deptSalesId]
  );

  // Create position
  posDevId = randomUUID();
  await pool.query(
    `INSERT INTO positions(id, organization_id, department_id, code, title)
     VALUES ($1, $2, $3, 'DEV-SENIOR', 'Kỹ sư phần mềm cao cấp')`,
    [posDevId, orgA, deptDevId]
  );

  // Link manager to Dev department in membership
  await pool.query(
    `UPDATE memberships SET department_id = $1 WHERE user_id = $2 AND organization_id = $3`,
    [deptDevId, managerId, orgA]
  );
  await pool.query(
    `UPDATE memberships SET department_id = $1, position_id = $2, manager_user_id = $3
     WHERE user_id = $4 AND organization_id = $5`,
    [deptDevId, posDevId, managerId, employeeId, orgA]
  );
  await pool.query(
    `UPDATE memberships SET department_id = $1
     WHERE user_id = $2 AND organization_id = $3`,
    [deptSalesId, employeeId2, orgA]
  );

  // Create employees
  empDevRecordId = randomUUID();
  empSalesRecordId = randomUUID();
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id, phone, personal_email)
     VALUES ($1, $2, $3, 'EMP001', 'Dev Employee', '2023-01-15', 'ACTIVE', $4, $5, $6, '0901234567', 'dev@personal.test')`,
    [empDevRecordId, orgA, employeeId, deptDevId, posDevId, managerId]
  );
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id, phone, personal_email)
     VALUES ($1, $2, $3, 'EMP002', 'Sales Employee', '2024-05-01', 'ACTIVE', $4, NULL, NULL, '0907654321', 'sales@personal.test')`,
    [empSalesRecordId, orgA, employeeId2, deptSalesId]
  );

  // Create contracts
  const contractId1 = randomUUID();
  const contractId2 = randomUUID();
  await pool.query(
    `INSERT INTO employee_contracts(id, organization_id, employee_id, contract_number, contract_type, start_date, status)
     VALUES ($1, $2, $3, 'HD-DEV-001', 'INDEFINITE', '2023-01-15', 'DRAFT')`,
    [contractId1, orgA, empDevRecordId]
  );
  await pool.query(
    `UPDATE employee_contracts SET status = 'ACTIVE', signed_on = '2023-01-15' WHERE id = $1`,
    [contractId1]
  );

  await pool.query(
    `INSERT INTO employee_contracts(id, organization_id, employee_id, contract_number, contract_type, start_date, end_date, status)
     VALUES ($1, $2, $3, 'HD-SALES-001', 'FIXED_TERM', '2024-05-01', '2027-05-01', 'DRAFT')`,
    [contractId2, orgA, empSalesRecordId]
  );
  await pool.query(
    `UPDATE employee_contracts SET status = 'ACTIVE', signed_on = '2024-05-01' WHERE id = $1`,
    [contractId2]
  );

  // Create work shift
  shiftMorningId = randomUUID();
  await pool.query(
    `INSERT INTO work_shifts(id, organization_id, name, time_zone, start_time, end_time, early_check_in, late_grace, early_grace)
     VALUES ($1, $2, 'Ca Sáng', 'Asia/Ho_Chi_Minh', '08:30:00', '17:30:00', 30, 15, 15)`,
    [shiftMorningId, orgA]
  );

  // Create work schedule & punch
  const schedId1 = randomUUID();
  await pool.query(
    `INSERT INTO work_schedule(id, organization_id, employee_id, shift_id, label, work_date, time_zone, starts_at, ends_at, early_check_in, late_grace, early_grace, attendance_kind)
     VALUES ($1, $2, $3, $4, 'Ca Sáng', '2026-03-10', 'Asia/Ho_Chi_Minh', '2026-03-10 01:30:00+00', '2026-03-10 10:30:00+00', 30, 15, 15, 'SHIFT')`,
    [schedId1, orgA, empDevRecordId, shiftMorningId]
  );
  await pool.query(
    `INSERT INTO attendance_punches(schedule_id, organization_id, checked_in_at, checked_out_at)
     VALUES ($1, $2, '2026-03-10 01:40:00+00', '2026-03-10 10:30:00+00')`,
    [schedId1, orgA]
  );

  // Create leave types, balances and requests
  const leaveTypeId = randomUUID();
  await pool.query(
    `INSERT INTO leave_types(id, organization_id, name, tracks_balance, active)
     VALUES ($1, $2, 'Nghỉ phép năm', true, true)`,
    [leaveTypeId, orgA]
  );
  await pool.query(
    `INSERT INTO leave_balances(organization_id, employee_id, leave_type_id, allowance_minutes)
     VALUES ($1, $2, $3, 5760)`, // 12 days * 480 mins
    [orgA, empDevRecordId, leaveTypeId]
  );
  await pool.query(
    `INSERT INTO leave_requests(id, organization_id, employee_id, leave_type_id, created_by, starts_at, ends_at, reason, status, charge_minutes, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, '2026-03-15 01:30:00+00', '2026-03-15 10:30:00+00', 'Nghỉ việc cá nhân', 'APPROVED', 480, $6, now())`,
    [randomUUID(), orgA, empDevRecordId, leaveTypeId, employeeId, hrId]
  );
});

describe('RPT-001: Core HR & Attendance Reporting Center', () => {
  it('1. Auto-seeds default report catalog and respects RBAC visibility', async () => {
    const admin = new Client();
    await admin.login('admin@acme.test');

    const catRes = await admin.request(`/api/organizations/${orgA}/reports/catalog`);
    expect(catRes.status).toBe(200);
    expect(catRes.body.reports.length).toBe(4);
    const codes = catRes.body.reports.map((r: any) => r.code);
    expect(codes).toContain('RPT-EMP-01');
    expect(codes).toContain('RPT-ORG-01');
    expect(codes).toContain('RPT-ATT-01');
    expect(codes).toContain('RPT-LEAVE-01');

    // Manager sees all 4 reports
    const manager = new Client();
    await manager.login('manager@acme.test');
    const mgrCat = await manager.request(`/api/organizations/${orgA}/reports/catalog`);
    expect(mgrCat.status).toBe(200);
    expect(mgrCat.body.reports.length).toBe(4);

    // Employee sees only attendance and leave reports
    const employee = new Client();
    await employee.login('dev@acme.test');
    const empCat = await employee.request(`/api/organizations/${orgA}/reports/catalog`);
    expect(empCat.status).toBe(200);
    expect(empCat.body.reports.length).toBe(2);
    const empCodes = empCat.body.reports.map((r: any) => r.code);
    expect(empCodes).toContain('RPT-ATT-01');
    expect(empCodes).toContain('RPT-LEAVE-01');
    expect(empCodes).not.toContain('RPT-EMP-01');
    expect(empCodes).not.toContain('RPT-ORG-01');
  });

  it('2. RPT-EMP-01: Headcount, department/contract breakdown, tenure, and scope', async () => {
    const hr = new Client();
    await hr.login('hr@acme.test');

    // HR sees full tenant roster (2 employees)
    const res = await hr.request(`/api/organizations/${orgA}/reports/emp-roster`);
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalEmployees).toBe(2);
    expect(res.body.metrics.activeEmployees).toBe(2);
    expect(res.body.metrics.departmentBreakdown.length).toBeGreaterThan(0);
    expect(res.body.metrics.contractBreakdown.length).toBeGreaterThan(0);
    expect(res.body.items.length).toBe(2);

    // Filter by department
    const devOnly = await hr.request(`/api/organizations/${orgA}/reports/emp-roster?departmentId=${deptDevId}`);
    expect(devOnly.status).toBe(200);
    expect(devOnly.body.metrics.totalEmployees).toBe(1);
    expect(devOnly.body.items[0].employeeCode).toBe('EMP001');

    // Filter by contract type
    const indefOnly = await hr.request(`/api/organizations/${orgA}/reports/emp-roster?contractType=INDEFINITE`);
    expect(indefOnly.status).toBe(200);
    expect(indefOnly.body.metrics.totalEmployees).toBe(1);
    expect(indefOnly.body.items[0].contractNumber).toBe('HD-DEV-001');

    // Manager only sees Dev employee in their management scope
    const manager = new Client();
    await manager.login('manager@acme.test');
    const mgrRes = await manager.request(`/api/organizations/${orgA}/reports/emp-roster`);
    expect(mgrRes.status).toBe(200);
    expect(mgrRes.body.metrics.totalEmployees).toBe(1);
    expect(mgrRes.body.items[0].employeeCode).toBe('EMP001');

    // Employee role is denied access (403)
    const emp = new Client();
    await emp.login('dev@acme.test');
    const empRes = await emp.request(`/api/organizations/${orgA}/reports/emp-roster`);
    expect(empRes.status).toBe(403);
  });

  it('3. RPT-ORG-01: Department structure, position count, manager coverage', async () => {
    const admin = new Client();
    await admin.login('admin@acme.test');

    const res = await admin.request(`/api/organizations/${orgA}/reports/org-structure`);
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalDepartments).toBe(2);
    expect(res.body.metrics.totalAssignedEmployees).toBe(2);
    expect(res.body.metrics.departmentsWithManager).toBe(1);
    expect(res.body.metrics.departmentsWithoutManager).toBe(1);
    expect(res.body.items.length).toBe(2);

    const devDept = res.body.items.find((d: any) => d.code === 'DEV');
    expect(devDept).toBeDefined();
    expect(devDept.managerName).toBe('Manager User');
    expect(devDept.employeeCount).toBe(1);
    expect(devDept.positionCount).toBe(1);
    expect(devDept.positions[0].code).toBe('DEV-SENIOR');

    // Employee is denied access
    const emp = new Client();
    await emp.login('dev@acme.test');
    const empRes = await emp.request(`/api/organizations/${orgA}/reports/org-structure`);
    expect(empRes.status).toBe(403);
  });

  it('4. RPT-ATT-01: Attendance & Shift Summary metrics, late/early calculations', async () => {
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/attendance-summary?startDate=2026-03-01&endDate=2026-03-31`
    );
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalSchedules).toBe(1);
    expect(res.body.metrics.presentCount).toBe(1);
    expect(res.body.metrics.onTimeCount).toBe(1); // Within 15m grace period
    expect(res.body.items[0].employeeCode).toBe('EMP001');
    expect(res.body.items[0].shiftName).toBe('Ca Sáng');
    expect(res.body.items[0].status).toBe('ON_TIME');

    // Employee query: employee can access their own attendance summary
    const emp = new Client();
    await emp.login('dev@acme.test');
    const empRes = await emp.request(
      `/api/organizations/${orgA}/reports/attendance-summary?startDate=2026-03-01&endDate=2026-03-31`
    );
    expect(empRes.status).toBe(200);
    expect(empRes.body.items.length).toBe(1);
    expect(empRes.body.items[0].employeeCode).toBe('EMP001');
  });

  it('5. RPT-LEAVE-01: Leave utilization, allowance, charged hours, balance', async () => {
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/leave-summary?startDate=2026-03-01&endDate=2026-03-31`
    );
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalAllowanceDays).toBeGreaterThan(0);
    expect(res.body.metrics.totalChargedDays).toBe(1); // 480m / 480 = 1 day
    expect(res.body.metrics.totalLeaveRequests).toBe(1);
    expect(res.body.metrics.approvedRequests).toBe(1);
    expect(res.body.balances.length).toBe(2);

    const devBalance = res.body.balances.find((b: any) => b.employeeCode === 'EMP001');
    expect(devBalance).toBeDefined();
    expect(devBalance.allowanceDays).toBe(12);
    expect(devBalance.chargedDays).toBe(1);
    expect(devBalance.remainingDays).toBe(11);
    expect(devBalance.utilizationRate).toBe(8.3); // 1 / 12 * 100

    expect(res.body.requests.length).toBe(1);
    expect(res.body.requests[0].reviewerName).toBe('HR User');
  });

  it('6. Shared Export Engine generates UTF-8 BOM CSV and logs export audit', async () => {
    const hr = new Client();
    await hr.login('hr@acme.test');

    // Export RPT-EMP-01
    const exportRes = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-EMP-01',
      format: 'CSV',
      filters: { status: 'ACTIVE' }
    });

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('text/csv');
    expect(exportRes.text).toContain('BÁO CÁO NHÂN SỰ & BIẾN ĐỘNG');
    expect(exportRes.text).toContain('Mã NV,Họ và tên,Phòng ban');
    expect(exportRes.text).toContain('EMP001,Dev Employee');

    // Verify audit log recorded
    const auditRes = await hr.request(`/api/organizations/${orgA}/reports/export-audit`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.auditLogs.length).toBeGreaterThan(0);
    expect(auditRes.body.auditLogs[0].reportCode).toBe('RPT-EMP-01');
    expect(auditRes.body.auditLogs[0].rowCount).toBe(2);
    expect(auditRes.body.auditLogs[0].userEmail).toBe('hr@acme.test');

    // Employee cannot export RPT-EMP-01 (403)
    const emp = new Client();
    await emp.login('dev@acme.test');
    const empExport = await emp.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-EMP-01',
      format: 'CSV'
    });
    expect(empExport.status).toBe(403);
  });

  it('7. Report Filter Preset Templates: CRUD lifecycle', async () => {
    const hr = new Client();
    await hr.login('hr@acme.test');

    // 1. Create template
    const createRes = await hr.request(`/api/organizations/${orgA}/reports/templates`, 'POST', {
      reportCode: 'RPT-EMP-01',
      templateName: 'Nhân sự bộ phận Dev',
      filters: { departmentId: deptDevId, status: 'ACTIVE' }
    });
    expect(createRes.status).toBe(201);
    const templateId = createRes.body.id;

    // 2. List templates
    const listRes = await hr.request(`/api/organizations/${orgA}/reports/templates`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.templates.length).toBe(1);
    expect(listRes.body.templates[0].templateName).toBe('Nhân sự bộ phận Dev');

    // 3. Delete template
    const delRes = await hr.delete(`/api/organizations/${orgA}/reports/templates/${templateId}`);
    expect(delRes.status).toBe(200);

    const emptyList = await hr.request(`/api/organizations/${orgA}/reports/templates`);
    expect(emptyList.body.templates.length).toBe(0);
  });
});
