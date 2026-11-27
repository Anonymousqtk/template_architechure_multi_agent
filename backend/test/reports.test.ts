import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import type { Mailer } from '../src/mail.js';
import {
  costPerEmployee,
  moneyChangePercent,
  lifecycleKpis,
  parseAnalyticsRange,
  ratio,
} from '../src/executive-analytics.js';

if (process.env.MIGRATION_TEST_BACKEND !== 'true' || !process.env.DATABASE_URL) {
  throw new Error(
    'Run through backend/test-runner.mjs; a disposable PostgreSQL database is required.',
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const origin = 'http://localhost:3000';
const password = 'Correct horse test password 7!';
const config = {
  requireMfa: false,
  origin,
  production: false,
  csrfSecret: 'test-only-secret-'.repeat(4),
};
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
const mailer: Mailer = {
  mode: 'SMTP',
  async send() {
    return 'SENT';
  },
};

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
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP listener');
  return `http://127.0.0.1:${address.port}`;
}

class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(public url = base) {}
  async request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(this.url + path, {
      method,
      headers: {
        Cookie: [...this.cookies.values()].join('; '),
        ...(method === 'GET'
          ? {}
          : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
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
    [id, email.toLowerCase(), fullName, passwordHash],
  );
  await pool.query(
    'INSERT INTO memberships(id, user_id, organization_id, role, is_active) VALUES($1, $2, $3, $4, true)',
    [randomUUID(), id, org, role],
  );
  return id;
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
  base = await start();
}, 30000);

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE report_export_audit_logs, report_saved_templates, report_catalog, payroll_journal_entry_lines, payroll_journal_entries, accounting_rules, accounting_accounts, payroll_disbursements, payroll_slip_items, payroll_slips, payroll_periods, salary_components, attendance_punches, work_schedule, work_shifts, leave_requests, leave_balances, leave_types, employee_contracts, employee_work_history, employee_documents, employees, positions, departments, auth_audit_events, user_sessions, password_reset_tokens, invitations, memberships, users, organizations, auth_rate_limits CASCADE',
  );

  orgA = randomUUID();
  orgB = randomUUID();
  await pool.query('INSERT INTO organizations(id, name, code) VALUES($1, $2, $3), ($4, $5, $6)', [
    orgA,
    'Acme Corp',
    'ACME',
    orgB,
    'Beta Corp',
    'BETA',
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
    [deptDevId, orgA, managerId, deptSalesId],
  );

  // Create position
  posDevId = randomUUID();
  await pool.query(
    `INSERT INTO positions(id, organization_id, department_id, code, title)
     VALUES ($1, $2, $3, 'DEV-SENIOR', 'Kỹ sư phần mềm cao cấp')`,
    [posDevId, orgA, deptDevId],
  );

  // Link manager to Dev department in membership
  await pool.query(
    `UPDATE memberships SET department_id = $1 WHERE user_id = $2 AND organization_id = $3`,
    [deptDevId, managerId, orgA],
  );
  await pool.query(
    `UPDATE memberships SET department_id = $1, position_id = $2, manager_user_id = $3
     WHERE user_id = $4 AND organization_id = $5`,
    [deptDevId, posDevId, managerId, employeeId, orgA],
  );
  await pool.query(
    `UPDATE memberships SET department_id = $1
     WHERE user_id = $2 AND organization_id = $3`,
    [deptSalesId, employeeId2, orgA],
  );

  // Create employees
  empDevRecordId = randomUUID();
  empSalesRecordId = randomUUID();
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id, phone, personal_email)
     VALUES ($1, $2, $3, 'EMP001', 'Dev Employee', '2023-01-15', 'ACTIVE', $4, $5, $6, '0901234567', 'dev@personal.test')`,
    [empDevRecordId, orgA, employeeId, deptDevId, posDevId, managerId],
  );
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id, phone, personal_email)
     VALUES ($1, $2, $3, 'EMP002', 'Sales Employee', '2024-05-01', 'ACTIVE', $4, NULL, NULL, '0907654321', 'sales@personal.test')`,
    [empSalesRecordId, orgA, employeeId2, deptSalesId],
  );

  // Create contracts
  const contractId1 = randomUUID();
  const contractId2 = randomUUID();
  await pool.query(
    `INSERT INTO employee_contracts(id, organization_id, employee_id, contract_number, contract_type, start_date, status)
     VALUES ($1, $2, $3, 'HD-DEV-001', 'INDEFINITE', '2023-01-15', 'DRAFT')`,
    [contractId1, orgA, empDevRecordId],
  );
  await pool.query(
    `UPDATE employee_contracts SET status = 'ACTIVE', signed_on = '2023-01-15' WHERE id = $1`,
    [contractId1],
  );

  await pool.query(
    `INSERT INTO employee_contracts(id, organization_id, employee_id, contract_number, contract_type, start_date, end_date, status)
     VALUES ($1, $2, $3, 'HD-SALES-001', 'FIXED_TERM', '2024-05-01', '2027-05-01', 'DRAFT')`,
    [contractId2, orgA, empSalesRecordId],
  );
  await pool.query(
    `UPDATE employee_contracts SET status = 'ACTIVE', signed_on = '2024-05-01' WHERE id = $1`,
    [contractId2],
  );

  // Create work shift
  shiftMorningId = randomUUID();
  await pool.query(
    `INSERT INTO work_shifts(id, organization_id, name, time_zone, start_time, end_time, early_check_in, late_grace, early_grace)
     VALUES ($1, $2, 'Ca Sáng', 'Asia/Ho_Chi_Minh', '08:30:00', '17:30:00', 30, 15, 15)`,
    [shiftMorningId, orgA],
  );

  // Create work schedule & punch
  const schedId1 = randomUUID();
  await pool.query(
    `INSERT INTO work_schedule(id, organization_id, employee_id, shift_id, label, work_date, time_zone, starts_at, ends_at, early_check_in, late_grace, early_grace, attendance_kind)
     VALUES ($1, $2, $3, $4, 'Ca Sáng', '2026-03-10', 'Asia/Ho_Chi_Minh', '2026-03-10 01:30:00+00', '2026-03-10 10:30:00+00', 30, 15, 15, 'SHIFT')`,
    [schedId1, orgA, empDevRecordId, shiftMorningId],
  );
  await pool.query(
    `INSERT INTO attendance_punches(schedule_id, organization_id, checked_in_at, checked_out_at)
     VALUES ($1, $2, '2026-03-10 01:40:00+00', '2026-03-10 10:30:00+00')`,
    [schedId1, orgA],
  );

  // Create leave types, balances and requests
  const leaveTypeId = randomUUID();
  await pool.query(
    `INSERT INTO leave_types(id, organization_id, name, tracks_balance, active)
     VALUES ($1, $2, 'Nghỉ phép năm', true, true)`,
    [leaveTypeId, orgA],
  );
  await pool.query(
    `INSERT INTO leave_balances(organization_id, employee_id, leave_type_id, allowance_minutes)
     VALUES ($1, $2, $3, 5760)`, // 12 days * 480 mins
    [orgA, empDevRecordId, leaveTypeId],
  );
  await pool.query(
    `INSERT INTO leave_requests(id, organization_id, employee_id, leave_type_id, created_by, starts_at, ends_at, reason, status, charge_minutes, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, '2026-03-15 01:30:00+00', '2026-03-15 10:30:00+00', 'Nghỉ việc cá nhân', 'APPROVED', 480, $6, now())`,
    [randomUUID(), orgA, empDevRecordId, leaveTypeId, employeeId, hrId],
  );
});

