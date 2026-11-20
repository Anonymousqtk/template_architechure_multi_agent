import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';

if (process.env.MIGRATION_TEST_BACKEND !== 'true' || !process.env.DATABASE_URL) {
  throw new Error('Disposable PostgreSQL required');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const origin = 'http://localhost:3000';
const password = 'Payroll integration test password 7!';

let server: Server;
let base: string;
let hash: string;
let org: string;
let otherOrg: string;
let adminId: string;
let hrId: string;
let managerId: string;
let employeeUserId: string;
let outsiderUserId: string;
let departmentId: string;
let positionId: string;
let employeeId: string;

class Client {
  cookies = new Map<string, string>();
  csrf = '';
  async call(path: string, method = 'GET', body?: unknown) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: [...this.cookies.values()].join('; '),
        ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      this.cookies.set(pair.split('=')[0], pair);
    }
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }
  async login(email: string) {
    this.csrf = (await this.call('/api/auth/csrf')).body.csrfToken;
    expect((await this.call('/api/auth/login', 'POST', { email, password })).status).toBe(200);
    return this;
  }
}

async function actor(role: string) {
  return new Client().login(`${role}@payroll.test`);
}

async function user(email: string, role: string, tenant = org) {
  const id = randomUUID();
  await pool.query('INSERT INTO users(id, email, full_name, password_hash, email_verified_at) VALUES($1, $2, $2, $3, now())', [id, email, hash]);
  await pool.query('INSERT INTO memberships(id, user_id, organization_id, role) VALUES($1, $2, $3, $4)', [randomUUID(), id, tenant, role]);
  return id;
}

const payrollPath = () => `/api/organizations/${org}/payroll`;
const empPath = () => `/api/organizations/${org}/employees`;

