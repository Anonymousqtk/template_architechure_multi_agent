import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from './security.js';

// Explicit CLI only. Never invoked at server startup; no credentials in CLI arguments/logs.
if (process.env.ALLOW_ADMIN_BOOTSTRAP !== 'I_HAVE_HUMAN_APPROVAL')
  throw new Error('Explicit human-approved bootstrap opt-in required');
if (!process.env.BOOTSTRAP_PASSWORD_FILE || !process.env.DATABASE_URL)
  throw new Error('DATABASE_URL and BOOTSTRAP_PASSWORD_FILE required');
const email = String(process.env.BOOTSTRAP_EMAIL || '')
  .trim()
  .toLowerCase();
const name = String(process.env.BOOTSTRAP_NAME || '').trim();
const orgName = String(process.env.BOOTSTRAP_ORGANIZATION || '').trim();
const password = (await readFile(process.env.BOOTSTRAP_PASSWORD_FILE, 'utf8')).replace(
  /\r?\n$/,
  '',
);
if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  email.length > 254 ||
  !name ||
  name.length > 120 ||
  !orgName ||
  orgName.length > 200 ||
  password.length < 12 ||
  password.length > 128
)
  throw new Error('Invalid bootstrap inputs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(713001)');
  const existing = await db.query('SELECT id FROM organizations LIMIT 1');
  if (existing.rowCount) throw new Error('Bootstrap refused: database already provisioned');
  const orgId = randomUUID(),
    userId = randomUUID();
  await db.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [orgId, orgName]);
  await db.query(
    'INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())',
    [userId, email, name, await hashPassword(password)],
  );
  await db.query(
    "INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'ADMIN')",
    [randomUUID(), userId, orgId],
  );
  await db.query(
    "INSERT INTO auth_audit_events(id,event_type,actor_user_id,organization_id,subject_user_id) VALUES($1,'ADMIN_BOOTSTRAP',$2,$3,$2)",
    [randomUUID(), userId, orgId],
  );
  await db.query('COMMIT');
  console.info('One-time Admin provisioning completed; audit event recorded.');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  db.release();
  await pool.end();
}
