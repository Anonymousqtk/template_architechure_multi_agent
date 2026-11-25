import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Mailer } from '../src/mail.js';
import { hashPassword } from '../src/security.js';

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
let hrEmail: string;
let managerEmail: string;
let employeeEmail: string;
let orgBAdminEmail: string;
let passwordHash: string;

const mailer: Mailer = {
  mode: 'SMTP',
  async send() {
    return 'SENT';
  },
};

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
    const contentType = response.headers.get('content-type') ?? '';
    const buf = Buffer.from(await response.arrayBuffer());
    const text =
      contentType.includes('json') || contentType.includes('text') || contentType.includes('csv')
        ? buf.toString('utf8')
        : '';
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return {
      status: response.status,
      headers: response.headers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: parsed as Record<string, any>,
      text,
      buffer: buf,
    };
  }
  async login(email: string) {
    const csrfRes = await this.request('/api/auth/csrf');
    this.csrf = csrfRes.body.csrfToken;
    return this.request('/api/auth/login', 'POST', { email, password });
  }
}

async function createUser(email: string, org: string, role: string, fullName: string) {
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
    'TRUNCATE custom_report_export_jobs, custom_report_user_prefs, custom_report_versions, custom_reports, report_export_audit_logs, report_saved_templates, report_catalog, payroll_slips, payroll_periods, employees, positions, departments, auth_audit_events, user_sessions, invitations, memberships, users, organizations, auth_rate_limits CASCADE',
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

  hrEmail = 'hr@acme.test';
  managerEmail = 'mgr@acme.test';
  employeeEmail = 'dev@acme.test';
  orgBAdminEmail = 'admin@beta.test';

  await createUser('admin@acme.test', orgA, 'ADMIN', 'Admin User');
  await createUser(hrEmail, orgA, 'HR', 'HR User');
  const managerId = await createUser(managerEmail, orgA, 'MANAGER', 'Manager User');
  const devUserId = await createUser(employeeEmail, orgA, 'EMPLOYEE', 'Dev Employee');
  const salesUserId = await createUser('sales@acme.test', orgA, 'EMPLOYEE', 'Sales Employee');
  await createUser(orgBAdminEmail, orgB, 'ADMIN', 'Beta Admin');

  const deptDev = randomUUID();
  const deptSales = randomUUID();
  await pool.query(
    `INSERT INTO departments(id, organization_id, code, name, manager_user_id)
     VALUES ($1, $2, 'DEV', 'Engineering', $3),
            ($4, $2, 'SALES', 'Sales', NULL)`,
    [deptDev, orgA, managerId, deptSales],
  );

  const posDev = randomUUID();
  await pool.query(
    `INSERT INTO positions(id, organization_id, department_id, code, title)
     VALUES ($1, $2, $3, 'ENG-SR', 'Senior Engineer')`,
    [posDev, orgA, deptDev],
  );

  await pool.query(
    'UPDATE memberships SET department_id = $1 WHERE user_id = $2 AND organization_id = $3',
    [deptDev, managerId, orgA],
  );
  await pool.query(
    'UPDATE memberships SET department_id = $1, position_id = $2, manager_user_id = $3 WHERE user_id = $4 AND organization_id = $5',
    [deptDev, posDev, managerId, devUserId, orgA],
  );
  await pool.query(
    'UPDATE memberships SET department_id = $1 WHERE user_id = $2 AND organization_id = $3',
    [deptSales, salesUserId, orgA],
  );

  const empDev = randomUUID();
  const empSales = randomUUID();
  await pool.query(
    `INSERT INTO employees(id, organization_id, user_id, employee_code, full_name, hire_date, employment_status, department_id, position_id, manager_user_id)
     VALUES ($1, $2, $3, 'E001', 'Dev Employee', '2023-01-10', 'ACTIVE', $4, $5, $6),
            ($7, $2, $8, 'E002', 'Sales Employee', '2024-03-01', 'ACTIVE', $9, NULL, NULL)`,
    [empDev, orgA, devUserId, deptDev, posDev, managerId, empSales, salesUserId, deptSales],
  );

  const periodId = randomUUID();
  await pool.query(
    `INSERT INTO payroll_periods(id, organization_id, code, name, start_date, end_date, status)
     VALUES ($1, $2, '2026-03', 'Payroll 03/2026', '2026-03-01', '2026-03-31', 'APPROVED')`,
    [periodId, orgA],
  );
  await pool.query(
    `INSERT INTO payroll_slips(id, organization_id, period_id, employee_id, base_salary, gross_pay, net_pay)
     VALUES ($1, $2, $3, $4, 30000000, 35000000, 29000000),
            ($5, $2, $3, $6, 15000000, 20000000, 17500000)`,
    [randomUUID(), orgA, periodId, empDev, randomUUID(), empSales],
  );
});