beforeAll(async () => {
  hash = await hashPassword(password);
  const app = createApp({
    pool,
    config: { origin, production: false, requireMfa: false, csrfSecret: 'payroll-tests-only-'.repeat(4) },
    rateLimit: 1000,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('No server');
  base = `http://127.0.0.1:${a.port}`;
}, 30000);

beforeEach(async () => {
  await pool.query('TRUNCATE organizations, users, memberships, departments, positions, user_sessions, invitations, auth_audit_events, auth_rate_limits, salary_components, employee_salary_profiles, payroll_periods, payroll_slips, payroll_slip_items CASCADE');
  org = randomUUID();
  otherOrg = randomUUID();
  departmentId = randomUUID();
  positionId = randomUUID();

  await pool.query("INSERT INTO organizations(id, name) VALUES($1, 'Payroll Corp'), ($2, 'Other Corp')", [org, otherOrg]);

  adminId = await user('admin@payroll.test', 'ADMIN');
  hrId = await user('hr@payroll.test', 'HR');
  managerId = await user('manager@payroll.test', 'MANAGER');
  employeeUserId = await user('employee@payroll.test', 'EMPLOYEE');
  outsiderUserId = await user('outsider@payroll.test', 'EMPLOYEE', otherOrg);

  await pool.query('INSERT INTO departments(id, organization_id, code, name, manager_user_id) VALUES($1, $2, $3, $4, $5)', [
    departmentId, org, 'ENG', 'Engineering', managerId,
  ]);
  await pool.query('INSERT INTO positions(id, organization_id, department_id, code, title) VALUES($1, $2, $3, $4, $5)', [
    positionId, org, departmentId, 'SE', 'Software Engineer',
  ]);
  await pool.query('UPDATE memberships SET department_id = $1, position_id = $2, manager_user_id = $3 WHERE organization_id = $4 AND user_id = $5', [
    departmentId, positionId, managerId, org, employeeUserId,
  ]);

  // Create an employee linked to employeeUserId
  employeeId = randomUUID();
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id)
     VALUES ($1, $2, $3, 'EMP-001', 'Test Employee', '2025-01-01', 'ACTIVE', $4, $5, $6)`,
    [employeeId, org, employeeUserId, departmentId, positionId, managerId]
  );
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(r => server.close(() => r()));
  await pool.end();
});

describe('PAY-001 Payroll, Salary Components & Allowance Management', () => {
  it('allows Admin & HR to manage salary components with uniqueness & validation', async () => {
    const admin = await actor('admin');
    const hr = await actor('hr');
    const emp = await actor('employee');

    // 1. Employee cannot create components (403)
    const empCreate = await emp.call(`${payrollPath()}/components`, 'POST', {
      code: 'LUNCH',
      name: 'Phụ cấp ăn trưa',
      type: 'ALLOWANCE',
      defaultAmount: 730000,
    });
    expect(empCreate.status).toBe(403);

    // 2. HR can create allowance component
    const createRes = await hr.call(`${payrollPath()}/components`, 'POST', {
      code: 'LUNCH',
      name: 'Phụ cấp ăn trưa',
      type: 'ALLOWANCE',
      calculationType: 'FIXED',
      isTaxable: false,
      isStatutory: false,
      defaultAmount: 730000,
      description: 'Phụ cấp bữa ăn ca',
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.code).toBe('LUNCH');
    const componentId = createRes.body.id;

    // 3. Duplicate code in same tenant returns 409
    const dupRes = await admin.call(`${payrollPath()}/components`, 'POST', {
      code: 'lunch',
      name: 'Ăn trưa trùng',
      type: 'ALLOWANCE',
    });
    expect(dupRes.status).toBe(409);

    // 4. Update component
    const updateRes = await admin.call(`${payrollPath()}/components/${componentId}`, 'PUT', {
      name: 'Phụ cấp ăn trưa (Cập nhật)',
      calculationType: 'FIXED',
      isTaxable: false,
      isStatutory: false,
      defaultAmount: 800000,
      active: true,
      description: 'Nâng mức phụ cấp',
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Phụ cấp ăn trưa (Cập nhật)');

    // 5. Query components catalog
    const catalogRes = await hr.call(`${payrollPath()}/catalog`);
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.body.components.length).toBe(1);
    expect(catalogRes.body.components[0].code).toBe('LUNCH');
  });

  it('manages employee salary profiles and enforces access control and date integrity', async () => {
    const admin = await actor('admin');
    const hr = await actor('hr');
    const emp = await actor('employee');

    // Create an allowance and deduction component
    const lunchComp = (await admin.call(`${payrollPath()}/components`, 'POST', {
      code: 'LUNCH', name: 'Ăn trưa', type: 'ALLOWANCE', defaultAmount: 730000,
    })).body.id;
    const unionComp = (await admin.call(`${payrollPath()}/components`, 'POST', {
      code: 'UNION', name: 'Đoàn phí', type: 'DEDUCTION', defaultAmount: 100000,
    })).body.id;

    // 1. Invalid date (effectiveTo < effectiveFrom) returns 400
    const invalidDate = await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 22000000,
      effectiveFrom: '2026-02-01',
      effectiveTo: '2026-01-01',
      components: [],
    });
    expect(invalidDate.status).toBe(400);

    // 2. Set employee salary profile
    const setProfile = await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 22000000,
      effectiveFrom: '2026-01-01',
      currency: 'VND',
      bankAccountNumber: '123456789',
      bankName: 'Vietcombank',
      components: [
        { componentId: lunchComp, amount: 730000 },
        { componentId: unionComp, amount: 100000 },
      ],
    });
    expect(setProfile.status).toBe(200);

    // 3. Employee can read own salary profile
    const empRead = await emp.call(`${payrollPath()}/employees/${employeeId}/salary-profile`);
    expect(empRead.status).toBe(200);
    expect(Number(empRead.body.profile.baseSalary)).toBe(22000000);
    expect(empRead.body.components.length).toBe(2);

    // 4. Employee cannot mutate profile (403)
    const empMutate = await emp.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'NET',
      baseSalary: 50000000,
      effectiveFrom: '2026-01-01',
      components: [],
    });
    expect(empMutate.status).toBe(403);
  });

  it('calculates draft payroll with exact decimal math and attendance integration', async () => {
    const admin = await actor('admin');
    const hr = await actor('hr');
    const emp = await actor('employee');
    const mgr = await actor('manager');

    // Create components
    const allowance = (await admin.call(`${payrollPath()}/components`, 'POST', {
      code: 'ALLOW_TRANSPORT', name: 'Xăng xe', type: 'ALLOWANCE', defaultAmount: 1000000,
    })).body.id;
    const deduction = (await admin.call(`${payrollPath()}/components`, 'POST', {
      code: 'DEDUCT_HEALTH', name: 'Bảo hiểm tự nguyện', type: 'DEDUCTION', defaultAmount: 500000,
    })).body.id;

    // Set salary profile: Base = 22,000,000, Allowance = 1,000,000, Deduction = 500,000
    await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 22000000,
      effectiveFrom: '2026-01-01',
      components: [
        { componentId: allowance, amount: 1000000 },
        { componentId: deduction, amount: 500000 },
      ],
    });

    // Create Payroll Period (standard days = 22)
    const createPeriod = await admin.call(`${payrollPath()}/periods`, 'POST', {
      code: 'PR-2026-01',
      name: 'Kỳ lương Tháng 1/2026',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      standardWorkingDays: 22,
    });
    expect(createPeriod.status).toBe(201);
    const periodId = createPeriod.body.id;

    // Calculate draft payroll
    const calcRes = await admin.call(`${payrollPath()}/periods/${periodId}/calculate`, 'POST');
    expect(calcRes.status).toBe(200);
    expect(calcRes.body.generatedSlips).toBe(1);

    // Read period detail and summary
    const detail = await hr.call(`${payrollPath()}/periods/${periodId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.summary.totalSlips).toBe(1);
    expect(Number(detail.body.summary.totalGross)).toBe(23000000); // 22,000,000 + 1,000,000
    expect(Number(detail.body.summary.totalNet)).toBe(22500000); // 23,000,000 - 500,000

    // Read slips in period
    const slipsList = await hr.call(`${payrollPath()}/periods/${periodId}/slips`);
    expect(slipsList.status).toBe(200);
    expect(slipsList.body.items.length).toBe(1);
    const slipId = slipsList.body.items[0].id;
    expect(Number(slipsList.body.items[0].grossPay)).toBe(23000000);
    expect(Number(slipsList.body.items[0].netPay)).toBe(22500000);

    // Read single slip detail with items
    const slipDetail = await hr.call(`${payrollPath()}/slips/${slipId}`);
    expect(slipDetail.status).toBe(200);
    expect(slipDetail.body.items.length).toBe(3); // Base + Allowance + Deduction

    // Self-service: Employee can read own slip via /my-slips
    const mySlips = await emp.call(`${payrollPath()}/my-slips`);
    expect(mySlips.status).toBe(200);
    expect(mySlips.body.items.length).toBe(1);
    expect(Number(mySlips.body.items[0].netPay)).toBe(22500000);

    // Manager can read slip of employee in department
    const mgrSlip = await mgr.call(`${payrollPath()}/slips/${slipId}`);
    expect(mgrSlip.status).toBe(200);

    // Audit verification: verify PAYROLL_CALCULATED was recorded without financial values
    const auditRes = await pool.query(
      "SELECT event_type, metadata FROM auth_audit_events WHERE organization_id = $1 AND event_type = 'PAYROLL_CALCULATED'",
      [org]
    );
    expect(auditRes.rowCount).toBeGreaterThanOrEqual(1);
    const meta = auditRes.rows[0].metadata;
    expect(meta.slipsCount).toBe(1);
    expect(JSON.stringify(meta)).not.toContain('22000000');
    expect(JSON.stringify(meta)).not.toContain('22500000');
  });

  it('enforces period lifecycle transitions and locks closed periods immutably', async () => {
    const admin = await actor('admin');
    const hr = await actor('hr');

    // Create period
    const period = (await admin.call(`${payrollPath()}/periods`, 'POST', {
      code: 'PR-2026-02',
      name: 'Kỳ lương Tháng 2/2026',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      standardWorkingDays: 20,
    })).body;

    // 1. Invalid status transition (DRAFT -> APPROVED directly fails)
    const directApprove = await hr.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'APPROVED',
    });
    expect(directApprove.status).toBe(400);

    // 2. DRAFT -> UNDER_REVIEW
    const toReview = await hr.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'UNDER_REVIEW',
      notes: 'Gửi kiểm tra số liệu chấm công',
    });
    expect(toReview.status).toBe(200);
    expect(toReview.body.status).toBe('UNDER_REVIEW');

    // 3. UNDER_REVIEW -> APPROVED
    const toApproved = await admin.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'APPROVED',
      notes: 'Ban giám đốc đã duyệt bảng lương',
    });
    expect(toApproved.status).toBe(200);
    expect(toApproved.body.status).toBe('APPROVED');

    // 4. APPROVED -> CLOSED
    const toClosed = await admin.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'CLOSED',
      notes: 'Đã hoàn tất thanh toán và khóa sổ kỳ lương',
    });
    expect(toClosed.status).toBe(200);
    expect(toClosed.body.status).toBe('CLOSED');

    // 5. Once CLOSED: recalculate is blocked (409 PAYROLL_PERIOD_CLOSED)
    const recalc = await admin.call(`${payrollPath()}/periods/${period.id}/calculate`, 'POST');
    expect(recalc.status).toBe(409);
    expect(recalc.body.code).toBe('PAYROLL_PERIOD_CLOSED');

    // 6. Once CLOSED: cannot transition back (409 PAYROLL_PERIOD_CLOSED)
    const reopen = await admin.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'DRAFT',
    });
    expect(reopen.status).toBe(409);
  });

  it('strictly isolates tenants and denies cross-tenant access', async () => {
    const admin = await actor('admin');
    const outsider = new Client();
    await outsider.login('outsider@payroll.test');

    // Create component in org
    const compId = (await admin.call(`${payrollPath()}/components`, 'POST', {
      code: 'PRIVATE', name: 'Riêng tư', type: 'ALLOWANCE', defaultAmount: 1000000,
    })).body.id;

    // Outsider cannot access org's payroll endpoints
    const crossList = await outsider.call(`${payrollPath()}/components`);
    expect(crossList.status).toBe(403);

    const crossComp = await outsider.call(`${payrollPath()}/components/${compId}`, 'PUT', {
      name: 'Hack', calculationType: 'FIXED', isTaxable: false, isStatutory: false, defaultAmount: 0, active: true,
    });
    expect(crossComp.status).toBe(403);
  });
});