async function setupPayrollTestData() {
  const period1Id = randomUUID();
  const period2Id = randomUUID();

  // 1. Create Period 1 (Jan 2026) as DRAFT
  await pool.query(
    `INSERT INTO payroll_periods (id, organization_id, code, name, start_date, end_date, payment_date, standard_working_days, status)
     VALUES ($1, $2, 'KY-2026-01', 'Kỳ lương tháng 01/2026', '2026-01-01', '2026-01-31', '2026-02-05', 22.00, 'DRAFT')`,
    [period1Id, orgA],
  );

  // 2. Create Salary Components
  const compLunchId = randomUUID();
  const compRespId = randomUUID();
  const compKpiId = randomUUID();
  const compUnionId = randomUUID();
  const compSiId = randomUUID();

  await pool.query(
    `INSERT INTO salary_components (id, organization_id, code, name, type, is_taxable, is_statutory)
     VALUES ($1, $2, 'ALLOW_LUNCH', 'Phụ cấp ăn trưa', 'ALLOWANCE', false, false),
            ($3, $2, 'ALLOW_RESP', 'Phụ cấp trách nhiệm', 'ALLOWANCE', true, false),
            ($4, $2, 'BONUS_KPI', 'Thưởng KPI', 'BONUS', true, false),
            ($5, $2, 'DED_UNION', 'Đoàn phí công đoàn', 'DEDUCTION', false, false),
            ($6, $2, 'DED_SI', 'Trừ BHXH bắt buộc', 'DEDUCTION', false, true)`,
    [compLunchId, orgA, compRespId, compKpiId, compUnionId, compSiId],
  );

  // 3. Create Slips for Period 1
  const slip1Id = randomUUID();
  const slip2Id = randomUUID();

  // Slip 1: Dev Employee (Gross: 25M, Net: 22.9M)
  await pool.query(
    `INSERT INTO payroll_slips (id, organization_id, period_id, employee_id, salary_mode, standard_days, actual_working_days, base_salary, prorated_base_salary, total_allowances, total_bonuses, total_deductions, gross_pay, net_pay, status)
     VALUES ($1, $2, $3, $4, 'GROSS', 22.00, 22.00, 20000000.00, 20000000.00, 2000000.00, 3000000.00, 2100000.00, 25000000.00, 22900000.00, 'PAID')`,
    [slip1Id, orgA, period1Id, empDevRecordId],
  );

  // Slip 2: Sales Employee (Gross: 21M, Net: 19.4M)
  await pool.query(
    `INSERT INTO payroll_slips (id, organization_id, period_id, employee_id, salary_mode, standard_days, actual_working_days, base_salary, prorated_base_salary, total_allowances, total_bonuses, total_deductions, gross_pay, net_pay, status)
     VALUES ($1, $2, $3, $4, 'GROSS', 22.00, 22.00, 15000000.00, 15000000.00, 1000000.00, 5000000.00, 1600000.00, 21000000.00, 19400000.00, 'CONFIRMED')`,
    [slip2Id, orgA, period1Id, empSalesRecordId],
  );

  // 4. Create Slip Items for Period 1
  await pool.query(
    `INSERT INTO payroll_slip_items (id, organization_id, slip_id, component_id, component_name, type, amount)
     VALUES ($1, $2, $3, $4, 'Phụ cấp ăn trưa', 'ALLOWANCE', 1000000.00),
            ($5, $2, $3, $6, 'Phụ cấp trách nhiệm', 'ALLOWANCE', 1000000.00),
            ($7, $2, $3, $8, 'Thưởng KPI', 'BONUS', 3000000.00),
            ($9, $2, $3, $10, 'Trừ BHXH bắt buộc', 'DEDUCTION', 2100000.00),
            ($11, $2, $12, $4, 'Phụ cấp ăn trưa', 'ALLOWANCE', 1000000.00),
            ($13, $2, $12, $8, 'Thưởng KPI', 'BONUS', 5000000.00),
            ($14, $2, $12, $10, 'Trừ BHXH bắt buộc', 'DEDUCTION', 1600000.00)`,
    [
      randomUUID(),
      orgA,
      slip1Id,
      compLunchId,
      randomUUID(),
      compRespId,
      randomUUID(),
      compKpiId,
      randomUUID(),
      compSiId,
      randomUUID(),
      slip2Id,
      randomUUID(),
      randomUUID(),
    ],
  );

  // 5. Close Period 1
  await pool.query(`UPDATE payroll_periods SET status = 'CLOSED' WHERE id = $1`, [period1Id]);

  // 6. Create Period 2 (Feb 2026) as DRAFT
  await pool.query(
    `INSERT INTO payroll_periods (id, organization_id, code, name, start_date, end_date, payment_date, standard_working_days, status)
     VALUES ($1, $2, 'KY-2026-02', 'Kỳ lương tháng 02/2026', '2026-02-01', '2026-02-28', '2026-03-05', 20.00, 'DRAFT')`,
    [period2Id, orgA],
  );

  const slip2_1Id = randomUUID();
  const slip2_2Id = randomUUID();

  // Slip 2.1: Dev (Gross: 22M, Net: 19.9M)
  await pool.query(
    `INSERT INTO payroll_slips (id, organization_id, period_id, employee_id, salary_mode, standard_days, actual_working_days, base_salary, prorated_base_salary, total_allowances, total_bonuses, total_deductions, gross_pay, net_pay, status)
     VALUES ($1, $2, $3, $4, 'GROSS', 20.00, 20.00, 20000000.00, 20000000.00, 2000000.00, 0.00, 2100000.00, 22000000.00, 19900000.00, 'DRAFT')`,
    [slip2_1Id, orgA, period2Id, empDevRecordId],
  );

  // Slip 2.2: Sales (Gross: 26M, Net: 23.4M -> net variance from 19.4M to 23.4M is +4M / 19.4M = +20.62% -> ANOMALY)
  await pool.query(
    `INSERT INTO payroll_slips (id, organization_id, period_id, employee_id, salary_mode, standard_days, actual_working_days, base_salary, prorated_base_salary, total_allowances, total_bonuses, total_deductions, gross_pay, net_pay, status)
     VALUES ($1, $2, $3, $4, 'GROSS', 20.00, 20.00, 15000000.00, 15000000.00, 1000000.00, 10000000.00, 2600000.00, 26000000.00, 23400000.00, 'DRAFT')`,
    [slip2_2Id, orgA, period2Id, empSalesRecordId],
  );

  // 7. Disbursements in Period 1
  // Dev Employee: 22,900,000 paid (100% Fully Paid)
  await pool.query(
    `INSERT INTO payroll_disbursements (id, organization_id, period_id, slip_id, employee_id, disbursement_code, payment_method, amount, payment_date, status)
     VALUES ($1, $2, $3, $4, $5, 'DISB-2026-01-001', 'BANK_TRANSFER', 22900000.00, '2026-02-05', 'COMPLETED')`,
    [randomUUID(), orgA, period1Id, slip1Id, empDevRecordId],
  );

  // Sales Employee: 10,000,000 paid (Remaining 9,400,000 -> PARTIAL)
  await pool.query(
    `INSERT INTO payroll_disbursements (id, organization_id, period_id, slip_id, employee_id, disbursement_code, payment_method, amount, payment_date, status)
     VALUES ($1, $2, $3, $4, $5, 'DISB-2026-01-002', 'BANK_TRANSFER', 10000000.00, '2026-02-05', 'COMPLETED')`,
    [randomUUID(), orgA, period1Id, slip2Id, empSalesRecordId],
  );

  // 8. Chart of Accounts
  const acc6422Id = randomUUID();
  const acc6421Id = randomUUID();
  const acc3341Id = randomUUID();
  const acc1121Id = randomUUID();

  await pool.query(
    `INSERT INTO accounting_accounts (id, organization_id, code, name, type)
     VALUES ($1, $2, '6422', 'Chi phí quản lý doanh nghiệp', 'EXPENSE'),
            ($3, $2, '6421', 'Chi phí bán hàng', 'EXPENSE'),
            ($4, $2, '3341', 'Phải trả người lao động', 'LIABILITY'),
            ($5, $2, '1121', 'Tiền gửi ngân hàng', 'ASSET')`,
    [acc6422Id, orgA, acc6421Id, acc3341Id, acc1121Id],
  );

  // 9. Journal Entry in Period 1
  const entryId = randomUUID();
  await pool.query(
    `INSERT INTO payroll_journal_entries (id, organization_id, period_id, entry_number, entry_date, status, total_debit, total_credit, description)
     VALUES ($1, $2, $3, 'PKT-2026-01-001', '2026-01-31', 'DRAFT', 46000000.00, 46000000.00, 'Hạch toán chi phí lương tháng 01/2026')`,
    [entryId, orgA, period1Id],
  );

  // Entry Lines:
  // Debit 6422: 25,000,000 (Dev dept)
  // Debit 6421: 21,000,000 (Sales dept)
  // Credit 3341: 46,000,000
  await pool.query(
    `INSERT INTO payroll_journal_entry_lines (id, organization_id, entry_id, account_id, department_id, debit_amount, credit_amount, description, line_order)
     VALUES ($1, $2, $3, $4, $5, 25000000.00, 0.00, 'Lương bộ phận Dev', 1),
            ($6, $2, $3, $7, $8, 21000000.00, 0.00, 'Lương bộ phận Sales', 2),
            ($9, $2, $3, $10, NULL, 0.00, 46000000.00, 'Phải trả người lao động', 3)`,
    [
      randomUUID(),
      orgA,
      entryId,
      acc6422Id,
      deptDevId,
      randomUUID(),
      acc6421Id,
      deptSalesId,
      randomUUID(),
      acc3341Id,
    ],
  );

  // Post the journal entry
  await pool.query(`UPDATE payroll_journal_entries SET status = 'POSTED' WHERE id = $1`, [entryId]);

  return {
    period1Id,
    period2Id,
    acc6422Id,
    acc6421Id,
    acc3341Id,
    acc1121Id,
    entryId,
  };
}

