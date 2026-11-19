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
let otherOrgAdminId: string;
let passwordHash: string;
const mailer: Mailer = { mode: 'SMTP', async send() { return 'SENT'; } };

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
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
  }
  async initialize() {
    this.csrf = (await this.request('/api/auth/csrf')).body.csrfToken;
    return this;
  }
  async login(email = 'admin@example.test', pass = password) {
    return this.request('/api/auth/login', 'POST', { email, password: pass });
  }
  post(path: string, body: unknown = {}) {
    return this.request(path, 'POST', body);
  }
  patch(path: string, body: unknown = {}) {
    return this.request(path, 'PATCH', body);
  }
  delete(path: string, body: unknown = {}) {
    return this.request(path, 'DELETE', body);
  }
}

async function actor(email: string) {
  const client = await new Client().initialize();
  const res = await client.login(email);
  expect(res.status).toBe(200);
  return client;
}

async function createUser(email: string, org: string, role: string) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())',
    [id, email, email, passwordHash],
  );
  await pool.query(
    'INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',
    [randomUUID(), id, org, role],
  );
  return id;
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
  base = await start();
}, 30000);

beforeEach(async () => {
  await pool.query(
    'TRUNCATE auth_audit_events,user_sessions,password_reset_tokens,invitations,memberships,positions,departments,users,organizations,auth_rate_limits CASCADE',
  );
  orgA = randomUUID();
  orgB = randomUUID();
  await pool.query(
    'INSERT INTO organizations(id,name,code,description) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
    [orgA, 'Acme Corp', 'ACME', 'Headquarters', orgB, 'Beta LLC', 'BETA', 'Subsidiary'],
  );
  adminId = await createUser('admin@example.test', orgA, 'ADMIN');
  hrId = await createUser('hr@example.test', orgA, 'HR');
  managerId = await createUser('manager@example.test', orgA, 'MANAGER');
  employeeId = await createUser('employee@example.test', orgA, 'EMPLOYEE');
  otherOrgAdminId = await createUser('other-admin@example.test', orgB, 'ADMIN');
});

