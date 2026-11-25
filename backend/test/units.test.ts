import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';

if (process.env.MIGRATION_TEST_BACKEND !== 'true' || !process.env.DATABASE_URL)
  throw Error('Disposable PostgreSQL required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const origin = 'http://localhost:3000',
  password = 'Organization test password 7!';
let server: Server,
  base: string,
  hash: string,
  first: string,
  second: string,
  admin: string,
  worker: string;
class Client {
  cookies = new Map<string, string>();
  csrf = '';
  async call(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        'x-csrf-token': this.csrf,
        cookie: [...this.cookies].map(([k, v]) => k + '=' + v).join('; '),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'),
        index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  async login(email: string) {
    this.csrf = (await this.call('/api/auth/csrf')).body.csrfToken;
    expect((await this.call('/api/auth/login', 'POST', { email, password })).status).toBe(200);
    return this;
  }
}
beforeAll(async () => {
  hash = await hashPassword(password);
  server = createApp({
    pool,
    config: {
      origin,
      production: false,
      requireMfa: false,
      csrfSecret: 'units-tests-secret-'.repeat(4),
    },
    rateLimit: 1000,
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No server');
  base = 'http://127.0.0.1:' + address.port;
});
beforeEach(async () => {
  await pool.query('TRUNCATE organizations,users CASCADE');
  first = randomUUID();
  second = randomUUID();
  admin = randomUUID();
  worker = randomUUID();
  await pool.query(
    "INSERT INTO organizations(id,name) VALUES($1,'First company'),($2,'Hidden company')",
    [first, second],
  );
  await pool.query(
    "INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,'admin@units.test','Admin',$3,now()),($2,'worker@units.test','Worker',$3,now())",
    [admin, worker, hash],
  );
  await pool.query(
    "INSERT INTO memberships(id,user_id,organization_id,role) VALUES(gen_random_uuid(),$1,$3,'ADMIN'),(gen_random_uuid(),$2,$3,'EMPLOYEE')",
    [admin, worker, first],
  );
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
const input = {
  name: 'New company',
  code: 'NEW',
  description: 'Independent organization',
  adminEmail: 'worker@units.test',
};

it('requires the separate system authority to provision organizations without granting it to company Admins', async () => {
  const client = await new Client().login('admin@units.test');
  const listed = await client.call('/api/units');
  expect(listed.body.canCreate).toBe(false);
  expect(listed.body.items.map((u: { id: string }) => u.id)).toEqual([first]);
  expect((await client.call('/api/units', 'POST', input)).status).toBe(403);
  expect(
    (
      await client.call('/api/units/' + second, 'PATCH', {
        name: 'Intrusion',
        code: null,
        description: null,
      })
    ).status,
  ).toBe(404);
  expect((await client.call('/api/units/' + second + '/select', 'POST', {})).status).toBe(404);
  expect(
    (
      await client.call('/api/units/' + first, 'PATCH', {
        name: 'Renamed',
        code: 'FIRST',
        description: null,
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await client.call('/api/units/' + first, 'PATCH', {
        name: 'Renamed',
        code: null,
        description: null,
        isActive: false,
      })
    ).status,
  ).toBe(403);
  expect((await pool.query('SELECT count(*)::int AS n FROM system_administrators')).rows[0].n).toBe(
    0,
  );
});

it('lets the system administrator create with a nominated Admin, edit, archive and restore without implicit membership', async () => {
  await pool.query('INSERT INTO system_administrators(user_id) VALUES($1)', [admin]);
  const client = await new Client().login('admin@units.test');
  expect((await client.call('/api/units')).body.items).toHaveLength(2);
  expect((await client.call('/api/units', 'POST', { ...input, role: 'ADMIN' })).status).toBe(400);
  expect(
    (await client.call('/api/units', 'POST', { ...input, adminEmail: 'missing@units.test' })).body
      .code,
  ).toBe('UNIT_ADMIN_UNAVAILABLE');
  const created = await client.call('/api/units', 'POST', input);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id;
  expect(
    (await pool.query('SELECT user_id,role FROM memberships WHERE organization_id=$1', [id])).rows,
  ).toEqual([{ user_id: worker, role: 'ADMIN' }]);
  expect((await client.call('/api/units/' + id + '/select', 'POST', {})).status).toBe(404);
  expect((await client.call('/api/units', 'POST', input)).status).toBe(409);
  expect(
    (
      await client.call('/api/units/' + id, 'PATCH', {
        name: 'Updated',
        code: 'UPDATED',
        description: 'Changed',
      })
    ).status,
  ).toBe(204);
  const nominee = await new Client().login('worker@units.test');
  expect((await nominee.call('/api/units/' + id + '/select', 'POST', {})).status).toBe(204);
  expect((await client.call('/api/units/' + first, 'DELETE', {})).body.code).toBe('UNIT_CURRENT');
  expect((await client.call('/api/units/' + id, 'DELETE', {})).status).toBe(204);
  expect((await nominee.call('/api/auth/me')).status).toBe(401);
  expect(
    (
      await client.call('/api/units/' + id, 'PATCH', {
        name: 'Restored',
        code: 'UPDATED',
        description: null,
        isActive: true,
      })
    ).status,
  ).toBe(204);
  expect(
    (await pool.query('SELECT is_active FROM organizations WHERE id=$1', [id])).rows[0].is_active,
  ).toBe(true);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM auth_audit_events WHERE organization_id=$1 AND event_type='ORGANIZATION_PROVISIONED'",
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
});

it('rotates sessions during selection, preserves expiry and derives the target role on the server', async () => {
  await pool.query(
    "INSERT INTO memberships(id,user_id,organization_id,role) VALUES(gen_random_uuid(),$1,$2,'EMPLOYEE')",
    [admin, second],
  );
  const client = await new Client().login('admin@units.test');
  const before = (
    await pool.query(
      'SELECT id,expires_at FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL',
      [admin],
    )
  ).rows[0];
  const oldCookie = client.cookies.get('managerhr');
  expect(
    (await client.call('/api/units/' + second + '/select', 'POST', { role: 'ADMIN' })).status,
  ).toBe(400);
  expect((await client.call('/api/units/' + second + '/select', 'POST', {})).status).toBe(204);
  expect(client.cookies.get('managerhr')).not.toBe(oldCookie);
  expect((await client.call('/api/auth/me')).body.organization).toMatchObject({
    id: second,
    role: 'EMPLOYEE',
  });
  const after = (
    await pool.query(
      'SELECT id,expires_at FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL',
      [admin],
    )
  ).rows[0];
  expect(after.expires_at).toEqual(before.expires_at);
  expect(
    (await pool.query('SELECT revoked_at FROM user_sessions WHERE id=$1', [before.id])).rows[0]
      .revoked_at,
  ).not.toBeNull();
  expect((await client.call('/api/organizations/' + first + '/employees')).status).toBe(403);
  expect((await client.call('/api/units', 'POST', input)).status).toBe(403);
});

it('requires MFA after switching from an employee session into an Admin membership', async () => {
  await pool.query(
    "INSERT INTO memberships(id,user_id,organization_id,role) VALUES(gen_random_uuid(),$1,$2,'ADMIN')",
    [worker, second],
  );
  const secured = createApp({
    pool,
    config: {
      origin,
      production: false,
      requireMfa: true,
      mfaKey: randomBytes(32).toString('base64'),
      csrfSecret: 'secure-units-test-'.repeat(4),
    },
    rateLimit: 1000,
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => secured.once('listening', resolve));
  const address = secured.address();
  if (!address || typeof address === 'string') throw Error('No server');
  const previous = base;
  base = 'http://127.0.0.1:' + address.port;
  try {
    const client = await new Client().login('worker@units.test');
    expect((await client.call('/api/units/' + second + '/select', 'POST', {})).status).toBe(204);
    const me = await client.call('/api/auth/me');
    expect(me.body.security).toMatchObject({ mfaRequired: true, mfaVerified: false });
    expect(me.body.permissions.manageOrg).toBe(false);
    expect((await client.call('/api/units')).body.code).toBe('MFA_REQUIRED');
    expect((await client.call('/api/organizations/' + second + '/employees')).body.code).toBe(
      'MFA_REQUIRED',
    );
  } finally {
    base = previous;
    secured.closeAllConnections();
    await new Promise<void>((resolve) => secured.close(() => resolve()));
  }
});
