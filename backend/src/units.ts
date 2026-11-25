import type { Express } from 'express';
import { z } from 'zod';
import { authorizeMutation } from './authorization.js';
import { digest, token } from './security.js';
import { fail, type Authed, type Identity } from './types.js';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.js';
import type { UserRouteDeps } from './users.js';

type Dependencies = UserRouteDeps & { config: Config };
const roles = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] as const;
const details = z.object({
  name: z.string().trim().min(1).max(100),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_.-]{1,30}$/)
    .nullable(),
  description: z.string().trim().max(500).nullable(),
});

async function systemAdmin(db: Pool | PoolClient, identity: Identity) {
  const enabled = Boolean(
    (await db.query('SELECT 1 FROM system_administrators WHERE user_id=$1', [identity.userId]))
      .rowCount,
  );
  if (enabled && identity.mfaEnforced !== false && !identity.mfaVerified) fail(403, 'MFA_REQUIRED');
  return enabled;
}

export function registerUnitRoutes(
  app: Express,
  { pool, transaction, audit, requireIdentity, config }: Dependencies,
) {
  async function unitTransaction<T>(handler: (db: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await transaction(handler);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505' &&
        'constraint' in error &&
        error.constraint === 'organizations_code_idx'
      )
        fail(409, 'DUPLICATE_CODE');
      throw error;
    }
  }
  app.get('/api/units', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const global = await systemAdmin(pool, identity);
    const result = await pool.query(
      `SELECT o.id,o.name,o.code,o.description,o.is_active AS "isActive",m.role,
      o.id=$2 AS current,COALESCE(m.is_active,false) AND o.is_active AS "canSelect",
      ($3 OR (m.is_active AND m.role='ADMIN')) AS "canEdit"
      FROM organizations o LEFT JOIN memberships m ON m.organization_id=o.id AND m.user_id=$1
      WHERE $3 OR (m.is_active AND o.is_active) ORDER BY o.name,o.id`,
      [identity.userId, identity.orgId, global],
    );
    res.json({ items: result.rows, canCreate: global, canArchive: global });
  });

  app.post('/api/units', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const input = details
      .extend({ adminEmail: z.email().trim().toLowerCase() })
      .strict()
      .parse(req.body);
    const id = await unitTransaction(async (db) => {
      await authorizeMutation(db, identity, [identity.userId], roles);
      if (!(await systemAdmin(db, identity))) fail(403, 'FORBIDDEN');
      const admin = (
        await db.query(
          'SELECT id FROM users WHERE email=$1 AND is_active AND email_verified_at IS NOT NULL',
          [input.adminEmail],
        )
      ).rows[0];
      if (!admin) fail(400, 'UNIT_ADMIN_UNAVAILABLE');
      if (
        input.code &&
        (
          await db.query('SELECT 1 FROM organizations WHERE lower(btrim(code))=lower($1)', [
            input.code,
          ])
        ).rowCount
      )
        fail(409, 'DUPLICATE_CODE');
      const created = (
        await db.query(
          'INSERT INTO organizations(id,name,code,description) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING id',
          [input.name, input.code, input.description],
        )
      ).rows[0];
      // Only an explicitly authorized system administrator provisions the nominated initial Admin.
      await db.query(
        "INSERT INTO memberships(id,user_id,organization_id,role) VALUES(gen_random_uuid(),$1,$2,'ADMIN')",
        [admin.id, created.id],
      );
      await audit(db, 'ORGANIZATION_PROVISIONED', identity.userId, created.id, admin.id);
      return created.id;
    });
    res.status(201).json({ id });
  });

  app.patch('/api/units/:id', async (req: Authed, res) => {
    const identity = requireIdentity(req),
      id = z.uuid().parse(req.params.id);
    const input = details.extend({ isActive: z.boolean().optional() }).strict().parse(req.body);
    await unitTransaction(async (db) => {
      await db.query(
        'SELECT id FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[identity.orgId, id]],
      );
      await authorizeMutation(db, identity, [identity.userId], roles);
      const global = await systemAdmin(db, identity);
      const membership = (
        await db.query(
          "SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2 AND is_active AND role='ADMIN' FOR UPDATE",
          [identity.userId, id],
        )
      ).rowCount;
      if (!global && !membership) fail(404, 'UNIT_NOT_FOUND');
      if (identity.mfaEnforced !== false && !identity.mfaVerified) fail(403, 'MFA_REQUIRED');
      if (input.isActive !== undefined && !global) fail(403, 'FORBIDDEN');
      if (input.isActive === false && id === identity.orgId) fail(409, 'UNIT_CURRENT');
      if (
        input.code &&
        (
          await db.query(
            'SELECT 1 FROM organizations WHERE lower(btrim(code))=lower($1) AND id<>$2',
            [input.code, id],
          )
        ).rowCount
      )
        fail(409, 'DUPLICATE_CODE');
      const changed = await db.query(
        'UPDATE organizations SET name=$2,code=$3,description=$4,is_active=COALESCE($5,is_active) WHERE id=$1',
        [id, input.name, input.code, input.description, input.isActive ?? null],
      );
      if (!changed.rowCount) fail(404, 'UNIT_NOT_FOUND');
      if (input.isActive === false)
        await db.query(
          'UPDATE user_sessions SET revoked_at=now() WHERE organization_id=$1 AND revoked_at IS NULL',
          [id],
        );
      await audit(db, 'ORGANIZATION_UPDATED', identity.userId, id);
    });
    res.status(204).end();
  });

  app.delete('/api/units/:id', async (req: Authed, res) => {
    const identity = requireIdentity(req),
      id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.body);
    await transaction(async (db) => {
      await db.query(
        'SELECT id FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[identity.orgId, id]],
      );
      await authorizeMutation(db, identity, [identity.userId], roles);
      if (!(await systemAdmin(db, identity))) fail(403, 'FORBIDDEN');
      if (id === identity.orgId) fail(409, 'UNIT_CURRENT');
      if (
        !(
          await db.query('UPDATE organizations SET is_active=false WHERE id=$1 AND is_active', [id])
        ).rowCount
      )
        fail(404, 'UNIT_NOT_FOUND');
      await db.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE organization_id=$1 AND revoked_at IS NULL',
        [id],
      );
      await audit(db, 'ORGANIZATION_ARCHIVED', identity.userId, id);
    });
    res.status(204).end();
  });

  app.post('/api/units/:id/select', async (req: Authed, res) => {
    const identity = requireIdentity(req),
      id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.body);
    const result = await transaction(async (db) => {
      // Use one order when taking locks across two tenant boundaries.
      await db.query(
        'SELECT id FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[identity.orgId, id]],
      );
      await authorizeMutation(db, identity, [identity.userId], roles, { requireRecent: false });
      const target = (
        await db.query(
          `SELECT m.role FROM memberships m JOIN organizations o ON o.id=m.organization_id
        WHERE m.user_id=$1 AND m.organization_id=$2 AND m.is_active AND o.is_active FOR UPDATE OF m`,
          [identity.userId, id],
        )
      ).rows[0];
      if (!target || !roles.includes(target.role)) fail(404, 'UNIT_NOT_FOUND');
      const session = (
        await db.query(
          'SELECT expires_at,reauthenticated_at,mfa_verified_at,device_label FROM user_sessions WHERE id=$1',
          [identity.sessionId],
        )
      ).rows[0];
      const factor = (
        await db.query('SELECT enabled_at FROM user_mfa WHERE user_id=$1', [identity.userId])
      ).rows[0];
      const needsMfa =
        config.requireMfa !== false &&
        (['ADMIN', 'HR'].includes(target.role) || Boolean(factor?.enabled_at));
      const limited = needsMfa && !session.mfa_verified_at;
      const raw = token();
      await db.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1', [identity.sessionId]);
      const created = await db.query(
        `INSERT INTO user_sessions
        (id,user_id,organization_id,session_hash,expires_at,reauthenticated_at,mfa_verified_at,device_label)
        VALUES(gen_random_uuid(),$1,$2,$3,LEAST($4::timestamptz,CASE WHEN $5 THEN now()+interval '5 minutes' ELSE $4::timestamptz END),$6,$7,$8)
        RETURNING expires_at`,
        [
          identity.userId,
          id,
          digest(raw),
          session.expires_at,
          limited,
          session.reauthenticated_at,
          session.mfa_verified_at,
          session.device_label,
        ],
      );
      await audit(db, 'ORGANIZATION_SELECTED', identity.userId, id, identity.userId);
      return { raw, expiry: created.rows[0].expires_at };
    });
    res.cookie(config.production ? '__Host-managerhr' : 'managerhr', result.raw, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.max(0, new Date(result.expiry).getTime() - Date.now()),
    });
    res.status(204).end();
  });
}