afterAll(async () => {
  await Promise.all(
    servers.map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  await pool.end();
});

describe('ORG-001 Organization Structure, Departments, Positions & Hierarchy', () => {
  it('ORG-01: Organization management respects tenant isolation and Admin-only updates', async () => {
    const admin = await actor('admin@example.test');
    const hr = await actor('hr@example.test');
    const employee = await actor('employee@example.test');
    const otherAdmin = await actor('other-admin@example.test');

    // GET org details
    const getRes = await admin.request(`/api/organizations/${orgA}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.organization).toMatchObject({
      id: orgA,
      name: 'Acme Corp',
      code: 'ACME',
      description: 'Headquarters',
      isActive: true,
    });

    // Employee and HR can view their own organization
    expect((await employee.request(`/api/organizations/${orgA}`)).status).toBe(200);
    expect((await hr.request(`/api/organizations/${orgA}`)).status).toBe(200);

    // Cross-tenant viewing rejected
    expect((await otherAdmin.request(`/api/organizations/${orgA}`)).status).toBe(403);
    expect((await admin.request(`/api/organizations/${orgB}`)).status).toBe(403);

    // Admin can update org info
    const updateRes = await admin.patch(`/api/organizations/${orgA}`, {
      name: 'Acme Corporation Global',
      description: 'Leading global enterprise',
    });
    expect(updateRes.status).toBe(204);

    const afterUpdate = await admin.request(`/api/organizations/${orgA}`);
    expect(afterUpdate.body.organization.name).toBe('Acme Corporation Global');
    expect(afterUpdate.body.organization.description).toBe('Leading global enterprise');

    // HR and Employee cannot update org details
    expect((await hr.patch(`/api/organizations/${orgA}`, { name: 'HR Renamed' })).status).toBe(403);
    expect((await employee.patch(`/api/organizations/${orgA}`, { name: 'Emp Renamed' })).status).toBe(403);

    // Duplicate org code rejected
    const dupCode = await otherAdmin.patch(`/api/organizations/${orgB}`, { code: 'ACME' });
    expect(dupCode.status).toBe(409);
  });

  it('ORG-02: Valid department creation, hierarchical nesting, pagination and retrieval', async () => {
    const admin = await actor('admin@example.test');
    const hr = await actor('hr@example.test');
    const employee = await actor('employee@example.test');

    // Admin creates root department
    const createRoot = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'ENG',
      name: 'Kỹ thuật & Công nghệ',
      description: 'Phòng ban công nghệ',
      managerUserId: managerId,
    });
    expect(createRoot.status).toBe(201);
    const engId = createRoot.body.id;

    // HR creates child department (hierarchy)
    const createChild = await hr.post(`/api/organizations/${orgA}/departments`, {
      code: 'FE',
      name: 'Đội Frontend',
      description: 'Bộ phận giao diện người dùng',
      parentId: engId,
    });
    expect(createChild.status).toBe(201);
    const feId = createChild.body.id;

    // List departments with pagination
    const listRes = await employee.request(`/api/organizations/${orgA}/departments?page=1&limit=10`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(2);
    expect(listRes.body.items).toHaveLength(2);

    const engDept = listRes.body.items.find((d: { code: string }) => d.code === 'ENG');
    expect(engDept).toMatchObject({
      code: 'ENG',
      name: 'Kỹ thuật & Công nghệ',
      managerUserId: managerId,
      childCount: 1,
    });

    const feDept = listRes.body.items.find((d: { code: string }) => d.code === 'FE');
    expect(feDept).toMatchObject({
      code: 'FE',
      name: 'Đội Frontend',
      parentId: engId,
      parentName: 'Kỹ thuật & Công nghệ',
    });

    // Department detail
    const detailRes = await employee.request(`/api/organizations/${orgA}/departments/${feId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.department.parentName).toBe('Kỹ thuật & Công nghệ');

    // Employee cannot create or modify departments
    expect(
      (
        await employee.post(`/api/organizations/${orgA}/departments`, {
          code: 'UNAUTH',
          name: 'Unauthorized',
        })
      ).status,
    ).toBe(403);
  });

  it('ORG-03: Duplicate department code in same organization is rejected (409)', async () => {
    const admin = await actor('admin@example.test');

    const first = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'HR_DEPT',
      name: 'Phòng Nhân sự',
    });
    expect(first.status).toBe(201);

    const duplicate = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'HR_DEPT',
      name: 'Phòng Nhân sự 2',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('DEPARTMENT_CODE_EXISTS');

    // Case insensitivity of code
    const duplicateLower = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'hr_dept',
      name: 'Phòng Nhân sự Thường',
    });
    expect(duplicateLower.status).toBe(409);
  });

  it('ORG-04: Same department code in different organizations is allowed', async () => {
    const adminA = await actor('admin@example.test');
    const adminB = await actor('other-admin@example.test');

    const inOrgA = await adminA.post(`/api/organizations/${orgA}/departments`, {
      code: 'FINANCE',
      name: 'Tài chính Kế toán Org A',
    });
    expect(inOrgA.status).toBe(201);

    const inOrgB = await adminB.post(`/api/organizations/${orgB}/departments`, {
      code: 'FINANCE',
      name: 'Tài chính Kế toán Org B',
    });
    expect(inOrgB.status).toBe(201);
  });

  it('ORG-05: Circular department hierarchy is strictly detected and rejected (400)', async () => {
    const admin = await actor('admin@example.test');

    // Create 3 departments: A -> B -> C
    const resA = await admin.post(`/api/organizations/${orgA}/departments`, { code: 'DEPT_A', name: 'Dept A' });
    const idA = resA.body.id;

    const resB = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'DEPT_B',
      name: 'Dept B',
      parentId: idA,
    });
    const idB = resB.body.id;

    const resC = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'DEPT_C',
      name: 'Dept C',
      parentId: idB,
    });
    const idC = resC.body.id;

    // Self parent: A cannot be parent of A
    const selfParent = await admin.patch(`/api/organizations/${orgA}/departments/${idA}`, {
      parentId: idA,
    });
    expect(selfParent.status).toBe(400);

    // Circular loop: Setting A's parent to C (A -> B -> C -> A)
    const loopRes = await admin.patch(`/api/organizations/${orgA}/departments/${idA}`, {
      parentId: idC,
    });
    expect(loopRes.status).toBe(400);
    expect(loopRes.body.code).toBe('CIRCULAR_HIERARCHY');

    // Circular loop: Setting B's parent to C (B -> C -> B)
    const directLoop = await admin.patch(`/api/organizations/${orgA}/departments/${idB}`, {
      parentId: idC,
    });
    expect(directLoop.status).toBe(400);
    expect(directLoop.body.code).toBe('CIRCULAR_HIERARCHY');
  });

  it('ORG-06: Prevents deletion of department when active dependencies exist', async () => {
    const admin = await actor('admin@example.test');

    // 1. Department with child department
    const parent = await admin.post(`/api/organizations/${orgA}/departments`, { code: 'PARENT', name: 'Parent Dept' });
    const pId = parent.body.id;
    const child = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'CHILD',
      name: 'Child Dept',
      parentId: pId,
    });
    const cId = child.body.id;

    const deleteParent = await admin.delete(`/api/organizations/${orgA}/departments/${pId}`);
    expect(deleteParent.status).toBe(409);
    expect(deleteParent.body.code).toBe('DEPARTMENT_IN_USE_HAS_CHILDREN');

    // 2. Department with assigned members
    await pool.query('UPDATE memberships SET department_id = $1 WHERE user_id = $2', [cId, employeeId]);
    const deleteChildWithMember = await admin.delete(`/api/organizations/${orgA}/departments/${cId}`);
    expect(deleteChildWithMember.status).toBe(409);
    expect(deleteChildWithMember.body.code).toBe('DEPARTMENT_IN_USE_HAS_MEMBERS');

    // Unassign member
    await pool.query('UPDATE memberships SET department_id = NULL WHERE user_id = $1', [employeeId]);

    // 3. Department with assigned position
    const pos = await admin.post(`/api/organizations/${orgA}/positions`, {
      code: 'SPECIALIST',
      title: 'Chuyên viên',
      departmentId: cId,
    });
    const posId = pos.body.id;

    const deleteChildWithPos = await admin.delete(`/api/organizations/${orgA}/departments/${cId}`);
    expect(deleteChildWithPos.status).toBe(409);
    expect(deleteChildWithPos.body.code).toBe('DEPARTMENT_IN_USE_HAS_POSITIONS');

    // Delete position first
    expect((await admin.delete(`/api/organizations/${orgA}/positions/${posId}`)).status).toBe(204);

    // Now child can be deleted
    expect((await admin.delete(`/api/organizations/${orgA}/departments/${cId}`)).status).toBe(204);
    // Now parent can be deleted
    expect((await admin.delete(`/api/organizations/${orgA}/departments/${pId}`)).status).toBe(204);
  });

  it('ORG-07: Position management, duplicate guards, and dependency protections', async () => {
    const admin = await actor('admin@example.test');
    const hr = await actor('hr@example.test');
    const employee = await actor('employee@example.test');
    const otherAdmin = await actor('other-admin@example.test');

    // HR creates position
    const posRes = await hr.post(`/api/organizations/${orgA}/positions`, {
      code: 'SENIOR_DEV',
      title: 'Kỹ sư phần mềm cấp cao',
      description: 'Lập trình viên nhiều kinh nghiệm',
    });
    expect(posRes.status).toBe(201);
    const posId = posRes.body.id;

    // Duplicate code in same org rejected
    const dupRes = await hr.post(`/api/organizations/${orgA}/positions`, {
      code: 'SENIOR_DEV',
      title: 'Duplicate Dev',
    });
    expect(dupRes.status).toBe(409);

    // Same code in different org allowed
    const otherRes = await otherAdmin.post(`/api/organizations/${orgB}/positions`, {
      code: 'SENIOR_DEV',
      title: 'Senior Dev in Org B',
    });
    expect(otherRes.status).toBe(201);

    // List and details
    const list = await employee.request(`/api/organizations/${orgA}/positions`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].code).toBe('SENIOR_DEV');

    // Update position
    const updateRes = await hr.patch(`/api/organizations/${orgA}/positions/${posId}`, {
      title: 'Lead Software Engineer',
    });
    expect(updateRes.status).toBe(204);

    // Deletion guard when in use by member
    await pool.query('UPDATE memberships SET position_id = $1 WHERE user_id = $2', [posId, employeeId]);
    const deleteInUse = await admin.delete(`/api/organizations/${orgA}/positions/${posId}`);
    expect(deleteInUse.status).toBe(409);
    expect(deleteInUse.body.code).toBe('POSITION_IN_USE_HAS_MEMBERS');

    // Clear and delete
    await pool.query('UPDATE memberships SET position_id = NULL WHERE user_id = $1', [employeeId]);
    expect((await admin.delete(`/api/organizations/${orgA}/positions/${posId}`)).status).toBe(204);
  });

  it('ORG-08: Cross-tenant access strictly denied on all department and position endpoints', async () => {
    const adminA = await actor('admin@example.test');
    const adminB = await actor('other-admin@example.test');

    const deptA = (
      await adminA.post(`/api/organizations/${orgA}/departments`, {
        code: 'ORG_A_DEPT',
        name: 'Dept in A',
      })
    ).body.id;

    const posA = (
      await adminA.post(`/api/organizations/${orgA}/positions`, {
        code: 'ORG_A_POS',
        title: 'Pos in A',
      })
    ).body.id;

    // Admin B cannot access Org A's endpoints directly
    expect((await adminB.request(`/api/organizations/${orgA}/departments`)).status).toBe(403);
    expect((await adminB.request(`/api/organizations/${orgA}/positions`)).status).toBe(403);
    expect((await adminB.request(`/api/organizations/${orgA}/departments/${deptA}`)).status).toBe(403);
    expect((await adminB.request(`/api/organizations/${orgA}/positions/${posA}`)).status).toBe(403);

    // Admin B cannot patch or delete Org A's resources
    expect((await adminB.patch(`/api/organizations/${orgA}/departments/${deptA}`, { name: 'Hacked' })).status).toBe(
      403,
    );
    expect((await adminB.delete(`/api/organizations/${orgA}/departments/${deptA}`)).status).toBe(403);

    // Admin B in Org B cannot link to Org A's department as parent
    const foreignParent = await adminB.post(`/api/organizations/${orgB}/departments`, {
      code: 'ORG_B_DEPT',
      name: 'Dept in B',
      parentId: deptA,
    });
    expect(foreignParent.status).toBe(400);
    expect(foreignParent.body.code).toBe('INVALID_PARENT');

    // Admin B in Org B cannot link to Org A's department for a position
    const foreignPosDept = await adminB.post(`/api/organizations/${orgB}/positions`, {
      code: 'ORG_B_POS',
      title: 'Pos in B',
      departmentId: deptA,
    });
    expect(foreignPosDept.status).toBe(400);
    expect(foreignPosDept.body.code).toBe('INVALID_DEPARTMENT');
  });

  it('ORG-09: Member department/position assignment and circular reporting prevention', async () => {
    const admin = await actor('admin@example.test');
    const hr = await actor('hr@example.test');

    const dept = (
      await admin.post(`/api/organizations/${orgA}/departments`, {
        code: 'SALES',
        name: 'Kinh doanh',
      })
    ).body.id;

    const pos = (
      await admin.post(`/api/organizations/${orgA}/positions`, {
        code: 'SALES_REP',
        title: 'Đại diện bán hàng',
        departmentId: dept,
      })
    ).body.id;

    // HR assigns department and position to employee
    const assignRes = await hr.post(`/api/organizations/${orgA}/users/${employeeId}/assignment`, {
      departmentId: dept,
      positionId: pos,
    });
    expect(assignRes.status).toBe(204);

    // Check user profile detail reflects assignment
    const userDetail = await admin.request(`/api/organizations/${orgA}/users/${employeeId}`);
    expect(userDetail.status).toBe(200);
    expect(userDetail.body.user).toMatchObject({
      departmentId: dept,
      positionId: pos,
      departmentName: 'Kinh doanh',
      positionTitle: 'Đại diện bán hàng',
    });

    // Circular reporting structure detection
    // Setup: Manager1 -> Manager2 -> Manager3
    const u1 = await createUser('m1@example.test', orgA, 'MANAGER');
    const u2 = await createUser('m2@example.test', orgA, 'MANAGER');
    const u3 = await createUser('m3@example.test', orgA, 'EMPLOYEE');

    // u3 reports to u2
    expect((await admin.post(`/api/organizations/${orgA}/users/${u3}/manager`, { managerUserId: u2 })).status).toBe(
      204,
    );
    // u2 reports to u1
    expect((await admin.post(`/api/organizations/${orgA}/users/${u2}/manager`, { managerUserId: u1 })).status).toBe(
      204,
    );

    // Attempting to make u1 report to u3 creates circular loop (u1 -> u3 -> u2 -> u1)
    const cycleRes = await admin.post(`/api/organizations/${orgA}/users/${u1}/manager`, {
      managerUserId: u3,
    });
    expect(cycleRes.status).toBe(400);
    expect(cycleRes.body.code).toBe('CIRCULAR_REPORTING');

    // Direct self-manager rejected
    expect((await admin.post(`/api/organizations/${orgA}/users/${u1}/manager`, { managerUserId: u1 })).status).toBe(
      400,
    );
  });

  it('ORG-10: Organization Chart API provides tree hierarchy and member aggregation', async () => {
    const admin = await actor('admin@example.test');
    const employee = await actor('employee@example.test');

    // Create root dept and child dept
    const deptHead = (
      await admin.post(`/api/organizations/${orgA}/departments`, {
        code: 'HQ_DEPT',
        name: 'Trụ sở chính',
        managerUserId: adminId,
      })
    ).body.id;

    const subDept = (
      await admin.post(`/api/organizations/${orgA}/departments`, {
        code: 'SUB_DEPT',
        name: 'Bộ phận hỗ trợ',
        parentId: deptHead,
        managerUserId: managerId,
      })
    ).body.id;

    // Assign employee to subDept
    await admin.post(`/api/organizations/${orgA}/users/${employeeId}/assignment`, {
      departmentId: subDept,
      positionId: null,
    });

    // Org chart endpoint
    const chartRes = await employee.request(`/api/organizations/${orgA}/org-chart`);
    expect(chartRes.status).toBe(200);
    expect(chartRes.body.organization.name).toBe('Acme Corp');
    expect(chartRes.body.totalDepartments).toBe(2);
    expect(chartRes.body.departmentTree).toHaveLength(1);

    const rootNode = chartRes.body.departmentTree[0];
    expect(rootNode.code).toBe('HQ_DEPT');
    expect(rootNode.children).toHaveLength(1);
    expect(rootNode.children[0].code).toBe('SUB_DEPT');
    expect(rootNode.children[0].members).toHaveLength(1);
    expect(rootNode.children[0].members[0].userId).toBe(employeeId);
  });

  it('ORG-11: Unauthenticated requests and invalid CSRF rejected', async () => {
    const anon = new Client();
    expect((await anon.request(`/api/organizations/${orgA}/departments`)).status).toBe(401);
    expect((await anon.request(`/api/organizations/${orgA}/positions`)).status).toBe(401);
    expect((await anon.request(`/api/organizations/${orgA}/org-chart`)).status).toBe(401);

    // Valid session without CSRF token on mutation
    const admin = await actor('admin@example.test');
    admin.csrf = 'invalid-csrf-token';
    const badCsrf = await admin.post(`/api/organizations/${orgA}/departments`, {
      code: 'HACK',
      name: 'Hack',
    });
    expect(badCsrf.status).toBe(403);
  });
});