describe('RPT-001: Core HR & Attendance Reporting Center', () => {
  it('1. Auto-seeds default report catalog and respects RBAC visibility', async () => {
    const admin = new Client();
    await admin.login('admin@acme.test');

    const catRes = await admin.request(`/api/organizations/${orgA}/reports/catalog`);
    expect(catRes.status).toBe(200);
    expect(catRes.body.reports.length).toBe(15);
    const codes = catRes.body.reports.map((r: any) => r.code);
    expect(codes).toContain('RPT-EMP-01');
    expect(codes).toContain('RPT-ORG-01');
    expect(codes).toContain('RPT-ATT-01');
    expect(codes).toContain('RPT-LEAVE-01');
    expect(codes).toContain('RPT-PAY-01');
    expect(codes).toContain('RPT-PAY-02');
    expect(codes).toContain('RPT-PAY-03');
    expect(codes).toContain('RPT-ACC-01');
    expect(codes).toContain('RPT-ACC-02');
    expect(codes).toContain('RPT-ACC-03');
    expect(codes).toContain('RPT-TAX-01');
    expect(codes).toContain('RPT-TAX-02');
    expect(codes).toContain('RPT-INS-01');
    expect(codes).toContain('RPT-INS-02');
    expect(codes).toContain('RPT-LAB-01');

    // Manager sees 5 reports (EMP, ORG, ATT, LEAVE, PAY-01)
    const manager = new Client();
    await manager.login('manager@acme.test');
    const mgrCat = await manager.request(`/api/organizations/${orgA}/reports/catalog`);
    expect(mgrCat.status).toBe(200);
    expect(mgrCat.body.reports.length).toBe(5);

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
    const devOnly = await hr.request(
      `/api/organizations/${orgA}/reports/emp-roster?departmentId=${deptDevId}`,
    );
    expect(devOnly.status).toBe(200);
    expect(devOnly.body.metrics.totalEmployees).toBe(1);
    expect(devOnly.body.items[0].employeeCode).toBe('EMP001');

    // Filter by contract type
    const indefOnly = await hr.request(
      `/api/organizations/${orgA}/reports/emp-roster?contractType=INDEFINITE`,
    );
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
      `/api/organizations/${orgA}/reports/attendance-summary?startDate=2026-03-01&endDate=2026-03-31`,
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
      `/api/organizations/${orgA}/reports/attendance-summary?startDate=2026-03-01&endDate=2026-03-31`,
    );
    expect(empRes.status).toBe(200);
    expect(empRes.body.items.length).toBe(1);
    expect(empRes.body.items[0].employeeCode).toBe('EMP001');
  });

  it('5. RPT-LEAVE-01: Leave utilization, allowance, charged hours, balance', async () => {
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/leave-summary?startDate=2026-03-01&endDate=2026-03-31`,
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
      filters: { status: 'ACTIVE' },
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
      format: 'CSV',
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
      filters: { departmentId: deptDevId, status: 'ACTIVE' },
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

  // =========================================================================
  // PAYROLL & ACCOUNTING REPORTING TESTS (RPT-002)
  // =========================================================================

  it('8. RPT-PAY-01: Payroll Summary & Slip Register (Metrics, Details & Scope)', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/payroll-summary?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.period.code).toBe('KY-2026-01');
    expect(res.body.period.status).toBe('CLOSED');
    expect(res.body.period.isDraft).toBe(false);

    // Metrics verification (exact numeric arithmetic)
    expect(res.body.metrics.totalSlips).toBe(2);
    expect(res.body.metrics.totalGross).toBe('46000000.00');
    expect(res.body.metrics.totalNet).toBe('42300000.00');
    expect(res.body.metrics.totalAllowances).toBe('3000000.00');
    expect(res.body.metrics.totalBonuses).toBe('8000000.00');
    expect(res.body.metrics.totalDeductions).toBe('3700000.00');

    // Slips verification
    expect(res.body.items.length).toBe(2);
    const devSlip = res.body.items.find((s: any) => s.employeeCode === 'EMP001');
    expect(devSlip).toBeDefined();
    expect(devSlip.grossPay).toBe('25000000.00');
    expect(devSlip.netPay).toBe('22900000.00');
    expect(devSlip.status).toBe('PAID');

    // Department filter verification
    const filteredRes = await hr.request(
      `/api/organizations/${orgA}/reports/payroll-summary?periodId=${period1Id}&departmentId=${deptDevId}`,
    );
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.items.length).toBe(1);
    expect(filteredRes.body.items[0].employeeCode).toBe('EMP001');

    // Manager role scope restriction: Dev Manager only sees Dev employee!
    const manager = new Client();
    await manager.login('manager@acme.test');
    const mgrRes = await manager.request(
      `/api/organizations/${orgA}/reports/payroll-summary?periodId=${period1Id}`,
    );
    expect(mgrRes.status).toBe(200);
    expect(mgrRes.body.items.length).toBe(1);
    expect(mgrRes.body.items[0].employeeCode).toBe('EMP001');
  });

  it('9. RPT-PAY-02: Salary Components & Deductions Breakdown (Taxable vs Non-Taxable)', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/payroll-components?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.period.code).toBe('KY-2026-01');

    // Allowances: 2,000,000 lunch (non-taxable) + 1,000,000 resp (taxable) = 3,000,000
    expect(res.body.metrics.totalAllowances).toBe('3000000.00');
    expect(res.body.metrics.nonTaxableAllowances).toBe('2000000.00');
    expect(res.body.metrics.taxableAllowances).toBe('1000000.00');
    expect(res.body.metrics.totalBonuses).toBe('8000000.00');
    expect(res.body.metrics.totalDeductions).toBe('3700000.00');

    // Items verification
    const lunch = res.body.items.find((i: any) => i.componentName === 'Phụ cấp ăn trưa');
    expect(lunch).toBeDefined();
    expect(lunch.recipientCount).toBe(2);
    expect(lunch.totalAmount).toBe('2000000.00');
    expect(lunch.isTaxable).toBe(false);

    const resp = res.body.items.find((i: any) => i.componentName === 'Phụ cấp trách nhiệm');
    expect(resp).toBeDefined();
    expect(resp.recipientCount).toBe(1);
    expect(resp.totalAmount).toBe('1000000.00');
    expect(resp.isTaxable).toBe(true);
  });

  it('10. RPT-PAY-03: Payroll Variance Between Periods & Anomaly Detection', async () => {
    const { period1Id, period2Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/payroll-variance?currentPeriodId=${period2Id}&previousPeriodId=${period1Id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.currentPeriod.code).toBe('KY-2026-02');
    expect(res.body.previousPeriod.code).toBe('KY-2026-01');

    // Headcount unchanged (2 employees in both periods)
    expect(res.body.metrics.currentHeadcount).toBe(2);
    expect(res.body.metrics.previousHeadcount).toBe(2);
    expect(res.body.metrics.headcountDelta).toBe(0);

    // Current gross: 22M + 26M = 48M. Previous gross: 25M + 21M = 46M. Delta = +2M
    expect(res.body.metrics.currentGrossTotal).toBe('48000000.00');
    expect(res.body.metrics.previousGrossTotal).toBe('46000000.00');
    expect(res.body.metrics.grossDelta).toBe('2000000.00');

    // Check anomalous employee detection:
    // Sales employee net pay jumped from 19,400,000 to 23,400,000 (+4,000,000 / 19,400,000 = +20.62% >= 20%)
    expect(res.body.metrics.anomalousCount).toBe(1);
    const salesVariance = res.body.items.find((i: any) => i.employeeCode === 'EMP002');
    expect(salesVariance).toBeDefined();
    expect(salesVariance.previousNetPay).toBe('19400000.00');
    expect(salesVariance.currentNetPay).toBe('23400000.00');
    expect(salesVariance.isAnomalous).toBe(true);

    const devVariance = res.body.items.find((i: any) => i.employeeCode === 'EMP001');
    expect(devVariance).toBeDefined();
    expect(devVariance.isAnomalous).toBe(false);
  });

  it('11. RPT-ACC-01: Cost Allocation by Department & VAS Accounts', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/cost-allocation?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);

    // Total gross: 46,000,000
    // Total employer statutory (21.5% of 46M): 9,890,000.00
    // Total trade union (2% of 46M): 920,000.00
    // Total CTC: 46M + 9.89M + 0.92M = 56,810,000.00
    expect(res.body.metrics.totalGrossSalary).toBe('46000000.00');
    expect(res.body.metrics.totalEmployerStatutory).toBe('9890000.00');
    expect(res.body.metrics.totalTradeUnion).toBe('920000.00');
    expect(res.body.metrics.totalCompanyCost).toBe('56810000.00');

    // Allocations check
    expect(res.body.allocations.length).toBe(2);
    const devAlloc = res.body.allocations.find((a: any) => a.departmentCode === 'DEV');
    expect(devAlloc.vasAccount).toBe('6422'); // Admin / General management
    expect(devAlloc.grossSalary).toBe('25000000.00');
    expect(devAlloc.employerStatutory).toBe('5375000.00'); // 21.5% of 25M
    expect(devAlloc.tradeUnion).toBe('500000.00'); // 2% of 25M
    expect(devAlloc.totalCostToCompany).toBe('30875000.00');

    const salesAlloc = res.body.allocations.find((a: any) => a.departmentCode === 'SALES');
    expect(salesAlloc.vasAccount).toBe('6421'); // Sales expense
    expect(salesAlloc.grossSalary).toBe('21000000.00');
    expect(salesAlloc.employerStatutory).toBe('4515000.00'); // 21.5% of 21M
    expect(salesAlloc.tradeUnion).toBe('420000.00'); // 2% of 21M
    expect(salesAlloc.totalCostToCompany).toBe('25935000.00');
  });

  it('12. RPT-ACC-02: Payroll Liabilities & 3-Way Reconciliation', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/payroll-liabilities?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);

    // Total Payable: 42,300,000.00 (Net pay)
    // Total Disbursed: 22,900,000 (Dev) + 10,000,000 (Sales) = 32,900,000.00
    // Remaining Liability: 42,300,000 - 32,900,000 = 9,400,000.00
    expect(res.body.metrics.payableLiability).toBe('42300000.00');
    expect(res.body.metrics.disbursedPayment).toBe('32900000.00');
    expect(res.body.metrics.remainingLiability).toBe('9400000.00');
    expect(res.body.metrics.disbursementCount).toBe(2);

    // Item statuses
    const dev = res.body.items.find((i: any) => i.employeeCode === 'EMP001');
    expect(dev.settlementStatus).toBe('PAID');
    expect(dev.remainingBalance).toBe('0.00');

    const sales = res.body.items.find((i: any) => i.employeeCode === 'EMP002');
    expect(sales.settlementStatus).toBe('PARTIAL');
    expect(sales.remainingBalance).toBe('9400000.00');

    // Status filter
    const partialOnly = await hr.request(
      `/api/organizations/${orgA}/reports/payroll-liabilities?periodId=${period1Id}&status=PARTIAL`,
    );
    expect(partialOnly.status).toBe(200);
    expect(partialOnly.body.items.length).toBe(1);
    expect(partialOnly.body.items[0].employeeCode).toBe('EMP002');
  });

  it('13. RPT-ACC-03: General Ledger Journal Entries (Double-Entry Balance Audit)', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/journal-entries?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);

    // Metrics verification
    expect(res.body.metrics.totalEntries).toBe(1);
    expect(res.body.metrics.postedEntries).toBe(1);
    expect(res.body.metrics.totalDebit).toBe('46000000.00');
    expect(res.body.metrics.totalCredit).toBe('46000000.00');
    expect(res.body.metrics.isBalanced).toBe(true);

    // Entry details
    const entry = res.body.items[0];
    expect(entry.entryNumber).toBe('PKT-2026-01-001');
    expect(entry.status).toBe('POSTED');
    expect(entry.lines.length).toBe(3);

    // Verify lines
    const lineDev = entry.lines.find((l: any) => l.accountCode === '6422');
    expect(lineDev.debitAmount).toBe('25000000.00');
    expect(lineDev.creditAmount).toBe('0.00');

    const lineSales = entry.lines.find((l: any) => l.accountCode === '6421');
    expect(lineSales.debitAmount).toBe('21000000.00');
    expect(lineSales.creditAmount).toBe('0.00');

    const linePayable = entry.lines.find((l: any) => l.accountCode === '3341');
    expect(linePayable.creditAmount).toBe('46000000.00');
  });

  it('14. CSV Export for Payroll & Accounting Reports (UTF-8 BOM & Audit Logging)', async () => {
    const { period1Id, period2Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    // 1. Export RPT-PAY-01
    const expPay01 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-PAY-01',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expPay01.status).toBe(200);
    expect(expPay01.text).toContain('BÁO CÁO BẢNG LƯƠNG TỔNG HỢP & CHI TIẾT THEO KỲ');
    expect(expPay01.text).toContain('EMP001,Dev Employee');
    expect(expPay01.text).toContain('25000000.00');

    // 2. Export RPT-PAY-02
    const expPay02 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-PAY-02',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expPay02.status).toBe(200);
    expect(expPay02.text).toContain('BÁO CÁO CƠ CẤU PHỤ CẤP, THƯỞNG & KHẤU TRỪ');
    expect(expPay02.text).toContain('Phụ cấp ăn trưa,ALLOWANCE');

    // 3. Export RPT-PAY-03
    const expPay03 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-PAY-03',
      format: 'CSV',
      filters: { currentPeriodId: period2Id, previousPeriodId: period1Id },
    });
    expect(expPay03.status).toBe(200);
    expect(expPay03.text).toContain('BÁO CÁO BIẾN ĐỘNG QUỸ LƯƠNG GIỮA CÁC KỲ');
    expect(expPay03.text).toContain('EMP002,Sales Employee');

    // 4. Export RPT-ACC-01
    const expAcc01 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-ACC-01',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expAcc01.status).toBe(200);
    expect(expAcc01.text).toContain(
      'BÁO CÁO PHÂN BỔ CHI PHÍ LƯƠNG THEO PHÒNG BAN & TÀI KHOẢN KẾ TOÁN',
    );
    expect(expAcc01.text).toContain('6422');
    expect(expAcc01.text).toContain('6421');

    // 5. Export RPT-ACC-02
    const expAcc02 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-ACC-02',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expAcc02.status).toBe(200);
    expect(expAcc02.text).toContain('BÁO CÁO CÔNG NỢ LƯƠNG & ĐỐI CHIẾU THANH TOÁN');
    expect(expAcc02.text).toContain('Đã thanh toán đủ');
    expect(expAcc02.text).toContain('Thanh toán một phần');

    // 6. Export RPT-ACC-03
    const expAcc03 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-ACC-03',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expAcc03.status).toBe(200);
    expect(expAcc03.text).toContain('BÁO CÁO SỔ NHẬT KÝ BÚT TOÁN KẾ TOÁN LƯƠNG');
    expect(expAcc03.text).toContain('PKT-2026-01-001');

    // Verify audit logs generated for each
    const auditRes = await hr.request(`/api/organizations/${orgA}/reports/export-audit`);
    expect(auditRes.status).toBe(200);
    const codes = auditRes.body.auditLogs.map((l: any) => l.reportCode);
    expect(codes).toContain('RPT-PAY-01');
    expect(codes).toContain('RPT-PAY-02');
    expect(codes).toContain('RPT-PAY-03');
    expect(codes).toContain('RPT-ACC-01');
    expect(codes).toContain('RPT-ACC-02');
    expect(codes).toContain('RPT-ACC-03');
  });

  it('15. RBAC & Tenant Isolation for Payroll/Accounting Reporting', async () => {
    const { period1Id } = await setupPayrollTestData();

    // Employee cannot access payroll summary (minRole is MANAGER) -> 403
    const emp = new Client();
    await emp.login('dev@acme.test');
    const empRes = await emp.request(
      `/api/organizations/${orgA}/reports/payroll-summary?periodId=${period1Id}`,
    );
    expect(empRes.status).toBe(403);

    // Employee cannot export payroll report -> 403
    const empExport = await emp.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-PAY-01',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(empExport.status).toBe(403);

    // Manager cannot access journal entries (minRole is HR) -> 403
    const mgr = new Client();
    await mgr.login('manager@acme.test');
    const mgrJournal = await mgr.request(
      `/api/organizations/${orgA}/reports/journal-entries?periodId=${period1Id}`,
    );
    expect(mgrJournal.status).toBe(403);

    // Org B user cannot access Org A payroll data
    const orgBAdmin = await createUser('admin@beta.test', orgB, 'ADMIN', 'Beta Admin');
    const bClient = new Client();
    await bClient.login('admin@beta.test');
    const crossOrgRes = await bClient.request(
      `/api/organizations/${orgB}/reports/payroll-summary?periodId=${period1Id}`,
    );
    expect(crossOrgRes.status).toBe(404);
  });

  // =========================================================================
  // COMPLIANCE & STATUTORY REPORTING TESTS (RPT-003)
  // =========================================================================

  it('16. RPT-TAX-01: Báo cáo thuế TNCN định kỳ (Mẫu 05/KK-TNCN) & đối chiếu bảng lương', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/tax-summary?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.period.code).toBe('KY-2026-01');
    expect(res.body.metrics.totalEmployees).toBe(2);
    expect(res.body.metrics.totalGrossIncome).toBe('46000000.00');
    expect(res.body.metrics.totalTaxableIncome).toBe('44540000.00');
    expect(res.body.metrics.totalPersonalDeductions).toBe('22000000.00');
    expect(res.body.metrics.totalDependentDeductions).toBe('0.00');
    expect(res.body.metrics.totalInsuranceDeductions).toBe('3700000.00');
    expect(res.body.metrics.totalPitWithheld).toBe('1442500.00');

    expect(res.body.items.length).toBe(2);
    const devItem = res.body.items.find((i: any) => i.employeeCode === 'EMP001');
    expect(devItem).toBeDefined();
    expect(devItem.grossIncome).toBe('25000000.00');
    expect(devItem.taxableIncome).toBe('24270000.00');
    expect(devItem.personalDeduction).toBe('11000000.00');
    expect(devItem.insuranceDeduction).toBe('2100000.00');
    expect(devItem.assessableIncome).toBe('11170000.00');
    expect(devItem.computedPit).toBe('925500.00');

    // Filter by department
    const devOnly = await hr.request(
      `/api/organizations/${orgA}/reports/tax-summary?periodId=${period1Id}&departmentId=${deptDevId}`,
    );
    expect(devOnly.status).toBe(200);
    expect(devOnly.body.metrics.totalEmployees).toBe(1);
    expect(devOnly.body.items[0].employeeCode).toBe('EMP001');
  });

  it('17. RPT-TAX-02: Báo cáo quyết toán thuế TNCN năm (Mẫu 05/QTT-TNCN)', async () => {
    await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(`/api/organizations/${orgA}/reports/tax-settlement?year=2026`);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.metrics.totalEmployees).toBe(2);
    expect(res.body.metrics.residentEmployees).toBe(2);
    expect(res.body.metrics.qualifyingEmployees).toBe(2);
    expect(res.body.metrics.totalPersonalDeductions).toBe('264000000.00');
    expect(res.body.items.length).toBe(2);
  });

  it('18. RPT-INS-01: Báo cáo trích nộp BHXH, BHYT, BHTN & Kinh phí công đoàn (Mức đóng & tỷ lệ)', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/insurance-contributions?periodId=${period1Id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.period.code).toBe('KY-2026-01');
    expect(res.body.metrics.totalInsuredEmployees).toBe(2);
    expect(res.body.metrics.totalContractSalary).toBe('35000000.00');
    expect(res.body.metrics.totalCappedSiSalary).toBe('35000000.00');
    expect(res.body.metrics.totalCappedUiSalary).toBe('35000000.00');

    // Rates: Employee 10.5%, Employer 21.5%, Union 2%, Total 34%
    expect(res.body.metrics.employeeTotalCents).toBe('3675000.00');
    expect(res.body.metrics.employerTotalCents).toBe('7525000.00');
    expect(res.body.metrics.unionTotalCents).toBe('700000.00');
    expect(res.body.metrics.grandTotalContribution).toBe('11900000.00');

    expect(res.body.items.length).toBe(2);
    const devItem = res.body.items.find((i: any) => i.employeeCode === 'EMP001');
    expect(devItem).toBeDefined();
    expect(devItem.contractSalary).toBe('20000000.00');
    expect(devItem.empBhxh).toBe('1600000.00');
    expect(devItem.empBhyt).toBe('300000.00');
    expect(devItem.empBhtn).toBe('200000.00');
    expect(devItem.employeeTotal).toBe('2100000.00');
    expect(devItem.employerTotal).toBe('4300000.00');
    expect(devItem.tradeUnionFee).toBe('400000.00');
    expect(devItem.totalRemittance).toBe('6800000.00');
  });

  it('19. RPT-INS-02: Báo cáo tình hình biến động lao động tham gia BHXH (Mẫu D02-LT)', async () => {
    await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/insurance-fluctuations?year=2026`,
    );
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.metrics).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('20. RPT-LAB-01: Báo cáo tình hình sử dụng lao động định kỳ (Mẫu 01/PLI)', async () => {
    await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    const res = await hr.request(
      `/api/organizations/${orgA}/reports/labor-utilization?year=2026&half=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.half).toBe(1);
    expect(res.body.metrics.beginningHeadcount).toBe(2);
    expect(res.body.metrics.endingHeadcount).toBe(2);
    expect(res.body.metrics.increaseHeadcount).toBe(0);
    expect(res.body.metrics.decreaseHeadcount).toBe(0);
    expect(res.body.metrics.contractBreakdown.indefinite).toBe(1);
    expect(res.body.metrics.contractBreakdown.fixedTerm).toBe(1);
    expect(res.body.items.length).toBe(2);
  });

  it('21. Export CSV for RPT-003 Statutory Reports with UTF-8 BOM & Audit Logging', async () => {
    const { period1Id } = await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');

    // 1. Export RPT-TAX-01
    const expTax01 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-TAX-01',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expTax01.status).toBe(200);
    expect(expTax01.headers.get('content-type')).toContain('text/csv');
    expect(expTax01.text).toContain('BÁO CÁO THUẾ THU NHẬP CÁ NHÂN ĐỊNH KỲ');
    expect(expTax01.text).toContain('EMP001');

    // 2. Export RPT-TAX-02
    const expTax02 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-TAX-02',
      format: 'CSV',
      filters: { year: '2026' },
    });
    expect(expTax02.status).toBe(200);
    expect(expTax02.headers.get('content-type')).toContain('text/csv');
    expect(expTax02.text).toContain('BÁO CÁO QUYẾT TOÁN THUẾ THU NHẬP CÁ NHÂN NĂM');

    // 3. Export RPT-INS-01
    const expIns01 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-INS-01',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(expIns01.status).toBe(200);
    expect(expIns01.headers.get('content-type')).toContain('text/csv');
    expect(expIns01.text).toContain('BÁO CÁO TRÍCH NỘP BHXH, BHYT, BHTN & KINH PHÍ CÔNG ĐOÀN');
    expect(expIns01.text).toContain('10.5%');
    expect(expIns01.text).toContain('21.5%');

    // 4. Export RPT-INS-02
    const expIns02 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-INS-02',
      format: 'CSV',
      filters: { year: '2026' },
    });
    expect(expIns02.status).toBe(200);
    expect(expIns02.headers.get('content-type')).toContain('text/csv');
    expect(expIns02.text).toContain('BÁO CÁO TÌNH HÌNH BIẾN ĐỘNG LAO ĐỘNG THAM GIA BẢO HIỂM');

    // 5. Export RPT-LAB-01
    const expLab01 = await hr.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-LAB-01',
      format: 'CSV',
      filters: { year: '2026', half: '1' },
    });
    expect(expLab01.status).toBe(200);
    expect(expLab01.headers.get('content-type')).toContain('text/csv');
    expect(expLab01.text).toContain('BÁO CÁO TÌNH HÌNH SỬ DỤNG LAO ĐỘNG ĐỊNH KỲ');
    expect(expLab01.text).toContain('Hợp đồng KXDTH');

    // Audit log verification
    const auditRes = await hr.request(`/api/organizations/${orgA}/reports/export-audit`);
    expect(auditRes.status).toBe(200);
    const codes = auditRes.body.auditLogs.map((l: any) => l.reportCode);
    expect(codes).toContain('RPT-TAX-01');
    expect(codes).toContain('RPT-TAX-02');
    expect(codes).toContain('RPT-INS-01');
    expect(codes).toContain('RPT-INS-02');
    expect(codes).toContain('RPT-LAB-01');
  });

  it('22. RBAC & Tenant Isolation for Compliance Reporting', async () => {
    const { period1Id } = await setupPayrollTestData();

    // Employee cannot access tax summary (minRole is HR) -> 403
    const emp = new Client();
    await emp.login('dev@acme.test');
    const empTax = await emp.request(
      `/api/organizations/${orgA}/reports/tax-summary?periodId=${period1Id}`,
    );
    expect(empTax.status).toBe(403);

    // Employee cannot access insurance contributions (minRole is HR) -> 403
    const empIns = await emp.request(
      `/api/organizations/${orgA}/reports/insurance-contributions?periodId=${period1Id}`,
    );
    expect(empIns.status).toBe(403);

    // Employee cannot export RPT-TAX-01 -> 403
    const empExport = await emp.request(`/api/organizations/${orgA}/reports/export`, 'POST', {
      reportCode: 'RPT-TAX-01',
      format: 'CSV',
      filters: { periodId: period1Id },
    });
    expect(empExport.status).toBe(403);

    // Manager cannot access tax summary (minRole is HR) -> 403
    const mgr = new Client();
    await mgr.login('manager@acme.test');
    const mgrTax = await mgr.request(
      `/api/organizations/${orgA}/reports/tax-summary?periodId=${period1Id}`,
    );
    expect(mgrTax.status).toBe(403);

    // Manager cannot access labor utilization (minRole is HR) -> 403
    const mgrLab = await mgr.request(
      `/api/organizations/${orgA}/reports/labor-utilization?year=2026&half=1`,
    );
    expect(mgrLab.status).toBe(403);

    // Manager cannot access tax settlement (minRole is HR) -> 403
    const mgrTaxSet = await mgr.request(
      `/api/organizations/${orgA}/reports/tax-settlement?year=2026`,
    );
    expect(mgrTaxSet.status).toBe(403);

    // Org B user cannot access Org A tax data
    await createUser('admin@beta.test', orgB, 'ADMIN', 'Beta Admin');
    const bClient = new Client();
    await bClient.login('admin@beta.test');
    const crossOrgRes = await bClient.request(
      `/api/organizations/${orgB}/reports/tax-summary?periodId=${period1Id}`,
    );
    expect(crossOrgRes.status).toBe(404);
  });
});

describe('RPT-004 executive analytics', () => {
  const range = 'startDate=2026-01-01&endDate=2026-01-31';
  const endpoint = () => `/api/organizations/${orgA}/reports/executive`;

  it('defines lifecycle formulas, null denominators and exact cost division without invented history', () => {
    expect(lifecycleKpis({ opening: 100, closing: 120, departures: 11, retained: 95 })).toEqual({
      growth: 20,
      turnover: 10,
      retention: 95,
    });
    expect(
      lifecycleKpis({ opening: null, closing: null, departures: null, retained: null }),
    ).toEqual({ growth: null, turnover: null, retention: null });
    expect(ratio(0, 10)).toBe(0);
    expect(ratio(10, 0)).toBeNull();
    expect(costPerEmployee('9007199254740993.99', 3)).toBe('3002399751580331.33');
    expect(costPerEmployee(null, 1)).toBeNull();
    expect(costPerEmployee('1.00', 0)).toBeNull();
    expect(costPerEmployee('0.01', 2)).toBe('0.01');
    expect(moneyChangePercent('22000000.00', '25000000.00')).toBe(-12);
    expect(moneyChangePercent('100.01', '100.00')).toBe(0.01);
    expect(moneyChangePercent('0.00', '0.00')).toBeNull();
    expect(parseAnalyticsRange({ startDate: '2026-03-01', endDate: '2026-03-31' })).toMatchObject({
      compareStartDate: '2026-01-29',
      compareEndDate: '2026-02-28',
    });
    for (const raw of [
      { startDate: '2026-02-30', endDate: '2026-03-31' },
      { startDate: '2026-03-31', endDate: '2026-03-01' },
      { startDate: '2024-01-01', endDate: '2026-03-01' },
      { startDate: '2026-03-01', endDate: '2026-03-31', compareStartDate: '2026-01-01' },
      {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        compareStartDate: '2026-03-01',
        compareEndDate: '2026-03-31',
      },
    ])
      expect(() => parseAnalyticsRange(raw)).toThrow();
  });

  it('reconciles recorded payroll, expenses and payments while keeping missing sources null', async () => {
    await setupPayrollTestData();
    const hr = new Client();
    await hr.login('hr@acme.test');
    const january = await hr.request(`${endpoint()}?${range}`);
    expect(january.status, january.text).toBe(200);
    expect(january.headers.get('cache-control')).toBe('no-store');
    expect(january.body.workforce.headcount).toBe(2);
    expect(january.body.lifecycle).toEqual({
      growth: null,
      turnover: null,
      retention: null,
      departures: null,
    });
    expect(january.body.cost.current).toMatchObject({
      records: 2,
      employees: 2,
      gross: '46000000.00',
      averageSalary: '23000000.000000000000',
      net: '42300000.00',
    });
    expect(
      january.body.cost.current.departments.reduce((n: number, d: any) => n + Number(d.gross), 0),
    ).toBe(46000000);
    expect(january.body.cost.journal).toMatchObject({
      recognized: '46000000.00',
      liabilityMovement: '46000000.00',
    });
    expect(january.body.cost.costPerEmployee).toBe('23000000.00');
    expect(january.body.cost.current.insurance.employer).toBeNull();
    expect(january.body.cost.current.payments.amount).toBeNull();
    expect(january.body.attendance.attendanceRate).toBeNull();
    const february = await hr.request(
      `${endpoint()}?startDate=2026-02-01&endDate=2026-02-28&compareStartDate=2026-01-01&compareEndDate=2026-01-31`,
    );
    expect(february.status, february.text).toBe(200);
    expect(february.body.cost.current.gross).toBeNull(); // Draft period excluded.
    expect(february.body.cost.current.payments.amount).toBe('32900000.00'); // Actual February payment dates.
    expect(february.body.cost.previous.gross).toBe('46000000.00');
    expect(february.body.cost.grossChangePercent).toBeNull();
    expect(JSON.stringify(january.body.cost)).not.toContain('EMP001');
    const insuranceProfiles = [randomUUID(), randomUUID()];
    await pool.query(
      `INSERT INTO employee_social_insurance(id,organization_id,employee_id,si_code,insured_name,enrollment_date,currency)
      VALUES($1,$2,$3,'SI-DEV','Dev','2026-01-01','VND'),($4,$2,$5,'SI-SALES','Sales','2026-01-01','USD')`,
      [insuranceProfiles[0], orgA, empDevRecordId, insuranceProfiles[1], empSalesRecordId],
    );
    await pool.query(
      `INSERT INTO social_insurance_contributions(id,organization_id,employee_id,si_profile_id,contribution_month,si_salary,employer_amount,employee_amount,status)
      VALUES($1,$2,$3,$4,'2026-01-01',1000,123.45,67.89,'CONFIRMED'),($5,$2,$6,$7,'2026-01-01',1000,999,888,'CONFIRMED')`,
      [
        randomUUID(),
        orgA,
        empDevRecordId,
        insuranceProfiles[0],
        randomUUID(),
        empSalesRecordId,
        insuranceProfiles[1],
      ],
    );
    const recorded = await hr.request(`${endpoint()}?${range}`);
    expect(recorded.status, recorded.text).toBe(200);
    expect(recorded.body.cost.current.insurance).toMatchObject({
      records: 1,
      employer: '123.45',
      employee: '67.89',
      excludedCurrencyRecords: 1,
    });
    await pool.query(
      "UPDATE payroll_slips SET status='CONFIRMED' WHERE organization_id=$1 AND period_id IN(SELECT id FROM payroll_periods WHERE organization_id=$1 AND code='KY-2026-02')",
      [orgA],
    );
    await pool.query(
      "UPDATE payroll_periods SET status='APPROVED' WHERE organization_id=$1 AND code='KY-2026-02'",
      [orgA],
    );
    const comparison = await hr.request(
      `${endpoint()}?startDate=2026-02-01&endDate=2026-02-28&compareStartDate=2026-01-01&compareEndDate=2026-01-31&departmentId=${deptDevId}`,
    );
    expect(comparison.status, comparison.text).toBe(200);
    expect(comparison.body.cost.current.gross).toBe('22000000.00');
    expect(comparison.body.cost.previous.gross).toBe('25000000.00');
    expect(comparison.body.cost.grossChangePercent).toBe(-12);
  });

  it('enforces role and tenant boundaries and never returns financial data to a manager', async () => {
    await setupPayrollTestData();
    const manager = new Client();
    await manager.login('manager@acme.test');
    const scoped = await manager.request(`${endpoint()}?${range}`);
    expect(scoped.status, scoped.text).toBe(200);
    expect(scoped.body.workforce.headcount).toBe(1);
    expect(scoped.body.cost).toBeNull();
    expect(scoped.body.capabilities).toMatchObject({ financial: false, audit: false });
    expect(scoped.body.departments.map((d: any) => d.id)).toEqual([deptDevId]);
    expect(
      (await manager.request(`${endpoint()}?${range}&departmentId=${deptSalesId}`)).status,
    ).toBe(403);
    expect((await manager.request(`${endpoint()}/audit?${range}`)).status).toBe(403);
    expect(
      (await manager.request(`/api/organizations/${orgB}/reports/executive?${range}`)).status,
    ).toBe(403);
    const employee = new Client();
    await employee.login('dev@acme.test');
    expect((await employee.request(`${endpoint()}?${range}`)).status).toBe(403);
    const hr = new Client();
    await hr.login('hr@acme.test');
    expect((await hr.request(`${endpoint()}/audit?${range}`)).status).toBe(403);
    await createUser('admin@beta.test', orgB, 'ADMIN', 'Beta admin');
    const beta = new Client();
    await beta.login('admin@beta.test');
    const empty = await beta.request(`/api/organizations/${orgB}/reports/executive?${range}`);
    expect(empty.status, empty.text).toBe(200);
    expect(empty.body.workforce.headcount).toBe(0);
    expect(empty.body.cost.current.gross).toBeNull();
    expect(empty.body.structure).toEqual([]);
  });

  it('filters both comparison ranges, current department attribution and recursive branches', async () => {
    await setupPayrollTestData();
    const root = randomUUID();
    await pool.query(
      "INSERT INTO departments(id,organization_id,code,name) VALUES($1,$2,'ROOT','Root')",
      [root, orgA],
    );
    await pool.query('UPDATE departments SET parent_id=$1 WHERE id=ANY($2::uuid[])', [
      root,
      [deptDevId, deptSalesId],
    ]);
    const hr = new Client();
    await hr.login('hr@acme.test');
    const selected = await hr.request(
      `${endpoint()}?${range}&branchId=${root}&departmentId=${deptDevId}`,
    );
    expect(selected.status, selected.text).toBe(200);
    expect(selected.body.workforce.headcount).toBe(1);
    expect(selected.body.cost.current.gross).toBe('25000000.00');
    expect(selected.body.cost.journal.recognized).toBe('25000000.00');
    expect(selected.body.cost.journal.liabilityMovement).toBeNull(); // Unallocated liability is not invented per department.
    const branch = await hr.request(`${endpoint()}?${range}&branchId=${root}`);
    expect(branch.body.workforce.headcount).toBe(2);
    await pool.query('UPDATE departments SET manager_user_id=$1 WHERE id=$2', [managerId, root]);
    const manager = new Client();
    await manager.login('manager@acme.test');
    const managedBranch = await manager.request(`${endpoint()}?${range}&branchId=${root}`);
    expect(managedBranch.status, managedBranch.text).toBe(200);
    expect(managedBranch.body.workforce.headcount).toBe(2);
    expect(managedBranch.body.cost).toBeNull();
    const partial = await hr.request(`${endpoint()}?startDate=2026-01-02&endDate=2026-01-31`);
    expect(partial.body.cost.current.gross).toBeNull();
    for (const suffix of [
      'startDate=2026-02-30&endDate=2026-03-31',
      `${range}&grain=day`,
      `${range}&departmentId=invalid`,
      `${range}&salary=true`,
    ]) {
      expect((await hr.request(`${endpoint()}?${suffix}`)).status).toBe(400);
    }
  });

  it('uses the authoritative ATT ledger including approved corrections, leave and overtime rules', async () => {
    const admin = new Client();
    await admin.login('admin@acme.test');
    const schedules = await pool.query('SELECT id FROM work_schedule WHERE organization_id=$1', [
      orgA,
    ]);
    await pool.query('UPDATE work_schedule SET overtime_after=0 WHERE id=$1', [
      schedules.rows[0].id,
    ]);
    await pool.query('UPDATE attendance_punches SET checked_out_at=$1 WHERE schedule_id=$2', [
      '2026-03-10T11:30:00Z',
      schedules.rows[0].id,
    ]);
    const ledger = await admin.request(
      `/api/organizations/${orgA}/attendance/employees/${empDevRecordId}/ledger?from=2026-03-01&to=2026-03-31`,
    );
    expect(ledger.status, ledger.text).toBe(200);
    const res = await admin.request(`${endpoint()}?startDate=2026-03-01&endDate=2026-03-31`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.attendance).toMatchObject({
      schedules: 1,
      present: 1,
      attendanceRate: 100,
      absenteeismRate: 0,
      leaveRate: 0,
      overtimeRate: 10.17,
    });
    expect(Number(res.body.attendance.overtimeMinutes)).toBe(60);
    expect(Number(res.body.attendance.recordedMinutes)).toBe(590);
    expect(JSON.stringify(ledger.body)).toContain('"overtimeMinutes":60');
    await pool.query(
      `INSERT INTO attendance_adjustments(id,organization_id,schedule_id,created_by,reason,proposed_in,proposed_out,status,reviewed_by,reviewed_at)
      VALUES($1,$2,$3,$4,'Correction','2026-03-10T01:30:00Z','2026-03-10T10:30:00Z','APPROVED',$5,now())`,
      [randomUUID(), orgA, schedules.rows[0].id, employeeId, adminId],
    );
    const corrected = await admin.request(`${endpoint()}?startDate=2026-03-01&endDate=2026-03-31`);
    expect(corrected.status, corrected.text).toBe(200);
    expect(corrected.body.attendance.overtimeRate).toBe(0);
    expect(Number(corrected.body.attendance.recordedMinutes)).toBe(540);
    await pool.query(
      `INSERT INTO work_schedule(id,organization_id,employee_id,shift_id,label,work_date,time_zone,starts_at,ends_at,early_check_in,late_grace,early_grace,attendance_kind)
      SELECT gen_random_uuid(),organization_id,employee_id,shift_id,label,'2026-03-15',time_zone,'2026-03-15T01:30:00Z','2026-03-15T10:30:00Z',early_check_in,late_grace,early_grace,attendance_kind FROM work_schedule WHERE id=$1`,
      [schedules.rows[0].id],
    );
    await pool.query(
      `INSERT INTO work_schedule(id,organization_id,employee_id,shift_id,label,work_date,time_zone,starts_at,ends_at,early_check_in,late_grace,early_grace,attendance_kind)
      SELECT gen_random_uuid(),organization_id,employee_id,shift_id,label,'2026-03-16',time_zone,'2026-03-16T01:30:00Z','2026-03-16T10:30:00Z',early_check_in,late_grace,early_grace,attendance_kind FROM work_schedule WHERE id=$1`,
      [schedules.rows[0].id],
    );
    const withLeave = await admin.request(`${endpoint()}?startDate=2026-03-01&endDate=2026-03-31`);
    expect(withLeave.body.attendance).toMatchObject({
      schedules: 3,
      present: 1,
      leave: 1,
      absent: 1,
      attendanceRate: 33.33,
      absenteeismRate: 33.33,
      leaveRate: 33.33,
    });
  });

  it('returns filtered read-only audit headers from all sources without sensitive metadata', async () => {
    const admin = new Client();
    await admin.login('admin@acme.test');
    const subject = randomUUID();
    await pool.query(
      `INSERT INTO auth_audit_events(id,event_type,actor_user_id,organization_id,metadata,created_at)
      VALUES($1,'PAYROLL_APPROVED',$2,$3,$4::jsonb,'2026-01-15T12:00:00Z')`,
      [randomUUID(), adminId, orgA, JSON.stringify({ periodId: subject, salary: 'TOP_SECRET' })],
    );
    await pool.query(
      `INSERT INTO auth_audit_events(id,event_type,organization_id,metadata,created_at)
      VALUES($1,'PAYROLL_APPROVED',$2,$3::jsonb,'2026-01-15T12:00:00Z')`,
      [randomUUID(), orgB, JSON.stringify({ periodId: subject })],
    );
    await pool.query(
      `INSERT INTO compliance_audit_logs(id,organization_id,action,target_type,target_id,performed_by,created_at)
      VALUES($1,$2,'PAYROLL_APPROVED','PAYROLL',$3,$4,'2026-01-15T12:00:00Z')`,
      [randomUUID(), orgA, subject, adminId],
    );
    await pool.query(
      `INSERT INTO report_export_audit_logs(id,organization_id,report_code,format,exported_by,exported_at)
      VALUES($1,$2,'RPT-PAY-01','CSV',$3,'2026-01-16T12:00:00Z')`,
      [randomUUID(), orgA, adminId],
    );
    await pool.query(
      `INSERT INTO auth_audit_events(id,event_type,organization_id,created_at)
      VALUES($1,'MFA_FAILED',$2,'2025-12-31T18:00:00Z')`,
      [randomUUID(), orgA],
    );
    const filtered = await admin.request(
      `${endpoint()}/audit?${range}&actorId=${adminId}&action=PAYROLL_APPROVED&target=${subject}&limit=1`,
    );
    expect(filtered.status, filtered.text).toBe(200);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0]).not.toHaveProperty('metadata');
    expect(JSON.stringify(filtered.body)).not.toContain('TOP_SECRET');
    const all = await admin.request(`${endpoint()}/audit?${range}`);
    expect(all.body.total).toBe(4);
    expect(all.body.items.map((r: any) => r.source).sort()).toEqual([
      'AUTH_HR_PAY',
      'AUTH_HR_PAY',
      'COMPLIANCE',
      'REPORTING',
    ]);
    expect(
      (await admin.request(`/api/organizations/${orgB}/reports/executive/audit?${range}`)).status,
    ).toBe(403);
    expect((await admin.request(`${endpoint()}/audit?${range}&actorId=invalid`)).status).toBe(400);
    expect((await admin.request(`${endpoint()}/audit`, 'DELETE', {})).status).toBe(404);
    const access = await pool.query(
      "SELECT event_type FROM auth_audit_events WHERE organization_id=$1 AND event_type='EXECUTIVE_AUDIT_VIEWED'",
      [orgA],
    );
    expect(access.rowCount).toBe(2);
  });
});