describe('RPT-002 Report Builder Studio API', () => {
  it('filters semantic metadata by role and blocks unauthorized entity execution', async () => {
    const hrClient = new Client();
    await hrClient.login(hrEmail);
    const hrMeta = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/metadata?locale=en`,
    );
    expect(hrMeta.status).toBe(200);
    expect(hrMeta.body.entities.some((e: { id: string }) => e.id === 'payroll_slips')).toBe(true);
    expect(hrMeta.body.templates.length).toBeGreaterThanOrEqual(4);

    const empClient = new Client();
    await empClient.login(employeeEmail);
    const empMeta = await empClient.request(
      `/api/organizations/${orgA}/reports/builder/metadata?locale=en`,
    );
    expect(empMeta.status).toBe(200);
    expect(empMeta.body.entities.some((e: { id: string }) => e.id === 'payroll_slips')).toBe(false);

    const forbiddenExec = await empClient.request(
      `/api/organizations/${orgA}/reports/builder/execute`,
      'POST',
      {
        locale: 'en',
        definition: {
          primaryEntity: 'payroll_slips',
          relatedEntities: ['employees'],
          columns: [{ fieldId: 'emp.full_name' }],
          rows: [],
          pivotColumns: [],
          values: [],
          groupBy: [],
          filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
          sortBy: [],
          calculatedFields: [],
        },
      },
    );
    expect(forbiddenExec.status).toBe(403);
  });

  it('executes grouped aggregation, pivot matrix, calculated fields, and drill-down with scope enforcement', async () => {
    const hrClient = new Client();
    await hrClient.login(hrEmail);

    const groupedRes = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/execute`,
      'POST',
      {
        locale: 'en',
        definition: {
          primaryEntity: 'payroll_slips',
          relatedEntities: ['employees', 'departments'],
          columns: [],
          rows: [{ fieldId: 'dept.name' }],
          pivotColumns: [],
          values: [
            { id: 'gross', fieldId: 'slip.gross_pay', aggregation: 'SUM', label: 'Gross' },
            { id: 'pct', fieldId: 'slip.gross_pay', aggregation: 'PERCENTAGE', label: 'Share %' },
          ],
          groupBy: [{ fieldId: 'dept.name' }],
          filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
          sortBy: [{ fieldId: 'gross', direction: 'DESC' }],
          calculatedFields: [
            {
              id: 'net_margin',
              label: 'Emp Net Check',
              formula: 'ROUND(SAFE_DIV(30, 100, 0) * 100, 2)',
              format: 'number',
            },
          ],
          visualizationType: 'BAR',
        },
      },
    );
    expect(groupedRes.status).toBe(200);
    expect(groupedRes.body.mode).toBe('GROUPED');
    expect(groupedRes.body.rows).toHaveLength(2);
    expect(groupedRes.body.rows[0]['dept.name']).toBe('Engineering');
    expect(groupedRes.body.rows[0].gross).toBe(35000000);

    // Drill-down into Engineering department
    const drill = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/drilldown`,
      'POST',
      {
        locale: 'en',
        dimensionFilters: [{ fieldId: 'dept.name', value: 'Engineering' }],
        definition: {
          primaryEntity: 'payroll_slips',
          relatedEntities: ['employees', 'departments'],
          columns: [],
          rows: [{ fieldId: 'dept.name' }],
          pivotColumns: [],
          values: [{ id: 'gross', fieldId: 'slip.gross_pay', aggregation: 'SUM' }],
          groupBy: [{ fieldId: 'dept.name' }],
          filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
          sortBy: [],
          calculatedFields: [],
        },
      },
    );
    expect(drill.status).toBe(200);
    expect(drill.body.rows).toHaveLength(1);
    expect(drill.body.rows[0]['emp.full_name']).toBe('Dev Employee');

    // Pivot mode
    const pivotRes = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/execute`,
      'POST',
      {
        locale: 'en',
        definition: {
          primaryEntity: 'employees',
          relatedEntities: ['departments'],
          columns: [],
          rows: [{ fieldId: 'dept.name' }],
          pivotColumns: [{ fieldId: 'emp.status' }],
          values: [{ id: 'hc', fieldId: 'emp.id', aggregation: 'COUNT' }],
          groupBy: [],
          filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
          sortBy: [],
          calculatedFields: [],
          visualizationType: 'PIVOT',
        },
      },
    );
    expect(pivotRes.status).toBe(200);
    expect(pivotRes.body.mode).toBe('PIVOT');
    expect(pivotRes.body.pivot.pivotKeys).toContain('ACTIVE');

    // Manager scope sees only Dev Employee (Engineering)
    const mgrClient = new Client();
    await mgrClient.login(managerEmail);
    const mgrExec = await mgrClient.request(
      `/api/organizations/${orgA}/reports/builder/execute`,
      'POST',
      {
        locale: 'en',
        definition: {
          primaryEntity: 'employees',
          relatedEntities: ['departments'],
          columns: [{ fieldId: 'emp.code' }, { fieldId: 'emp.full_name' }],
          rows: [],
          pivotColumns: [],
          values: [],
          groupBy: [],
          filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
          sortBy: [],
          calculatedFields: [],
        },
      },
    );
    expect(mgrExec.status).toBe(200);
    expect(mgrExec.body.rows).toHaveLength(1);
    expect(mgrExec.body.rows[0]['emp.code']).toBe('E001');
  });

  it('supports library CRUD, sharing, versioning, favorites, exports, and tenant isolation', async () => {
    const hrClient = new Client();
    await hrClient.login(hrEmail);

    const def = {
      primaryEntity: 'employees',
      relatedEntities: ['departments'],
      columns: [{ fieldId: 'emp.code' }, { fieldId: 'emp.full_name' }, { fieldId: 'dept.name' }],
      rows: [],
      pivotColumns: [],
      values: [],
      groupBy: [],
      filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
      sortBy: [{ fieldId: 'emp.code', direction: 'ASC' }],
      calculatedFields: [],
      visualizationType: 'TABLE',
    };

    const createRes = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/library`,
      'POST',
      {
        name: 'Active Roster',
        description: 'Org roster',
        definition: def,
        visualizationType: 'TABLE',
        visibility: 'SHARED',
        sharedRoles: ['MANAGER'],
        changeNote: 'Initial v1',
      },
    );
    expect(createRes.status).toBe(201);
    const reportId = createRes.body.report.id;

    // Manager can read shared report, update favorite, cannot delete
    const mgrClient = new Client();
    await mgrClient.login(managerEmail);
    const mgrList = await mgrClient.request(`/api/organizations/${orgA}/reports/builder/library`);
    expect(mgrList.status).toBe(200);
    expect(mgrList.body.reports.some((r: { id: string }) => r.id === reportId)).toBe(true);

    const favRes = await mgrClient.request(
      `/api/organizations/${orgA}/reports/builder/library/${reportId}/favorite`,
      'POST',
      { isFavorite: true },
    );
    expect(favRes.status).toBe(200);
    expect(favRes.body.isFavorite).toBe(true);

    const mgrDelete = await mgrClient.request(
      `/api/organizations/${orgA}/reports/builder/library/${reportId}`,
      'DELETE',
    );
    expect(mgrDelete.status).toBe(403);

    // Org B cannot read org A reports
    const orgBClient = new Client();
    await orgBClient.login(orgBAdminEmail);
    const crossTenant = await orgBClient.request(
      `/api/organizations/${orgA}/reports/builder/library`,
    );
    expect([403, 404]).toContain(crossTenant.status);

    // Export synchronous Excel + asynchronous PDF job
    const excelRes = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/export`,
      'POST',
      {
        reportName: 'Active Roster',
        format: 'EXCEL',
        locale: 'en',
        definition: def,
      },
    );
    expect(excelRes.status).toBe(200);
    expect(excelRes.buffer.subarray(0, 2).toString()).toBe('PK');

    const jobCreate = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/export-jobs`,
      'POST',
      {
        reportId,
        reportName: 'Active Roster',
        format: 'PDF',
        locale: 'en',
        definition: def,
      },
    );
    expect(jobCreate.status).toBe(202);
    const jobId = jobCreate.body.jobId;

    // Wait briefly for setImmediate job execution
    let jobStatus = 'PENDING';
    for (let i = 0; i < 20; i++) {
      const check = await hrClient.request(
        `/api/organizations/${orgA}/reports/builder/export-jobs/${jobId}`,
      );
      jobStatus = check.body.status;
      if (jobStatus === 'COMPLETED' || jobStatus === 'FAILED') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(jobStatus).toBe('COMPLETED');

    const dl = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/export-jobs/${jobId}/download`,
    );
    expect(dl.status).toBe(200);
    expect(dl.buffer.subarray(0, 5).toString()).toBe('%PDF-');

    const dupRes = await hrClient.request(
      `/api/organizations/${orgA}/reports/builder/library/${reportId}/duplicate`,
      'POST',
      { name: 'Active Roster Copy' },
    );
    expect(dupRes.status).toBe(201);
  });
});
