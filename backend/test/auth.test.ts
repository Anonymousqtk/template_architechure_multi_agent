import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { digest, hashPassword, token, verifyPassword } from '../src/security.js';
import type { Mailer } from '../src/mail.js';
import { newTotpSecret, totp, verifyTotp, seal, unseal } from '../src/mfa-crypto.js';
import { authorizeMutation, permissionsFor } from '../src/authorization.js';

// Destructive fixture cleanup is permitted only by the disposable-cluster runner.
if (process.env.MIGRATION_TEST_BACKEND !== 'true' || !process.env.DATABASE_URL) {
  throw new Error('Run through backend/test-runner.mjs; a disposable PostgreSQL database is required.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const origin = 'http://localhost:3000';
const password = 'Correct horse test password 7!';
const newPassword = 'A different secure password 8!';
const config = { requireMfa:false,origin, production: false, csrfSecret: 'test-only-secret-'.repeat(4) };
const servers: Server[] = [];
let base: string;
let orgA: string;
let orgB: string;
let adminId: string;
let hrId: string;
let employeeId: string;
let passwordHash: string;
let deliveries: { to: string; link: string }[] = [];
const mailer: Mailer = { mode: 'SMTP', async send(to, _subject, link) { deliveries.push({ to, link }); return 'SENT'; } };

async function start(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const app = createApp({ pool, config, mailer, rateLimit: 500, ...options });
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
    const response = await fetch(this.url + path, { method, headers: {
      Cookie: [...this.cookies.values()].join('; '),
      ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
      ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      this.cookies.set(pair.split('=')[0], pair);
    }
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
  }
  async initialize() { this.csrf = (await this.request('/api/auth/csrf')).body.csrfToken; return this; }
  async login(email = 'admin@example.test', pass = password) { return this.request('/api/auth/login', 'POST', { email, password: pass }); }
  post(path: string, body: unknown = {}) { return this.request(path, 'POST', body); }
}
async function actor(email = 'admin@example.test', url = base) {
  const client = await new Client(url).initialize();
  expect((await client.login(email)).status).toBe(200);
  return client;
}
async function createUser(email: string, org: string, role: string) {
  const id = randomUUID();
  await pool.query('INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())', [id, email, email, passwordHash]);
  await pool.query('INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)', [randomUUID(), id, org, role]);
  return id;
}
async function invite(email = 'new@example.test', org = orgA, role = 'EMPLOYEE') {
  const raw = token(); const id = randomUUID();
  await pool.query("INSERT INTO invitations(id,organization_id,email,role,token_hash,created_by_user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '48 hours')", [id, org, email, role, digest(raw), adminId]);
  return { id, raw };
}
async function reset(userId = employeeId) {
  const raw = token(); const id = randomUUID();
  await pool.query("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')", [id, userId, digest(raw)]);
  return { id, raw };
}
const acceptBody = (raw: string) => ({ token: raw, fullName: 'New employee', password });
async function eventually(predicate: () => Promise<boolean>, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Expected observable condition was not reached');
}

beforeAll(async () => { passwordHash = await hashPassword(password); base = await start(); }, 30000);
beforeEach(async () => {
  deliveries = [];
  await pool.query('TRUNCATE auth_audit_events,user_sessions,password_reset_tokens,invitations,memberships,users,organizations,auth_rate_limits CASCADE');
  orgA = randomUUID(); orgB = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)', [orgA, 'Company A', orgB, 'Company B']);
  adminId = await createUser('admin@example.test', orgA, 'ADMIN');
  hrId = await createUser('hr@example.test', orgA, 'HR');
  employeeId = await createUser('employee@example.test', orgA, 'EMPLOYEE');
});
afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); })));
  await pool.end();
});