// ==================================================================
// PAY-001 Enhancement: Salary History & Social Insurance (BHXH) Tests
// ==================================================================
describe('PAY-001 Enhancement: Salary history & BHXH', () => {
  it('GET salary-history: employee sees own history, outsider is blocked', async () => {
    const hr = await actor('hr');
    const emp = await actor('employee');

    // Create salary profile via HR
    const save = await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 15_000_000,
      effectiveFrom: '2026-01-01',
      currency: 'VND',
      status: 'ACTIVE',
      components: [],
    });
    expect(save.status).toBe(200);

    // Employee can read own salary history
    const empHist = await emp.call(`${payrollPath()}/employees/${employeeId}/salary-history`);
    expect(empHist.status).toBe(200);
    expect(empHist.body.items).toHaveLength(1);
    expect(empHist.body.items[0].effectiveFrom).toBe('2026-01-01');
    expect(empHist.body.items[0].salaryMode).toBe('GROSS');
    // Actual salary amount must be present (self-view)
    expect(empHist.body.items[0].baseSalary).toBeDefined();

    // Outsider (different org) is blocked
    const outsider = new Client();
    await outsider.login('outsider@payroll.test');
    const outsiderHist = await outsider.call(`${payrollPath()}/employees/${employeeId}/salary-history`);
    expect(outsiderHist.status).toBe(403);
  });

  it('GET my-salary-profile: returns current profile for employee', async () => {
    const hr = await actor('hr');
    const emp = await actor('employee');

    await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 20_000_000,
      effectiveFrom: '2026-02-01',
      currency: 'VND',
      status: 'ACTIVE',
      components: [],
    });

    const myProfile = await emp.call(`${payrollPath()}/my-salary-profile`);
    expect(myProfile.status).toBe(200);
    expect(myProfile.body.profile).not.toBeNull();
    expect(myProfile.body.profile.salaryMode).toBe('GROSS');
    expect(myProfile.body.history).toBeInstanceOf(Array);
  });

  it('GET adjustment-log: HR can read; employee can read own; outsider blocked', async () => {
    const hr = await actor('hr');
    const emp = await actor('employee');

    // Create a salary profile to generate a log entry
    await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'NET',
      baseSalary: 18_000_000,
      effectiveFrom: '2026-03-01',
      currency: 'VND',
      status: 'ACTIVE',
      components: [],
    });

    const hrLog = await hr.call(`${payrollPath()}/employees/${employeeId}/adjustment-log`);
    expect(hrLog.status).toBe(200);
    expect(hrLog.body.items).toBeInstanceOf(Array);
    expect(hrLog.body.items).toHaveLength(1);
    expect(hrLog.body.items[0].actorName).toBe('hr@payroll.test');

    const empLog = await emp.call(`${payrollPath()}/employees/${employeeId}/adjustment-log`);
    expect(empLog.status).toBe(200);

    const outsider = new Client();
    await outsider.login('outsider@payroll.test');
    const outsiderLog = await outsider.call(`${payrollPath()}/employees/${employeeId}/adjustment-log`);
    expect(outsiderLog.status).toBe(403);
  });

  it('PUT social-insurance: HR creates profile; employee can read; invalid data rejected', async () => {
    const hr = await actor('hr');
    const emp = await actor('employee');

    // HR creates BHXH profile
    const put = await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance`, 'PUT', {
      siCode: '0123456789',
      insuredName: 'Nguyễn Văn A',
      enrollmentDate: '2024-01-01',
      siSalary: 6_500_000,
      currency: 'VND',
      status: 'ACTIVE',
    });
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);

    // Employee reads own BHXH
    const getByEmp = await emp.call(`${payrollPath()}/employees/${employeeId}/social-insurance`);
    expect(getByEmp.status).toBe(200);
    expect(getByEmp.body.profile).not.toBeNull();
    expect(getByEmp.body.profile.siCode).toBe('0123456789');
    expect(getByEmp.body.profile.status).toBe('ACTIVE');
    expect(getByEmp.body.contributions).toBeInstanceOf(Array);

    // Validation: terminationDate before enrollmentDate
    const badDates = await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance`, 'PUT', {
      siCode: '0123456789',
      insuredName: 'Nguyễn Văn A',
      enrollmentDate: '2024-06-01',
      terminationDate: '2024-01-01',
      siSalary: 6_500_000,
      currency: 'VND',
      status: 'ACTIVE',
    });
    expect(badDates.status).toBe(400);

    // Employee cannot write (PUT is ADMIN/HR only)
    const empPut = await emp.call(`${payrollPath()}/employees/${employeeId}/social-insurance`, 'PUT', {
      siCode: '0000000000',
      insuredName: 'Hack',
      enrollmentDate: '2024-01-01',
      siSalary: 1,
      currency: 'VND',
      status: 'ACTIVE',
    });
    expect(empPut.status).toBe(403);
  });

  it('POST SI contribution: validates month boundary; rejects non-first-of-month', async () => {
    const hr = await actor('hr');

    // Create SI profile first
    await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance`, 'PUT', {
      siCode: '9876543210',
      insuredName: 'Trần Thị B',
      enrollmentDate: '2025-01-01',
      siSalary: 7_200_000,
      currency: 'VND',
      status: 'ACTIVE',
    });

    // Valid: first of month
    const ok = await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance/contributions`, 'POST', {
      contributionMonth: '2026-10-01',
      siSalary: 7_200_000,
      employeeRate: 0.08,
      employerRate: 0.175,
      employeeAmount: 576_000,
      employerAmount: 1_260_000,
      status: 'CONFIRMED',
    });
    expect(ok.status).toBe(201);

    // Invalid: not first of month
    const bad = await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance/contributions`, 'POST', {
      contributionMonth: '2026-10-15',
      siSalary: 7_200_000,
      employeeRate: 0.08,
      employerRate: 0.175,
      employeeAmount: 576_000,
      employerAmount: 1_260_000,
      status: 'PENDING',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('CONTRIBUTION_MONTH_MUST_BE_FIRST_OF_MONTH');
  });

  it('GET SI contributions paginated: employee sees own; outsider blocked', async () => {
    const hr = await actor('hr');
    const emp = await actor('employee');

    await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance`, 'PUT', {
      siCode: '1111111111',
      insuredName: 'Test Employee',
      enrollmentDate: '2025-01-01',
      siSalary: 8_000_000,
      currency: 'VND',
      status: 'ACTIVE',
    });

    await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance/contributions`, 'POST', {
      contributionMonth: '2026-09-01',
      siSalary: 8_000_000,
      employeeRate: 0.08,
      employerRate: 0.175,
      employeeAmount: 640_000,
      employerAmount: 1_400_000,
      status: 'CONFIRMED',
    });

    const empContrib = await emp.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`
    );
    expect(empContrib.status).toBe(200);
    expect(empContrib.body.items).toHaveLength(1);
    expect(empContrib.body.items[0].contributionMonth).toBe('2026-09-01');
    expect(empContrib.body.items[0].status).toBe('CONFIRMED');

    const outsider = new Client();
    await outsider.login('outsider@payroll.test');
    const blocked = await outsider.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`
    );
    expect(blocked.status).toBe(403);
  });
});
