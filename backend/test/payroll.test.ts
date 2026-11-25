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
        ...(method === 'GET'
          ? {}
          : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      this.cookies.set(pair.split('=')[0], pair);
    }
    const text = await r.text();
    let parsedBody: any = null;
    try {
      parsedBody = text ? JSON.parse(text) : null;
    } catch {
      parsedBody = text;
    }
    return { status: r.status, body: parsedBody, text };
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
  await pool.query(
    'INSERT INTO users(id, email, full_name, password_hash, email_verified_at) VALUES($1, $2, $2, $3, now())',
    [id, email, hash],
  );
  await pool.query(
    'INSERT INTO memberships(id, user_id, organization_id, role) VALUES($1, $2, $3, $4)',
    [randomUUID(), id, tenant, role],
  );
  return id;
}

const payrollPath = () => `/api/organizations/${org}/payroll`;
const empPath = () => `/api/organizations/${org}/employees`;

beforeAll(async () => {
  hash = await hashPassword(password);
  const app = createApp({
    pool,
    config: {
      origin,
      production: false,
      requireMfa: false,
      csrfSecret: 'payroll-tests-only-'.repeat(4),
    },
    rateLimit: 1000,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('No server');
  base = `http://127.0.0.1:${a.port}`;
}, 30000);

beforeEach(async () => {
  await pool.query(
    'TRUNCATE organizations, users, memberships, departments, positions, user_sessions, invitations, auth_audit_events, auth_rate_limits, salary_components, employee_salary_profiles, payroll_periods, payroll_slips, payroll_slip_items CASCADE',
  );
  org = randomUUID();
  otherOrg = randomUUID();
  departmentId = randomUUID();
  positionId = randomUUID();

  await pool.query(
    "INSERT INTO organizations(id, name) VALUES($1, 'Payroll Corp'), ($2, 'Other Corp')",
    [org, otherOrg],
  );

  adminId = await user('admin@payroll.test', 'ADMIN');
  hrId = await user('hr@payroll.test', 'HR');
  managerId = await user('manager@payroll.test', 'MANAGER');
  employeeUserId = await user('employee@payroll.test', 'EMPLOYEE');
  outsiderUserId = await user('outsider@payroll.test', 'EMPLOYEE', otherOrg);

  await pool.query(
    'INSERT INTO departments(id, organization_id, code, name, manager_user_id) VALUES($1, $2, $3, $4, $5)',
    [departmentId, org, 'ENG', 'Engineering', managerId],
  );
  await pool.query(
    'INSERT INTO positions(id, organization_id, department_id, code, title) VALUES($1, $2, $3, $4, $5)',
    [positionId, org, departmentId, 'SE', 'Software Engineer'],
  );
  await pool.query(
    'UPDATE memberships SET department_id = $1, position_id = $2, manager_user_id = $3 WHERE organization_id = $4 AND user_id = $5',
    [departmentId, positionId, managerId, org, employeeUserId],
  );

  // Create an employee linked to employeeUserId
  employeeId = randomUUID();
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id)
     VALUES ($1, $2, $3, 'EMP-001', 'Test Employee', '2025-01-01', 'ACTIVE', $4, $5, $6)`,
    [employeeId, org, employeeUserId, departmentId, positionId, managerId],
  );
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
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
    const lunchComp = (
      await admin.call(`${payrollPath()}/components`, 'POST', {
        code: 'LUNCH',
        name: 'Ăn trưa',
        type: 'ALLOWANCE',
        defaultAmount: 730000,
      })
    ).body.id;
    const unionComp = (
      await admin.call(`${payrollPath()}/components`, 'POST', {
        code: 'UNION',
        name: 'Đoàn phí',
        type: 'DEDUCTION',
        defaultAmount: 100000,
      })
    ).body.id;

    // 1. Invalid date (effectiveTo < effectiveFrom) returns 400
    const invalidDate = await hr.call(
      `${payrollPath()}/employees/${employeeId}/salary-profile`,
      'PUT',
      {
        salaryMode: 'GROSS',
        baseSalary: 22000000,
        effectiveFrom: '2026-02-01',
        effectiveTo: '2026-01-01',
        components: [],
      },
    );
    expect(invalidDate.status).toBe(400);

    // 2. Set employee salary profile
    const setProfile = await hr.call(
      `${payrollPath()}/employees/${employeeId}/salary-profile`,
      'PUT',
      {
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
      },
    );
    expect(setProfile.status).toBe(200);

    // 3. Employee can read own salary profile
    const empRead = await emp.call(`${payrollPath()}/employees/${employeeId}/salary-profile`);
    expect(empRead.status).toBe(200);
    expect(Number(empRead.body.profile.baseSalary)).toBe(22000000);
    expect(empRead.body.components.length).toBe(2);

    // 4. Employee cannot mutate profile (403)
    const empMutate = await emp.call(
      `${payrollPath()}/employees/${employeeId}/salary-profile`,
      'PUT',
      {
        salaryMode: 'NET',
        baseSalary: 50000000,
        effectiveFrom: '2026-01-01',
        components: [],
      },
    );
    expect(empMutate.status).toBe(403);
  });

  it('calculates draft payroll with exact decimal math and attendance integration', async () => {
    const admin = await actor('admin');
    const hr = await actor('hr');
    const emp = await actor('employee');
    const mgr = await actor('manager');

    // Create components
    const allowance = (
      await admin.call(`${payrollPath()}/components`, 'POST', {
        code: 'ALLOW_TRANSPORT',
        name: 'Xăng xe',
        type: 'ALLOWANCE',
        defaultAmount: 1000000,
      })
    ).body.id;
    const deduction = (
      await admin.call(`${payrollPath()}/components`, 'POST', {
        code: 'DEDUCT_HEALTH',
        name: 'Bảo hiểm tự nguyện',
        type: 'DEDUCTION',
        defaultAmount: 500000,
      })
    ).body.id;

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
      [org],
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
    const period = (
      await admin.call(`${payrollPath()}/periods`, 'POST', {
        code: 'PR-2026-02',
        name: 'Kỳ lương Tháng 2/2026',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        standardWorkingDays: 20,
      })
    ).body;

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
    const compId = (
      await admin.call(`${payrollPath()}/components`, 'POST', {
        code: 'PRIVATE',
        name: 'Riêng tư',
        type: 'ALLOWANCE',
        defaultAmount: 1000000,
      })
    ).body.id;

    // Outsider cannot access org's payroll endpoints
    const crossList = await outsider.call(`${payrollPath()}/components`);
    expect(crossList.status).toBe(403);

    const crossComp = await outsider.call(`${payrollPath()}/components/${compId}`, 'PUT', {
      name: 'Hack',
      calculationType: 'FIXED',
      isTaxable: false,
      isStatutory: false,
      defaultAmount: 0,
      active: true,
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
    const outsiderHist = await outsider.call(
      `${payrollPath()}/employees/${employeeId}/salary-history`,
    );
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
    const outsiderLog = await outsider.call(
      `${payrollPath()}/employees/${employeeId}/adjustment-log`,
    );
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
    const badDates = await hr.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance`,
      'PUT',
      {
        siCode: '0123456789',
        insuredName: 'Nguyễn Văn A',
        enrollmentDate: '2024-06-01',
        terminationDate: '2024-01-01',
        siSalary: 6_500_000,
        currency: 'VND',
        status: 'ACTIVE',
      },
    );
    expect(badDates.status).toBe(400);

    // Employee cannot write (PUT is ADMIN/HR only)
    const empPut = await emp.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance`,
      'PUT',
      {
        siCode: '0000000000',
        insuredName: 'Hack',
        enrollmentDate: '2024-01-01',
        siSalary: 1,
        currency: 'VND',
        status: 'ACTIVE',
      },
    );
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
    const ok = await hr.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`,
      'POST',
      {
        contributionMonth: '2026-10-01',
        siSalary: 7_200_000,
        employeeRate: 0.08,
        employerRate: 0.175,
        employeeAmount: 576_000,
        employerAmount: 1_260_000,
        status: 'CONFIRMED',
      },
    );
    expect(ok.status).toBe(201);

    // Invalid: not first of month
    const bad = await hr.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`,
      'POST',
      {
        contributionMonth: '2026-10-15',
        siSalary: 7_200_000,
        employeeRate: 0.08,
        employerRate: 0.175,
        employeeAmount: 576_000,
        employerAmount: 1_260_000,
        status: 'PENDING',
      },
    );
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

    await hr.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`,
      'POST',
      {
        contributionMonth: '2026-09-01',
        siSalary: 8_000_000,
        employeeRate: 0.08,
        employerRate: 0.175,
        employeeAmount: 640_000,
        employerAmount: 1_400_000,
        status: 'CONFIRMED',
      },
    );

    const empContrib = await emp.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`,
    );
    expect(empContrib.status).toBe(200);
    expect(empContrib.body.items).toHaveLength(1);
    expect(empContrib.body.items[0].contributionMonth).toBe('2026-09-01');
    expect(empContrib.body.items[0].status).toBe('CONFIRMED');

    const outsider = new Client();
    await outsider.login('outsider@payroll.test');
    const blocked = await outsider.call(
      `${payrollPath()}/employees/${employeeId}/social-insurance/contributions`,
    );
    expect(blocked.status).toBe(403);
  });

  it('PAY-003: Chart of Accounts & Posting Rules management and default VAS seeding', async () => {
    const hr = await actor('hr');
    const admin = await actor('admin');
    const emp = await actor('employee');

    // 1. Employee access blocked
    const empBlocked = await emp.call(`${payrollPath()}/accounting/accounts`);
    expect(empBlocked.status).toBe(403);

    // 2. Seed standard accounts & rules
    const seedRes = await hr.call(`${payrollPath()}/accounting/accounts/seed-defaults`, 'POST', {});
    expect(seedRes.status).toBe(200);

    // 3. List accounts
    const accList = await hr.call(`${payrollPath()}/accounting/accounts`);
    expect(accList.status).toBe(200);
    expect(accList.body.items.length).toBeGreaterThanOrEqual(10);
    const codes = accList.body.items.map((a: { code: string }) => a.code);
    expect(codes).toContain('3341');
    expect(codes).toContain('6422');
    expect(codes).toContain('1121');

    // 4. Duplicate account rejection
    const dupRes = await admin.call(`${payrollPath()}/accounting/accounts`, 'POST', {
      code: '3341',
      name: 'Duplicate Phải trả người lao động',
      type: 'LIABILITY',
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.code).toBe('ACCOUNT_CODE_EXISTS');

    // 5. List rules
    const rulesList = await hr.call(`${payrollPath()}/accounting/rules`);
    expect(rulesList.status).toBe(200);
    expect(rulesList.body.items.length).toBeGreaterThanOrEqual(5);
    const ruleCodes = rulesList.body.items.map((r: { ruleCode: string }) => r.ruleCode);
    expect(ruleCodes).toContain('BASE_SALARY_EXPENSE');
  });

  it('PAY-003: Journal entry generation, double-entry balancing, posting and reversal', async () => {
    const hr = await actor('hr');
    const admin = await actor('admin');

    // Ensure defaults are seeded and employee has active salary profile
    await hr.call(`${payrollPath()}/accounting/accounts/seed-defaults`, 'POST', {});
    await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 20000000,
      effectiveFrom: '2026-01-01',
      components: [],
    });

    // 1. Create a fresh payroll period
    const periodCode = `KY-ACC-${Date.now().toString().slice(-6)}`;
    const createPeriod = await admin.call(`${payrollPath()}/periods`, 'POST', {
      code: periodCode,
      name: `Kỳ kế toán ${periodCode}`,
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      standardWorkingDays: 22,
    });
    expect(createPeriod.status).toBe(201);
    const pId = createPeriod.body.id;

    // 2. Generating journal on unapproved/uncalculated period must be rejected
    const unapprovedGen = await hr.call(
      `${payrollPath()}/periods/${pId}/accounting/generate`,
      'POST',
      {},
    );
    expect(unapprovedGen.status).toBe(409);
    expect(unapprovedGen.body.code).toBe('PAYROLL_PERIOD_NOT_APPROVED_OR_CLOSED');

    // 3. Calculate payroll
    await hr.call(`${payrollPath()}/periods/${pId}/calculate`, 'POST', {});

    // 4. Transition to APPROVED
    await hr.call(`${payrollPath()}/periods/${pId}/status`, 'PATCH', { status: 'UNDER_REVIEW' });
    await hr.call(`${payrollPath()}/periods/${pId}/status`, 'PATCH', { status: 'APPROVED' });

    // 5. Generate journal entry with status POSTED
    const genRes = await hr.call(
      `${payrollPath()}/periods/${pId}/accounting/generate?status=POSTED`,
      'POST',
      {},
    );
    expect(genRes.status).toBe(201);
    expect(genRes.body.status).toBe('POSTED');
    expect(genRes.body.totalDebit).toBe(genRes.body.totalCredit);
    const entryId = genRes.body.id;

    // 6. Fetch entry detail with itemized lines
    const detailRes = await hr.call(`${payrollPath()}/accounting/entries/${entryId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.entry.entryNumber).toBe(genRes.body.entryNumber);
    expect(detailRes.body.lines.length).toBeGreaterThanOrEqual(2);

    // Verify Debit = Credit in lines
    let totalD = 0;
    let totalC = 0;
    for (const line of detailRes.body.lines) {
      totalD += parseFloat(line.debitAmount);
      totalC += parseFloat(line.creditAmount);
    }
    expect(totalD.toFixed(2)).toBe(totalC.toFixed(2));

    // 7. Immutability: database trigger guards posted entry from direct modification
    await expect(
      pool.query(`UPDATE payroll_journal_entries SET total_debit = 999999 WHERE id = $1`, [
        entryId,
      ]),
    ).rejects.toThrow(/cannot modify a posted journal entry/);

    // 8. Reversal: creates linked reversal entry
    const revRes = await hr.call(
      `${payrollPath()}/accounting/entries/${entryId}/reverse`,
      'POST',
      {},
    );
    expect(revRes.status).toBe(200);
    expect(revRes.body.ok).toBe(true);
    expect(revRes.body.reversalEntryId).toBeDefined();

    // Verify original entry is now REVERSED
    const origCheck = await hr.call(`${payrollPath()}/accounting/entries/${entryId}`);
    expect(origCheck.body.entry.status).toBe('REVERSED');
    expect(origCheck.body.entry.reversalEntryId).toBe(revRes.body.reversalEntryId);

    // Verify reversal entry lines have swapped Debit/Credit
    const revDetail = await hr.call(
      `${payrollPath()}/accounting/entries/${revRes.body.reversalEntryId}`,
    );
    expect(revDetail.body.entry.status).toBe('POSTED');
    expect(revDetail.body.lines[0].debitAmount).toBe(detailRes.body.lines[0].creditAmount);
    expect(revDetail.body.lines[0].creditAmount).toBe(detailRes.body.lines[0].debitAmount);
  });

  it('PAY-003: Disbursements, reconciliation, liabilities, and CSV export', async () => {
    const hr = await actor('hr');
    const admin = await actor('admin');

    // Ensure defaults and active salary profile
    await hr.call(`${payrollPath()}/accounting/accounts/seed-defaults`, 'POST', {});
    await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 20000000,
      effectiveFrom: '2026-01-01',
      components: [],
    });

    // 1. Create period & calculate slips
    const pCode = `KY-REC-${Date.now().toString().slice(-6)}`;
    const period = (
      await admin.call(`${payrollPath()}/periods`, 'POST', {
        code: pCode,
        name: `Kỳ đối chiếu ${pCode}`,
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        standardWorkingDays: 22,
      })
    ).body;
    await hr.call(`${payrollPath()}/periods/${period.id}/calculate`, 'POST', {});
    await hr.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'UNDER_REVIEW',
    });
    await hr.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', { status: 'APPROVED' });

    // Read slips to get employee net pay
    const slips = (await hr.call(`${payrollPath()}/periods/${period.id}/slips`)).body.items;
    expect(slips.length).toBeGreaterThan(0);
    const slip = slips[0];

    // 2. Record partial disbursement (underpaid)
    const disbCode = `DISB-${Date.now().toString().slice(-6)}`;
    const disbAmount = Math.max(1, Math.floor(parseFloat(slip.netPay) / 2));
    const disbRes = await hr.call(`${payrollPath()}/periods/${period.id}/disbursements`, 'POST', {
      items: [
        {
          employeeId: slip.employeeId,
          slipId: slip.id,
          disbursementCode: disbCode,
          amount: disbAmount,
          paymentDate: '2026-07-05',
          paymentMethod: 'BANK_TRANSFER',
          bankName: 'Vietcombank',
          bankAccountNumber: '0123456789',
        },
      ],
    });
    expect(disbRes.status).toBe(201);
    expect(disbRes.body.count).toBe(1);

    // Duplicate disbursement code rejected
    const dupDisb = await hr.call(`${payrollPath()}/periods/${period.id}/disbursements`, 'POST', {
      items: [
        {
          employeeId: slip.employeeId,
          disbursementCode: disbCode,
          amount: 1000000,
          paymentDate: '2026-07-05',
        },
      ],
    });
    expect(dupDisb.status).toBe(409);

    // 3. Run reconciliation: should detect UNDERPAID discrepancy
    const recRes = await hr.call(`${payrollPath()}/periods/${period.id}/reconcile`, 'POST', {});
    expect(recRes.status).toBe(200);
    expect(recRes.body.status).toBe('DISCREPANCY_DETECTED');
    expect(recRes.body.discrepancyCount).toBeGreaterThanOrEqual(1);
    expect(recRes.body.discrepancies[0].type).toBe('UNDERPAID');

    // 4. Resolve discrepancy
    const discId =
      recRes.body.discrepancies[0].id ||
      (await hr.call(`${payrollPath()}/periods/${period.id}/reconciliation`)).body.discrepancies[0]
        .id;
    const resolveRes = await hr.call(
      `${payrollPath()}/reconciliation/discrepancies/${discId}`,
      'PATCH',
      {
        resolutionStatus: 'RESOLVED',
        resolutionNotes: 'Đã bổ sung đợt chi trả bù',
      },
    );
    expect(resolveRes.status).toBe(200);

    // Reconciliation status updated to RESOLVED
    const checkRec = await hr.call(`${payrollPath()}/periods/${period.id}/reconciliation`);
    expect(checkRec.body.reconciliation.status).toBe('RESOLVED');

    // 5. Liabilities tracking
    const liabRes = await hr.call(`${payrollPath()}/periods/${period.id}/liabilities`);
    expect(liabRes.status).toBe(200);
    expect(liabRes.body.liability).toBeDefined();
    expect(parseFloat(liabRes.body.liability.paidAmount)).toBe(disbAmount);

    const summaryLiab = await hr.call(`${payrollPath()}/liabilities/summary`);
    expect(summaryLiab.status).toBe(200);
    expect(summaryLiab.body.totals.totalPaid).toBeDefined();

    // 6. CSV Export: journal, reconciliation, disbursements
    const exportJournal = await hr.call(
      `${payrollPath()}/periods/${period.id}/accounting/export?type=journal&format=json`,
    );
    expect(exportJournal.status).toBe(200);

    const exportRec = await hr.call(
      `${payrollPath()}/periods/${period.id}/accounting/export?type=reconciliation&format=json`,
    );
    expect(exportRec.status).toBe(200);
    expect(exportRec.body.items.length).toBeGreaterThan(0);

    const exportDisb = await hr.call(
      `${payrollPath()}/periods/${period.id}/accounting/export?type=disbursements&format=json`,
    );
    expect(exportDisb.status).toBe(200);
    expect(exportDisb.body.items.length).toBeGreaterThan(0);
  });

  it('PAY-004: Statutory compliance rules and employee dependents management', async () => {
    const hr = await actor('hr');
    const admin = await actor('admin');
    const emp = await actor('employee');

    // 1. Seed standard statutory rules (Resolution 954/2020, Decree 73/2024, Decree 74/2024, Circular 111/2013)
    const seedRes = await hr.call(`${payrollPath()}/compliance/rules/seed-defaults`, 'POST', {});
    expect(seedRes.status).toBe(201);
    expect(seedRes.body.seededCount).toBeGreaterThanOrEqual(1);

    // List rules
    const rulesRes = await hr.call(`${payrollPath()}/compliance/rules`);
    expect(rulesRes.status).toBe(200);
    expect(rulesRes.body.rules.length).toBeGreaterThanOrEqual(5);
    const pitRule = rulesRes.body.rules.find((r: any) => r.ruleType === 'PIT_DEDUCTIONS');
    expect(pitRule).toBeDefined();
    expect(pitRule.parameters.personal).toBe(11000000);
    expect(pitRule.legalReference).toContain('954/2020');

    // 2. Employee registers dependent
    const depRes = await hr.call(`${payrollPath()}/compliance/dependents`, 'POST', {
      employeeId,
      fullName: 'Nguyễn Văn Con',
      relationship: 'CHILD',
      taxId: '8888999911',
      effectiveFrom: '2026-01-01',
      isVerified: false,
    });
    expect(depRes.status).toBe(201);
    const depId = depRes.body.dependent.id;

    // HR verifies dependent
    const verifyRes = await hr.call(
      `${payrollPath()}/compliance/dependents/${depId}/verify`,
      'PATCH',
      {
        isVerified: true,
      },
    );
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.isVerified).toBe(true);

    // List dependents
    const listDeps = await hr.call(
      `${payrollPath()}/compliance/dependents?employeeId=${employeeId}`,
    );
    expect(listDeps.status).toBe(200);
    expect(listDeps.body.dependents.length).toBeGreaterThanOrEqual(1);
    expect(listDeps.body.dependents[0].isVerified).toBe(true);
  });

  it('PAY-004: PIT Tax, Social Insurance, HR Cost Analytics and Compliance Engine', async () => {
    const hr = await actor('hr');
    const admin = await actor('admin');

    // Ensure rules seeded and employee configured
    await hr.call(`${payrollPath()}/compliance/rules/seed-defaults`, 'POST', {});
    await hr.call(`${payrollPath()}/employees/${employeeId}/salary-profile`, 'PUT', {
      salaryMode: 'GROSS',
      baseSalary: 20000000,
      effectiveFrom: '2026-01-01',
      components: [],
    });

    // Create and approve payroll period
    const pCode = `KY-CMP-${Date.now().toString().slice(-6)}`;
    const period = (
      await admin.call(`${payrollPath()}/periods`, 'POST', {
        code: pCode,
        name: `Kỳ tuân thủ ${pCode}`,
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        standardWorkingDays: 22,
      })
    ).body;
    await hr.call(`${payrollPath()}/periods/${period.id}/calculate`, 'POST', {});
    await hr.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', {
      status: 'UNDER_REVIEW',
    });
    await hr.call(`${payrollPath()}/periods/${period.id}/status`, 'PATCH', { status: 'APPROVED' });

    // 1. Personal Income Tax (PIT) report calculation
    const pitRes = await hr.call(`${payrollPath()}/compliance/pit/period/${period.id}`);
    expect(pitRes.status).toBe(200);
    expect(pitRes.body.verificationStatus).toBe('NOT_VERIFIED');
    expect(pitRes.body.summary.totalGrossPay).toBe('20000000.00');
    expect(pitRes.body.summary.totalPersonalDeduction).toBe('11000000.00');
    expect(pitRes.body.employees.length).toBeGreaterThan(0);
    // Assessable income = 20M - 11M (personal) - 4.4M (dependent if verified) = 4.6M or 9M
    expect(parseFloat(pitRes.body.summary.totalAssessableIncome)).toBeGreaterThan(0);
    expect(parseFloat(pitRes.body.summary.totalCalculatedTax)).toBeGreaterThan(0);

    // 2. Social Insurance report calculation
    // Ensure active SI profile for employee
    await hr.call(`${payrollPath()}/employees/${employeeId}/social-insurance`, 'PUT', {
      siCode: 'SI99988877',
      insuredName: 'Test Employee',
      enrollmentDate: '2026-01-01',
      siSalary: 20000000,
      status: 'ACTIVE',
    });

    const siRes = await hr.call(`${payrollPath()}/compliance/insurance/period/${period.id}`);
    expect(siRes.status).toBe(200);
    expect(siRes.body.verificationStatus).toBe('NOT_VERIFIED');
    expect(siRes.body.summary.totalParticipants).toBeGreaterThanOrEqual(1);
    expect(parseFloat(siRes.body.summary.totalEmployeePortion)).toBeGreaterThan(0);
    expect(parseFloat(siRes.body.summary.totalEmployerPortion)).toBeGreaterThan(0);
    expect(parseFloat(siRes.body.summary.totalTradeUnion)).toBeGreaterThan(0);

    // 3. HR Cost Analytics
    const analyticsRes = await hr.call(`${payrollPath()}/compliance/analytics/period/${period.id}`);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.analytics.financialMetrics.accruedExpense).toBeDefined();
    expect(analyticsRes.body.analytics.financialMetrics.payableLiability).toBeDefined();
    expect(analyticsRes.body.analytics.departmentDistribution).toBeInstanceOf(Array);

    // 4. Compliance automated scan
    const checkRes = await hr.call(`${payrollPath()}/compliance/check/${period.id}`, 'POST', {});
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.success).toBe(true);

    // 5. Formal Compliance Report Lifecycle & Export
    const repRes = await hr.call(`${payrollPath()}/compliance/reports/generate`, 'POST', {
      reportType: 'PIT_MONTHLY',
      periodId: period.id,
      title: `Báo cáo thuế TNCN ${period.code}`,
      summaryData: pitRes.body.summary,
    });
    expect(repRes.status).toBe(201);
    const reportId = repRes.body.report.id;
    expect(repRes.body.report.status).toBe('DRAFT');

    // Rule: Cannot export DRAFT report
    const draftExport = await hr.call(`${payrollPath()}/compliance/reports/${reportId}/export`);
    expect(draftExport.status).toBe(400);

    // Approve report
    const approveRes = await hr.call(
      `${payrollPath()}/compliance/reports/${reportId}/approve`,
      'POST',
      {},
    );
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');

    // Lock report (Admin only)
    const lockRes = await admin.call(
      `${payrollPath()}/compliance/reports/${reportId}/lock`,
      'POST',
      {},
    );
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.status).toBe('LOCKED');

    // Database trigger: Cannot modify LOCKED report
    await expect(
      pool.query(`UPDATE compliance_reports SET title = 'Changed' WHERE id = $1`, [reportId]),
    ).rejects.toThrow(/Cannot modify a LOCKED compliance report/);

    // Unverified statutory exports must fail before recording an export.
    const exportRes = await hr.call(`${payrollPath()}/compliance/reports/${reportId}/export`);
    expect(exportRes.status).toBe(409);
    expect(exportRes.body.code).toBe('STATUTORY_EXPORT_NOT_VERIFIED');
    const audit = await pool.query(
      `SELECT count(*)::int AS count FROM compliance_audit_logs
       WHERE organization_id = $1 AND target_id = $2 AND action = 'EXPORT_OFFICIAL_REPORT'`,
      [org, reportId],
    );
    expect(audit.rows[0].count).toBe(0);

    const employee = await actor('employee');
    expect(
      (await employee.call(`${payrollPath()}/compliance/reports/${reportId}/export`)).status,
    ).toBe(403);
  });
});