describe('AUTH-001 real HTTP/PostgreSQL matrix', () => {
  it('AUTH-01 denies anonymous account creation and exposes no public registration', async () => {
    const client = await new Client().initialize();
    expect((await client.post('/api/auth/register', { email: 'any@example.test', password })).status).toBe(404);
    expect((await client.post('/api/auth/invitations/accept', acceptBody(token()))).status).toBe(410);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(3);
  });
  it('AUTH-02 persists an own-org ADMIN invitation and uses the configured adapter', async () => {
    const client = await actor();
    expect((await client.post(`/api/organizations/${orgA}/invitations`, { email: ' New@Example.test ', role: 'EMPLOYEE' })).status).toBe(202);
    const row = (await pool.query('SELECT * FROM invitations')).rows[0];
    expect(row).toMatchObject({ organization_id: orgA, email: 'new@example.test', role: 'EMPLOYEE', delivery_status: 'SENT' });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].to).toBe('new@example.test');
    expect(digest(new URL(deliveries[0].link).searchParams.get('token')!)).toBe(row.token_hash);
    const list = await client.request(`/api/organizations/${orgA}/invitations?page=1&limit=1`);
    expect(list.status).toBe(200); expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty('token_hash');
  });
  it('AUTH-03 prevents HR granting ADMIN or HR; permits ADMIN granting HR', async () => {
    const hr = await actor('hr@example.test');
    expect((await hr.post(`/api/organizations/${orgA}/invitations`, { email: 'bad@example.test', role: 'ADMIN' })).status).toBe(400);
    expect((await hr.post(`/api/organizations/${orgA}/invitations`, { email: 'bad@example.test', role: 'HR' })).status).toBe(403);
    expect((await (await actor()).post(`/api/organizations/${orgA}/invitations`, { email: 'allowed@example.test', role: 'HR' })).status).toBe(202);
  });
  it('AUTH-04 rejects cross-org create/list/revoke/resend and employee access', async () => {
    const hr = await actor('hr@example.test'); const other = await invite('other@example.test', orgB);
    const path = `/api/organizations/${orgB}/invitations`;
    expect((await hr.post(path, { email: 'x@example.test', role: 'EMPLOYEE' })).status).toBe(403);
    expect((await hr.request(path)).status).toBe(403);
    for (const action of ['revoke', 'resend']) expect((await hr.post(`${path}/${other.id}/${action}`)).status).toBe(403);
    expect((await (await actor('employee@example.test')).request(`/api/organizations/${orgA}/invitations`)).status).toBe(403);
  });
  it('AUTH-05 and AUTH-06 atomically create one user/membership and reject replay', async () => {
    const invitation = await invite(); const client = await new Client().initialize();
    expect((await client.post('/api/auth/invitations/accept', acceptBody(invitation.raw))).status).toBe(204);
    expect((await client.post('/api/auth/invitations/accept', acceptBody(invitation.raw))).status).toBe(410);
    const rows = await pool.query('SELECT u.*,m.role,m.organization_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1', ['new@example.test']);
    expect(rows.rowCount).toBe(1); expect(rows.rows[0].role).toBe('EMPLOYEE'); expect(rows.rows[0].organization_id).toBe(orgA);
    expect(await verifyPassword(rows.rows[0].password_hash, password)).toBe(true);
    expect((await pool.query('SELECT consumed_at FROM invitations WHERE id=$1', [invitation.id])).rows[0].consumed_at).not.toBeNull();
  });
  it('AUTH-07 two concurrent invitation accepts have exactly one winner', async () => {
    const invitation = await invite(); const first = await new Client().initialize(); const second = await new Client().initialize();
    const results = await Promise.all([first.post('/api/auth/invitations/accept', acceptBody(invitation.raw)), second.post('/api/auth/invitations/accept', acceptBody(invitation.raw))]);
    expect(results.map(r => r.status).sort()).toEqual([204, 410]);
    expect((await pool.query("SELECT count(*)::int n FROM users WHERE email='new@example.test'")).rows[0].n).toBe(1);
  });
  it('AUTH-08 rejects expired, revoked and reissued tokens', async () => {
    const admin = await actor(); const anonymous = await new Client().initialize();
    const expired = await invite('expired@example.test');
    await pool.query("UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    expect((await anonymous.request(`/api/auth/invitations/validate?token=${expired.raw}`)).body.status).toBe('expired');
    expect((await anonymous.post('/api/auth/invitations/accept', acceptBody(expired.raw))).status).toBe(410);
    const revoked = await invite('revoked@example.test');
    expect((await admin.post(`/api/organizations/${orgA}/invitations/${revoked.id}/revoke`)).status).toBe(204);
    expect((await anonymous.post('/api/auth/invitations/accept', acceptBody(revoked.raw))).status).toBe(410);
    const reissued = await invite('reissued@example.test');
    await pool.query('TRUNCATE auth_rate_limits');
    expect((await admin.post(`/api/organizations/${orgA}/invitations/${reissued.id}/resend`)).status).toBe(202);
    expect((await anonymous.post('/api/auth/invitations/accept', acceptBody(reissued.raw))).status).toBe(410);
    const fresh = new URL(deliveries.at(-1)!.link).searchParams.get('token')!;
    expect((await anonymous.request(`/api/auth/invitations/validate?token=${fresh}`)).body.status).toBe('valid');
  });
  it('AUTH-09 rejects injected role/org payload without consuming invitation', async () => {
    const invitation = await invite(); const client = await new Client().initialize();
    expect((await client.post('/api/auth/invitations/accept', { ...acceptBody(invitation.raw), role: 'ADMIN', organizationId: orgB })).status).toBe(400);
    expect((await pool.query('SELECT consumed_at FROM invitations WHERE id=$1', [invitation.id])).rows[0].consumed_at).toBeNull();
  });
  it('AUTH-10 requires matching verified existing session and never overwrites password', async () => {
    const invitation = await invite('employee@example.test', orgB);
    const wrong = await actor('hr@example.test');
    expect((await wrong.post('/api/auth/invitations/accept', { token: invitation.raw })).status).toBe(403);
    const anonymous = await new Client().initialize();
    expect((await anonymous.post('/api/auth/invitations/accept', acceptBody(invitation.raw))).status).toBe(403);
    const employee = await actor('employee@example.test');
    expect((await employee.post('/api/auth/invitations/accept', { token: invitation.raw, password: newPassword })).status).toBe(204);
    const user = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [employeeId])).rows[0];
    expect(user.password_hash).toBe(passwordHash);
    expect((await pool.query('SELECT role FROM memberships WHERE user_id=$1 AND organization_id=$2', [employeeId, orgB])).rows[0].role).toBe('EMPLOYEE');
  });
  it('AUTH-11 rotates session and sets production cookie scope/flags', async () => {
    const url = await start({ config: { ...config, production: true } }); const client = await new Client(url).initialize();
    const first = await client.login(); const firstCookie = first.headers.getSetCookie().find(c => c.startsWith('__Host-managerhr='))!;
    expect(first.status).toBe(200); expect(firstCookie).toContain('HttpOnly'); expect(firstCookie).toContain('Secure'); expect(firstCookie).toContain('SameSite=Lax'); expect(firstCookie).toContain('Path=/'); expect(firstCookie).not.toContain('Domain=');
    const second = await client.login(); const secondCookie = second.headers.getSetCookie().find(c => c.startsWith('__Host-managerhr='))!;
    expect(firstCookie.split(';')[0]).not.toBe(secondCookie.split(';')[0]);
    expect((await pool.query('SELECT count(*)::int n FROM user_sessions WHERE revoked_at IS NULL')).rows[0].n).toBe(1);
  });
  it('AUTH-12 uses generic errors and persistent throttling', async () => {
    const url = await start({ rateLimit: 2 }); const client = await new Client(url).initialize();
    const bad = await client.login('admin@example.test', 'incorrect'); const unknown = await client.login('unknown@example.test', 'incorrect');
    expect(bad.status).toBe(401); expect(unknown.status).toBe(401); expect(bad.body).toEqual(unknown.body);
    const limited = await client.login(); expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('900');
  });
  it('AUTH-13 invalidates logout and blocks revoked membership, disabled user and inactive org', async () => {
    const client = await actor(); expect((await client.post('/api/auth/logout')).status).toBe(204); expect((await client.request('/api/auth/me')).status).toBe(401);
    for (const change of ["UPDATE memberships SET is_active=false WHERE user_id=$1", 'UPDATE users SET is_active=false WHERE id=$1']) {
      await pool.query('UPDATE users SET is_active=true'); await pool.query('UPDATE memberships SET is_active=true');
      const current = await actor(); await pool.query(change, [adminId]); expect((await current.request('/api/auth/me')).status).toBe(401);
    }
    await pool.query('UPDATE users SET is_active=true'); const current = await actor();
    await pool.query('UPDATE organizations SET is_active=false WHERE id=$1', [orgA]); expect((await current.request('/api/auth/me')).status).toBe(401);
  });
  it('AUTH-14 known/unknown reset responses match and do not await a slow mail provider', async () => {
    let finish!: () => void; let started = false;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const delayed: Mailer = { mode: 'SMTP', async send() { started = true; await blocked; return 'SENT'; } };
    const url = await start({ mailer: delayed }); const client = await new Client(url).initialize();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const known = await Promise.race([client.post('/api/auth/forgot-password', { email: 'employee@example.test' }), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Public response awaited SMTP')), 1500); })]);
      if (timeout) clearTimeout(timeout);
      const unknown = await client.post('/api/auth/forgot-password', { email: 'unknown@example.test' });
      expect(known.status).toBe(202); expect(known.body).toEqual(unknown.body);
      await eventually(async () => started);
    } finally { if (timeout) clearTimeout(timeout); finish(); }
  });
  it('AUTH-15 rejects expired/reset replay without changing password', async () => {
    const client = await new Client().initialize(); const expired = await reset();
    await pool.query("UPDATE password_reset_tokens SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    expect((await client.post('/api/auth/reset-password', { token: expired.raw, newPassword })).status).toBe(410);
    expect((await pool.query('SELECT password_hash FROM users WHERE id=$1', [employeeId])).rows[0].password_hash).toBe(passwordHash);
    const good = await reset(); expect((await client.post('/api/auth/reset-password', { token: good.raw, newPassword })).status).toBe(204);
    expect((await client.post('/api/auth/reset-password', { token: good.raw, newPassword: password })).status).toBe(410);
    expect(await verifyPassword((await pool.query('SELECT password_hash FROM users WHERE id=$1', [employeeId])).rows[0].password_hash, newPassword)).toBe(true);
  });
  it('AUTH-16 reset changes password, revokes all sessions, does not auto-login', async () => {
    const one = await actor('employee@example.test'); const two = await actor('employee@example.test'); const anonymous = await new Client().initialize(); const good = await reset();
    expect((await anonymous.post('/api/auth/reset-password', { token: good.raw, newPassword })).status).toBe(204);
    for (const client of [one, two, anonymous]) expect((await client.request('/api/auth/me')).status).toBe(401);
    expect((await anonymous.login('employee@example.test', password)).status).toBe(401);
    expect((await anonymous.login('employee@example.test', newPassword)).status).toBe(200);
  });
  it('AUTH-17 concurrent reset consumption has exactly one winner', async () => {
    const good = await reset(); const one = await new Client().initialize(); const two = await new Client().initialize();
    const results = await Promise.all([one.post('/api/auth/reset-password', { token: good.raw, newPassword }), two.post('/api/auth/reset-password', { token: good.raw, newPassword: password })]);
    expect(results.map(r => r.status).sort()).toEqual([204, 410]);
  });
  it('AUTH-18 rejects hostile origin, missing header and forged CSRF signatures', async () => {
    const client = await new Client().initialize();
    expect((await client.request('/api/auth/login', 'POST', { email: 'admin@example.test', password }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await client.request('/api/auth/login', 'POST', { email: 'admin@example.test', password }, { 'X-CSRF-Token': '' })).status).toBe(403);
    client.cookies.set('managerhr-csrf', `managerhr-csrf=${client.csrf}.forged`);
    expect((await client.login()).status).toBe(403);
  });
  it('AUTH-19 persists only hashes and does not emit bearer tokens to console', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
    try {
      const client = await actor(); await client.post(`/api/organizations/${orgA}/invitations`, { email: 'secret@example.test', role: 'EMPLOYEE' });
      await pool.query('TRUNCATE auth_rate_limits');
      await client.post('/api/auth/forgot-password', { email: 'employee@example.test' });
      await eventually(async () => deliveries.length === 2);
      const raw = deliveries.map(d => new URL(d.link).searchParams.get('token')!);
      const persisted = JSON.stringify((await pool.query('SELECT row_to_json(i) AS data FROM invitations i UNION ALL SELECT row_to_json(r) FROM password_reset_tokens r UNION ALL SELECT row_to_json(a) FROM auth_audit_events a UNION ALL SELECT row_to_json(s) FROM user_sessions s')).rows);
      const emitted = JSON.stringify(logs.flatMap(log => log.mock.calls));
      for (const secret of [...raw, client.cookies.get('managerhr')!.split('=')[1], password]) { expect(persisted).not.toContain(secret); expect(emitted).not.toContain(secret); }
      for (const value of raw) expect(persisted).toContain(digest(value));
    } finally { logs.forEach(log => log.mockRestore()); }
  });
  it('AUTH-20 explicitly reports absent-mailer DEV_ONLY without claiming delivery', async () => {
    const url = await start({ mailer: { mode: 'DEV_ONLY', send: async () => 'DEV_ONLY' } }); const client = await actor('admin@example.test', url);
    const response = await client.post(`/api/organizations/${orgA}/invitations`, { email: 'dev@example.test', role: 'EMPLOYEE' });
    expect(response.body.deliveryMode).toBe('DEV_ONLY');
    expect((await pool.query("SELECT delivery_status FROM invitations WHERE email='dev@example.test'")).rows[0].delivery_status).toBe('DEV_ONLY');
    expect((await client.post('/api/auth/forgot-password', { email: 'unknown@example.test' })).body.deliveryMode).toBe('DEV_ONLY');
  });
  it('AUTH-21 exposes no anonymous bootstrap endpoint', async () => {
    const client = await new Client().initialize();
    expect((await client.post('/api/auth/bootstrap', { email: 'admin2@example.test', password })).status).toBe(404);
  });
  it('AUTH-22 token responses set no-referrer, no-store, self-only resources and no redirect', async () => {
    const good = await invite(); const response = await new Client().request(`/api/auth/invitations/validate?token=${good.raw}`);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer'); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'"); expect(response.headers.get('Location')).toBeNull(); expect(JSON.stringify(response.body)).not.toContain(good.raw);
  });
  it('regression: csrf initialization in a second tab preserves the first tab token', async () => {
    const client = await new Client().initialize(); const firstToken = client.csrf;
    const secondTab = await client.request('/api/auth/csrf');
    expect(secondTab.body.csrfToken).toBe(firstToken);
    // The cookie jar is shared by tabs, while the first tab retains its header token.
    expect((await client.login()).status).toBe(200);
  });
  it('regression: overlapping resend deliveries cannot overwrite the current token delivery status', async () => {
    let rejectOlder!: (error: Error) => void; let calls = 0; let latestToken = '';
    const older = new Promise<'SENT'>((_, reject) => { rejectOlder = reject; });
    const reordered: Mailer = { mode: 'SMTP', async send(_to, _subject, link) {
      calls++; if (calls === 1) return older;
      latestToken = new URL(link).searchParams.get('token')!; return 'SENT';
    } };
    const url = await start({ mailer: reordered }); const client = await actor('admin@example.test', url); const invitation = await invite();
    const path = `/api/organizations/${orgA}/invitations/${invitation.id}/resend`;
    const first = client.post(path);
    try {
      await eventually(async () => calls === 1);
      expect((await client.post(path)).status).toBe(202);
      rejectOlder(new Error('simulated old delivery failure'));
      expect((await first).status).toBe(202);
      const row = (await pool.query('SELECT token_hash,delivery_status FROM invitations WHERE id=$1', [invitation.id])).rows[0];
      expect(row.token_hash).toBe(digest(latestToken)); expect(row.delivery_status).toBe('SENT');
    } finally { rejectOlder(new Error('test cleanup')); await first; }
  });
  it('regression: reset holding the user lock prevents old-password login from surviving reset', async () => {
    const good = await reset(); const anonymous = await new Client().initialize(); const login = await new Client().initialize();
    const blocker = await pool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [employeeId]);
    let resetRequest: ReturnType<Client['post']> | undefined; let loginRequest: ReturnType<Client['login']> | undefined;
    try {
      resetRequest = anonymous.post('/api/auth/reset-password', { token: good.raw, newPassword });
      await eventually(async () => (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id=%' AND pid<>pg_backend_pid()")).rowCount! > 0);
      loginRequest = login.login('employee@example.test');
      await eventually(async () => (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM users WHERE email=%' AND pid<>pg_backend_pid()")).rowCount! > 0);
      await blocker.query('COMMIT');
      expect((await resetRequest).status).toBe(204); expect((await loginRequest).status).toBe(401);
      expect((await pool.query('SELECT count(*)::int n FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL', [employeeId])).rows[0].n).toBe(0);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await Promise.allSettled([resetRequest, loginRequest].filter(Boolean)); }
  }, 15000);
});


describe('AUTH-002 tenant RBAC and account administration', () => {
  const users = () => `/api/organizations/${orgA}/users`;
  it('RBAC-01 permissions deny unknown roles and grant least privilege', () => {
    expect(Object.values(permissionsFor('UNKNOWN'))).not.toContain(true);
    expect(permissionsFor('MANAGER')).toMatchObject({readUsers:true,manageUsers:false,assignRoles:false,invite:false});
    expect(permissionsFor('HR')).toMatchObject({manageUsers:true,assignRoles:false,viewAudit:false});
  });
  it('RBAC-02 anonymous and invalid CSRF requests are denied', async () => {
    const anonymous=await new Client().initialize();
    expect((await anonymous.request(users())).status).toBe(401);
    const admin=await actor();
    expect((await admin.request(`${users()}/${employeeId}/status`,'POST',{isActive:false},{Origin:'https://hostile.invalid'})).status).toBe(403);
    expect((await pool.query('SELECT is_active FROM memberships WHERE user_id=$1',[employeeId])).rows[0].is_active).toBe(true);
  });
  it('RBAC-03 Admin search pagination filters and safe detail DTOs', async () => {
    await createUser('manager@example.test',orgA,'MANAGER');
    const admin=await actor();
    const result=await admin.request(users()+'?q=EXAMPLE&role=EMPLOYEE&status=active&page=1&limit=1');
    expect(result.status).toBe(200);expect(result.body.total).toBe(1);expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({id:employeeId,role:'EMPLOYEE',isActive:true});
    expect(Object.keys(result.body.items[0]).sort()).toEqual(['id','email','fullName','role','isActive','userIsActive','emailVerified','managerUserId','createdAt'].sort());
    const detail=await admin.request(`${users()}/${employeeId}`);expect(detail.status).toBe(200);
    expect((await admin.request(users()+'?q=%25')).body.total).toBe(0);
    expect((await admin.request(users()+'?q='+encodeURIComponent("' OR 1=1 --"))).body.total).toBe(0);
    expect((await admin.request(users()+'?page=0')).status).toBe(400);
    expect((await admin.request(users()+'?role=ROOT')).status).toBe(400);
  });
  it('RBAC-04 HR cannot grant ADMIN, modify privileged members, or read audit', async () => {
    const hr=await actor('hr@example.test');
    expect((await hr.post(`${users()}/${employeeId}/role`,{role:'ADMIN'})).status).toBe(403);
    expect((await hr.post(`${users()}/${adminId}/status`,{isActive:false})).status).toBe(403);
    expect((await hr.request(`${users()}/${adminId}`)).status).toBe(404);
    expect((await hr.request(`/api/organizations/${orgA}/audit-events`)).status).toBe(403);
    const list=await hr.request(users());expect(list.body.items.map((u:{role:string})=>u.role)).not.toContain('ADMIN');
    expect((await hr.request(users()+'?role=ADMIN')).body.total).toBe(0);
    expect((await hr.post(`${users()}/${employeeId}/status`,{isActive:false})).status).toBe(204);
  });
  it('RBAC-05 Manager sees only self and directly assigned employees', async () => {
    const managerId=await createUser('manager@example.test',orgA,'MANAGER');
    const otherId=await createUser('unassigned@example.test',orgA,'EMPLOYEE');
    await pool.query('UPDATE memberships SET manager_user_id=$1 WHERE user_id=$2',[managerId,employeeId]);
    const manager=await actor('manager@example.test');
    expect((await manager.request(users())).body.items.map((u:{id:string})=>u.id).sort()).toEqual([managerId,employeeId].sort());
    expect((await manager.request(`${users()}/${otherId}`)).status).toBe(404);
    expect((await manager.request(`${users()}/${employeeId}`)).status).toBe(200);
    expect((await manager.post(`${users()}/${managerId}/role`,{role:'ADMIN'})).status).toBe(403);
    expect((await manager.post(`${users()}/${employeeId}/status`,{isActive:false})).status).toBe(403);
    expect((await manager.post(`/api/organizations/${orgA}/invitations`,{email:'x@example.test',role:'EMPLOYEE'})).status).toBe(403);
  });
  it('RBAC-06 Employee own profile only and strict name update prevents elevation', async () => {
    const employee=await actor('employee@example.test');
    expect((await employee.request(users())).status).toBe(403);
    expect((await employee.request(`${users()}/${adminId}`)).status).toBe(403);
    expect((await employee.request(`${users()}/${employeeId}`)).status).toBe(200);
    expect((await employee.post('/api/auth/profile',{fullName:'New name',role:'ADMIN'})).status).toBe(400);
    expect((await employee.post('/api/auth/profile',{fullName:' New name '})).status).toBe(204);
    expect((await employee.request('/api/auth/me')).body.user.fullName).toBe('New name');
    expect((await pool.query('SELECT role FROM memberships WHERE user_id=$1',[employeeId])).rows[0].role).toBe('EMPLOYEE');
  });
  it('RBAC-07 all read and mutation paths reject foreign tenants and resource IDs', async () => {
    const foreign=await createUser('foreign@example.test',orgB,'EMPLOYEE');
    const admin=await actor();
    expect((await admin.request(`/api/organizations/${orgB}/users`)).status).toBe(403);
    expect((await admin.request(`/api/organizations/${orgB}/audit-events`)).status).toBe(403);
    expect((await admin.request(`${users()}/${foreign}`)).status).toBe(404);
    for(const [action,body] of [['status',{isActive:false}],['role',{role:'ADMIN'}],['manager',{managerUserId:null}]] as const){
      expect((await admin.post(`/api/organizations/${orgB}/users/${foreign}/${action}`,body)).status).toBe(403);
      expect((await admin.post(`${users()}/${foreign}/${action}`,body)).status).toBe(404);
    }
    expect((await pool.query('SELECT role,is_active FROM memberships WHERE user_id=$1',[foreign])).rows[0]).toMatchObject({role:'EMPLOYEE',is_active:true});
  });
  it('RBAC-08 lock revokes sessions, denies login, unlock does not revive old sessions', async () => {
    const admin=await actor(),employee=await actor('employee@example.test');
    expect((await admin.post(`${users()}/${employeeId}/status`,{isActive:false})).status).toBe(204);
    expect((await employee.request('/api/auth/me')).status).toBe(401);
    await expect((await new Client().initialize()).login('employee@example.test')).resolves.toMatchObject({status:401});
    expect((await admin.request(users()+'?status=locked')).body.items[0].id).toBe(employeeId);
    expect((await admin.post(`${users()}/${employeeId}/status`,{isActive:true})).status).toBe(204);
    expect((await employee.request('/api/auth/me')).status).toBe(401);
    expect((await (await new Client().initialize()).login('employee@example.test')).status).toBe(200);
  });
  it('RBAC-09 role promotion and revocation invalidate old sessions immediately', async () => {
    const admin=await actor(),employee=await actor('employee@example.test');
    expect((await admin.post(`${users()}/${employeeId}/role`,{role:'HR'})).status).toBe(204);
    expect((await employee.request('/api/auth/me')).status).toBe(401);
    const hr=await actor('employee@example.test');expect((await hr.request('/api/auth/me')).body.organization.role).toBe('HR');
    expect((await admin.post(`${users()}/${employeeId}/role`,{role:'EMPLOYEE'})).status).toBe(204);
    expect((await hr.request(users())).status).toBe(401);
    const again=await actor('employee@example.test');expect((await again.request(users())).status).toBe(403);
  });
  it('RBAC-10 a tenant lock leaves other tenant memberships and sessions intact', async () => {
    const admin=await actor();
    await pool.query("INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'EMPLOYEE')",[randomUUID(),employeeId,orgB]);
    const raw=token();await pool.query("INSERT INTO user_sessions(id,user_id,organization_id,session_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[randomUUID(),employeeId,orgB,digest(raw)]);
    const other=new Client();other.cookies.set('managerhr','managerhr='+raw);
    expect((await admin.post(`${users()}/${employeeId}/status`,{isActive:false})).status).toBe(204);
    expect((await other.request('/api/auth/me')).body.organization.id).toBe(orgB);
  });
  it('RBAC-11 self changes cannot remove the only Admin or self-promote', async () => {
    const admin=await actor();
    expect((await admin.post(`${users()}/${adminId}/role`,{role:'EMPLOYEE'})).status).toBe(403);
    expect((await admin.post(`${users()}/${adminId}/status`,{isActive:false})).status).toBe(403);
    expect((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE role='ADMIN' AND is_active")).rows[0].n).toBe(1);
  });
  it('RBAC-12 concurrent Admin cross-demotions leave exactly one active Admin', async () => {
    const secondId=await createUser('secondadmin@example.test',orgA,'ADMIN');
    const first=await actor(),second=await actor('secondadmin@example.test');
    const result=await Promise.all([first.post(`${users()}/${secondId}/role`,{role:'EMPLOYEE'}),second.post(`${users()}/${adminId}/role`,{role:'EMPLOYEE'})]);
    expect(result.filter(r=>r.status===204)).toHaveLength(1);
    expect(result.filter(r=>[401,403].includes(r.status))).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE organization_id=$1 AND role='ADMIN' AND is_active",[orgA])).rows[0].n).toBe(1);
  });
  it('RBAC-13 cached actor permissions cannot bypass session or role recheck', async () => {
    const hr=await actor('hr@example.test');const me=(await hr.request('/api/auth/me')).body;
    const session=(await pool.query('SELECT id FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL',[hrId])).rows[0];
    await pool.query("UPDATE memberships SET role='EMPLOYEE' WHERE user_id=$1",[hrId]);
    const db=await pool.connect();try{await db.query('BEGIN');await expect(authorizeMutation(db,{userId:hrId,email:me.user.email,fullName:me.user.fullName,orgId:orgA,orgName:'A',role:'HR',sessionId:session.id},[hrId],['ADMIN','HR'])).rejects.toMatchObject({status:403});await db.query('ROLLBACK');}finally{db.release();}
    await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1',[session.id]);
    expect((await hr.post(`${users()}/${employeeId}/status`,{isActive:false})).status).toBe(401);
  });
  it('RBAC-14 manager assignment is validated within tenant and changing manager role removes scope', async () => {
    const managerId=await createUser('manager@example.test',orgA,'MANAGER');const foreign=await createUser('foreignmanager@example.test',orgB,'MANAGER');const admin=await actor();
    expect((await admin.post(`${users()}/${employeeId}/manager`,{managerUserId:foreign})).status).toBe(400);
    expect((await admin.post(`${users()}/${employeeId}/manager`,{managerUserId:hrId})).status).toBe(400);
    expect((await admin.post(`${users()}/${employeeId}/manager`,{managerUserId:employeeId})).status).toBe(400);
    expect((await admin.post(`${users()}/${employeeId}/manager`,{managerUserId:managerId})).status).toBe(204);
    const manager=await actor('manager@example.test');expect((await manager.request(`${users()}/${employeeId}`)).status).toBe(200);
    expect((await admin.post(`${users()}/${managerId}/role`,{role:'EMPLOYEE'})).status).toBe(204);
    expect((await manager.request(users())).status).toBe(401);
    expect((await pool.query('SELECT manager_user_id FROM memberships WHERE user_id=$1',[employeeId])).rows[0].manager_user_id).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM auth_audit_events WHERE event_type='USER_MANAGER_CHANGED' AND subject_user_id=$1",[employeeId])).rows[0].n).toBe(2);
  });
  it('RBAC-15 audit records changes and denials without exposing secrets or other tenants', async () => {
    const admin=await actor();await admin.post(`${users()}/${employeeId}/status`,{isActive:false});
    await pool.query("INSERT INTO auth_audit_events(id,organization_id,event_type) VALUES($1,$2,'FOREIGN_EVENT')",[randomUUID(),orgB]);
    const hr=await actor('hr@example.test');await hr.post(`${users()}/${employeeId}/role`,{role:'ADMIN'});
    const result=await admin.request(`/api/organizations/${orgA}/audit-events`);expect(result.status).toBe(200);
    expect(result.body.items.map((i:{eventType:string})=>i.eventType)).toContain('ADMIN_ACTION_DENIED');
    expect(result.body.items.map((i:{eventType:string})=>i.eventType)).not.toContain('FOREIGN_EVENT');
    const status=result.body.items.find((i:{eventType:string})=>i.eventType==='USER_STATUS_CHANGED');
    expect(status).toMatchObject({actorUserId:adminId,subjectUserId:employeeId,metadata:{outcome:'SUCCESS',before:{isActive:true},after:{isActive:false}}});
    expect(JSON.stringify(result.body)).not.toContain(password);expect(JSON.stringify(result.body)).not.toContain('password_hash');
  });
  it('RBAC-16 fresh login queued behind a lock cannot authenticate stale membership', async () => {
    const admin=await actor();const block=await pool.connect();await block.query('BEGIN');await block.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[employeeId]);
    let lockResult:ReturnType<Client['post']>|undefined, loginResult:ReturnType<Client['login']>|undefined;
    try{lockResult=admin.post(`${users()}/${employeeId}/status`,{isActive:false});await eventually(async()=>Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id = ANY%'")).rows[0].n)>0);const client=await new Client().initialize();loginResult=client.login('employee@example.test');await block.query('COMMIT');expect((await lockResult).status).toBe(204);expect((await loginResult).status).toBe(401);}finally{await block.query('ROLLBACK');block.release();await Promise.allSettled([lockResult,loginResult].filter(Boolean));}
  },15000);
});


describe('AUTH-003 advanced sessions and runtime MFA policy',()=>{
 let secureBase:string;
 const mfaKey=Buffer.alloc(32,7).toString('base64');
 beforeAll(async()=>{secureBase=await start({config:{...config,requireMfa:true,mfaKey}});});
 const secureActor=(email='admin@example.test')=>actor(email,secureBase);
 const currentCode=(secret:string)=>totp(secret,Math.floor(Date.now()/30000));
 async function enroll(client:Client){const begin=await client.post('/api/auth/mfa/enroll',{password});expect(begin.status).toBe(200);const usedCode=currentCode(begin.body.secret);const done=await client.post('/api/auth/mfa/confirm',{code:usedCode});expect(done.status).toBe(200);return {secret:begin.body.secret,codes:done.body.recoveryCodes as string[],usedCode};}
 it('binds passkey challenges to a browser and consumes them once', async () => {
   const first = await new Client(secureBase).initialize();
   const second = await new Client(secureBase).initialize();
   const options = await first.post('/api/auth/passkeys/login/options');
   expect(options.status).toBe(200);
   expect(options.body).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
   const assertion = { challenge: options.body.challenge, response: { id: 'YQ' } };
   expect((await second.post('/api/auth/passkeys/login/verify', assertion)).body.code).toBe('PASSKEY_CHALLENGE_EXPIRED');
   expect((await first.post('/api/auth/passkeys/login/verify', assertion)).body.code).toBe('INVALID_PASSKEY');
   expect((await first.post('/api/auth/passkeys/login/verify', assertion)).body.code).toBe('PASSKEY_CHALLENGE_EXPIRED');
   expect((await first.request('/api/auth/me')).status).toBe(401);
 });
 it('only issues registration options to a verified and recent Admin or HR session', async () => {
   const admin = await secureActor();
   const optionsPath = '/api/auth/passkeys/register/options';
   expect((await admin.post(optionsPath)).body.code).toBe('MFA_REQUIRED');
   await enroll(admin);
   const options = await admin.post(optionsPath);
   expect(options.status).toBe(200);
   expect(options.body.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
   await pool.query("UPDATE user_sessions SET reauthenticated_at=now()-interval '11 minutes' WHERE user_id=$1", [adminId]);
   expect((await admin.post(optionsPath)).body.code).toBe('REAUTH_REQUIRED');
   const employee = await secureActor('employee@example.test');
   expect((await employee.post(optionsPath)).body.code).toBe('FORBIDDEN');
 });
 it('HARD-01 idle and absolute expiry reject otherwise valid sessions',async()=>{
   const client=await secureActor('employee@example.test');
   await pool.query("UPDATE user_sessions SET last_seen_at=now()-interval '31 minutes' WHERE user_id=$1",[employeeId]);expect((await client.request('/api/auth/me')).status).toBe(401);
   const again=await secureActor('employee@example.test');await pool.query("UPDATE user_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[employeeId]);expect((await again.request('/api/auth/me')).status).toBe(401);
 });
 it('HARD-02 own session list and individual/other revocation cannot target other accounts',async()=>{
   const first=await secureActor('employee@example.test'),second=await secureActor('employee@example.test');
   const list=await first.request('/api/auth/sessions');expect(list.status).toBe(200);expect(list.body.items).toHaveLength(2);expect(JSON.stringify(list.body)).not.toContain('session_hash');
   const foreign=await actor();const foreignId=(await pool.query('SELECT id FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL',[adminId])).rows[0].id;
   expect((await first.post(`/api/auth/sessions/${foreignId}/revoke`)).status).toBe(404);expect((await foreign.request('/api/auth/me')).status).toBe(200);
   const secondId=list.body.items.find((s:{current:boolean})=>!s.current).id;expect((await first.post(`/api/auth/sessions/${secondId}/revoke`)).status).toBe(204);expect((await second.request('/api/auth/me')).status).toBe(401);
   const third=await secureActor('employee@example.test');expect((await first.post('/api/auth/sessions/revoke-others')).status).toBe(204);expect((await third.request('/api/auth/me')).status).toBe(401);expect((await first.request('/api/auth/me')).status).toBe(200);
 });
 it('HARD-03 Admin and HR cannot bypass mandatory MFA through direct API calls',async()=>{
   for(const email of ['admin@example.test','hr@example.test']){const client=await secureActor(email);const me=await client.request('/api/auth/me');expect(me.body.security).toMatchObject({mfaRequired:true,mfaVerified:false});expect(me.body.permissions.invite).toBe(false);expect((await client.request(`/api/organizations/${orgA}/users`)).status).toBe(403);expect((await client.post(`/api/organizations/${orgA}/invitations`,{email:'x@example.test',role:'EMPLOYEE'})).status).toBe(403);expect((await client.request('/api/auth/sessions')).status).toBe(403);}
 });
 it('HARD-04 TOTP enrollment encrypts secret, rotates ID and displays hash-only recovery codes once',async()=>{
   const client=await secureActor(),oldCookie=client.cookies.get('managerhr');const enrolled=await enroll(client);expect(enrolled.codes).toHaveLength(10);expect(client.cookies.get('managerhr')).not.toBe(oldCookie);
   expect((await client.request(`/api/organizations/${orgA}/users`)).status).toBe(200);const factor=(await pool.query('SELECT * FROM user_mfa WHERE user_id=$1',[adminId])).rows[0];expect(factor.encrypted_secret).not.toContain(enrolled.secret);expect(factor.pending_secret).toBeNull();expect(factor.recovery_hashes).toEqual(enrolled.codes.map(digest));
   const old=new Client(secureBase);old.cookies.set('managerhr',oldCookie!);expect((await old.request('/api/auth/me')).status).toBe(401);const status=await client.request('/api/auth/mfa/status');expect(status.body).not.toHaveProperty('secret');expect(status.body).not.toHaveProperty('recoveryCodes');
 });
 it('HARD-05 OTP replay across logins is rejected, recovery code consumed exactly once',async()=>{
   const first=await secureActor(),enrolled=await enroll(first);const second=await secureActor();expect((await second.post('/api/auth/mfa/verify',{code:enrolled.usedCode})).status).toBe(401);const old=second.cookies.get('managerhr');expect((await second.post('/api/auth/mfa/verify',{code:enrolled.codes[0]})).status).toBe(204);expect(second.cookies.get('managerhr')).not.toBe(old);const third=await secureActor();expect((await third.post('/api/auth/mfa/verify',{code:enrolled.codes[0]})).status).toBe(401);expect((await third.request(`/api/organizations/${orgA}/users`)).status).toBe(403);
 });
 it('HARD-06 concurrent recovery-code verify has exactly one winner',async()=>{
   const first=await secureActor(),enrolled=await enroll(first),second=await secureActor(),third=await secureActor();const results=await Promise.all([second.post('/api/auth/mfa/verify',{code:enrolled.codes[0]}),third.post('/api/auth/mfa/verify',{code:enrolled.codes[0]})]);expect(results.map(r=>r.status).sort()).toEqual([204,401]);
 });
 it('HARD-07 controlled recovery cannot remove mandatory MFA or preserve old sessions',async()=>{
   const client=await secureActor(),enrolled=await enroll(client);expect((await client.post('/api/auth/mfa/disable',{password,code:enrolled.codes[0]})).status).toBe(403);const old=client.cookies.get('managerhr');expect((await client.post('/api/auth/mfa/recover',{password,code:enrolled.codes[0]})).status).toBe(204);expect((await client.request(`/api/organizations/${orgA}/users`)).status).toBe(403);const previous=new Client(secureBase);previous.cookies.set('managerhr',old!);expect((await previous.request('/api/auth/me')).status).toBe(401);expect((await client.post('/api/auth/mfa/recover',{password,code:enrolled.codes[0]})).status).toBe(403);
 });
 it('HARD-08 enrolled employee must verify MFA and can disable only with password/factor',async()=>{
   const client=await secureActor('employee@example.test'),enrolled=await enroll(client),second=await secureActor('employee@example.test');expect((await second.post('/api/auth/profile',{fullName:'No bypass'})).status).toBe(403);expect((await client.post('/api/auth/mfa/disable',{password:'incorrect',code:enrolled.codes[0]})).status).toBe(401);expect((await client.post('/api/auth/mfa/disable',{password,code:enrolled.codes[0]})).status).toBe(204);expect((await second.request('/api/auth/me')).status).toBe(401);expect((await client.post('/api/auth/profile',{fullName:'Allowed name'})).status).toBe(204);
 });
 it('HARD-09 sensitive writes require recent reauth, rotation preserves absolute expiry',async()=>{
   const client=await secureActor(),enrolled=await enroll(client);const before=(await pool.query('SELECT expires_at FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL',[adminId])).rows[0].expires_at;await pool.query("UPDATE user_sessions SET reauthenticated_at=now()-interval '11 minutes' WHERE user_id=$1",[adminId]);expect((await client.post(`/api/organizations/${orgA}/users/${employeeId}/status`,{isActive:false})).status).toBe(403);expect((await client.post('/api/auth/reauthenticate',{password,code:enrolled.codes[0]})).status).toBe(204);const after=(await pool.query('SELECT expires_at FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL',[adminId])).rows[0].expires_at;expect(after.toISOString()).toBe(before.toISOString());expect((await client.post(`/api/organizations/${orgA}/users/${employeeId}/status`,{isActive:false})).status).toBe(204);
 });
 it('HARD-10 MFA rate limits ignore forged IP headers, no permanent account lock',async()=>{
   const client=await secureActor();await pool.query('TRUNCATE auth_rate_limits');for(let i=0;i<10;i++)expect((await client.request('/api/auth/mfa/verify','POST',{code:'000000'},{'X-Forwarded-For':`203.0.113.${i}`})).status).toBe(403);expect((await client.post('/api/auth/mfa/verify',{code:'000000'})).status).toBe(429);expect((await pool.query('SELECT is_active FROM users WHERE id=$1',[adminId])).rows[0].is_active).toBe(true);await pool.query("UPDATE auth_rate_limits SET window_start=now()-interval '16 minutes'");expect((await client.post('/api/auth/mfa/enroll',{password})).status).toBe(200);
 });
 it('HARD-11 MFA success does not permit cross-tenant access; audit excludes secrets',async()=>{
   const client=await secureActor(),enrolled=await enroll(client);expect((await client.request(`/api/organizations/${orgB}/users`)).status).toBe(403);const failed=await new Client(secureBase).initialize();await failed.login('unknown@example.test','incorrect');const events=(await pool.query('SELECT event_type,metadata FROM auth_audit_events')).rows;expect(events.map(e=>e.event_type)).toContain('LOGIN_FAILED');expect(events.map(e=>e.event_type)).toContain('MFA_ENABLED');const text=JSON.stringify(events);for(const secret of [password,enrolled.secret,...enrolled.codes,client.cookies.get('managerhr')!.split('=')[1]])expect(text).not.toContain(secret);
 });
 it('HARD-12 password reset revokes MFA sessions but does not clear factor',async()=>{
   const client=await secureActor(),enrolled=await enroll(client);void enrolled;const resetToken=await reset(adminId);const anonymous=await new Client(secureBase).initialize();expect((await anonymous.post('/api/auth/reset-password',{token:resetToken.raw,newPassword})).status).toBe(204);expect((await client.request('/api/auth/me')).status).toBe(401);const again=await new Client(secureBase).initialize();expect((await again.login('admin@example.test',newPassword)).status).toBe(200);expect((await again.request(`/api/organizations/${orgA}/users`)).status).toBe(403);expect((await again.request('/api/auth/mfa/status')).body.enabled).toBe(true);
 });
 it('HARD-13 encryption binds ciphertext to identity and OTP matches RFC6238 vector',()=>{
   const key=Buffer.alloc(32,9).toString('base64'),secret=newTotpSecret(),sealed=seal(secret,'user-a',key);expect(unseal(sealed,'user-a',key)).toBe(secret);expect(()=>unseal(sealed,'user-b',key)).toThrow();expect(()=>unseal(sealed,'user-a',Buffer.alloc(32,8).toString('base64'))).toThrow();expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1,8)).toBe('94287082');expect(verifyTotp(secret,totp(secret,10),10,300000)).toBeNull();expect(verifyTotp(secret,totp(secret,10),-1,300000)).toBe(10);
 });
 it('HARD-14 completed MFA challenge cannot bypass password-plus-factor reauthentication',async()=>{
   const client=await secureActor(),enrolled=await enroll(client);
   await pool.query("UPDATE user_sessions SET reauthenticated_at=now()-interval '11 minutes' WHERE user_id=$1",[adminId]);
   expect((await client.post('/api/auth/mfa/verify',{code:enrolled.codes[0]})).status).toBe(409);
   expect((await client.post(`/api/organizations/${orgA}/users/${employeeId}/status`,{isActive:false})).status).toBe(403);
   expect((await client.post('/api/auth/reauthenticate',{password,code:enrolled.codes[0]})).status).toBe(204);
   expect((await client.post(`/api/organizations/${orgA}/users/${employeeId}/status`,{isActive:false})).status).toBe(204);
 });
 it('HARD-15 enrollment requires password, expires, and cannot accept future OTP',async()=>{
   const client=await secureActor();expect((await client.post('/api/auth/mfa/enroll',{password:'wrong'})).status).toBe(401);
   const begin=await client.post('/api/auth/mfa/enroll',{password});expect(begin.status).toBe(200);
   expect((await client.post('/api/auth/mfa/confirm',{code:totp(begin.body.secret,Math.floor(Date.now()/30000)+2)})).status).toBe(401);
   await pool.query("UPDATE user_mfa SET pending_expires_at=now()-interval '1 second' WHERE user_id=$1",[adminId]);
   expect((await client.post('/api/auth/mfa/confirm',{code:currentCode(begin.body.secret)})).status).toBe(410);
   expect((await client.request(`/api/organizations/${orgA}/users`)).status).toBe(403);
 });
 it('HARD-16 privileged role promotion cannot reuse a prior non-MFA session',async()=>{
   const admin=await secureActor();await enroll(admin);const employee=await secureActor('employee@example.test');
   expect((await admin.post(`/api/organizations/${orgA}/users/${employeeId}/role`,{role:'HR'})).status).toBe(204);
   expect((await employee.request('/api/auth/me')).status).toBe(401);
   const promoted=await secureActor('employee@example.test');expect((await promoted.request(`/api/organizations/${orgA}/users`)).status).toBe(403);
   expect((await promoted.request('/api/auth/me')).body.security.mfaRequired).toBe(true);
 });

 it('HARD-17 next-step TOTP completes login and preserves the invitation/reset workflow under runtime policy',async()=>{
   const admin=await secureActor(),enrolled=await enroll(admin),next=await secureActor();
   const future=Date.now()+30000;const clock=vi.spyOn(Date,'now').mockReturnValue(future);
   try{expect((await next.post('/api/auth/mfa/verify',{code:totp(enrolled.secret,Math.floor(future/30000))})).status).toBe(204);}finally{clock.mockRestore();}
   expect((await next.post(`/api/organizations/${orgA}/invitations`,{email:'runtime-new@example.test',role:'EMPLOYEE'})).status).toBe(202);
   const link=deliveries.find(item=>item.to==='runtime-new@example.test')!.link;const raw=new URL(link).searchParams.get('token')!;
   const anonymous=await new Client(secureBase).initialize();expect((await anonymous.post('/api/auth/invitations/accept',acceptBody(raw))).status).toBe(204);
   const employee=await secureActor('runtime-new@example.test');expect((await employee.request('/api/auth/me')).body.security.mfaRequired).toBe(false);
   expect((await anonymous.post('/api/auth/forgot-password',{email:'runtime-new@example.test'})).status).toBe(202);
   expect((await anonymous.post('/api/auth/forgot-password',{email:'missing-runtime@example.test'})).status).toBe(202);
 });

 it('HARD-18 recovery-code regeneration requires both proofs and invalidates the old set',async()=>{
   const client=await secureActor(),enrolled=await enroll(client);const oldCookie=client.cookies.get('managerhr');
   expect((await client.post('/api/auth/mfa/recovery-codes',{password:'wrong',code:enrolled.codes[0]})).status).toBe(401);
   const fresh=await client.post('/api/auth/mfa/recovery-codes',{password,code:enrolled.codes[0]});expect(fresh.status).toBe(200);expect(fresh.body.recoveryCodes).toHaveLength(10);expect(client.cookies.get('managerhr')).not.toBe(oldCookie);
   const next=await secureActor();expect((await next.post('/api/auth/mfa/verify',{code:enrolled.codes[1]})).status).toBe(401);expect((await next.post('/api/auth/mfa/verify',{code:fresh.body.recoveryCodes[0]})).status).toBe(204);
 });

});
