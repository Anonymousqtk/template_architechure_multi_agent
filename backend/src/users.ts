import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { fail, type Authed, type Identity, type Role } from './types.js';

import { authorizeMutation } from './authorization.js';
import { detectReportingCycle } from './organization-structure.js';
import { managementScope } from './management-scope.js';

const uuid = z.string().uuid();
const roleSchema = z.enum(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']);

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  userIsActive: boolean;
  emailVerified: boolean;
  managerUserId: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  departmentName?: string | null;
  positionTitle?: string | null;
  createdAt: string;
}

export interface UserRouteDeps {
  pool: Pool;
  transaction: <T>(fn: (db: PoolClient) => Promise<T>) => Promise<T>;
  audit: (
    db: Pool | PoolClient,
    event: string,
    actor?: string,
    org?: string,
    subject?: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  requireIdentity: (req: Authed) => Identity;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`);
}

function mapUserRow(row: {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  user_is_active: boolean;
  email_verified_at: Date | string | null;
  manager_user_id: string | null;
  department_id?: string | null;
  position_id?: string | null;
  department_name?: string | null;
  position_title?: string | null;
  created_at: Date | string;
}): UserDto {
  const dto: UserDto = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    userIsActive: row.user_is_active,
    emailVerified: row.email_verified_at !== null,
    managerUserId: row.manager_user_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
  if (row.department_id) {
    dto.departmentId = row.department_id;
    if (row.department_name) dto.departmentName = row.department_name;
  }
  if (row.position_id) {
    dto.positionId = row.position_id;
    if (row.position_title) dto.positionTitle = row.position_title;
  }
  return dto;
}

export function registerUserRoutes(app: Express, deps: UserRouteDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const orgPrefix = '/api/organizations/:organizationId';

  function requireOrgIdentity(req: Authed): Identity {
    const identity = requireIdentity(req);
    if (!uuid.safeParse(req.params.organizationId).success) fail(400, 'INVALID_INPUT');
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  function parseUserId(req: Authed): string {
    const parsed = uuid.safeParse(req.params.userId);
    if (!parsed.success) return fail(400, 'INVALID_INPUT');
    return parsed.data;
  }

  async function ensureAnotherActiveAdminExists(db: PoolClient, orgId: string, excludedUserId: string) {
    const remaining = await db.query(
      `SELECT m.id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
         AND m.role = 'ADMIN'
         AND m.is_active
         AND u.is_active
         AND u.email_verified_at IS NOT NULL
         AND m.user_id <> $2
       ORDER BY m.id`,
      [orgId, excludedUserId],
    );
    if (!remaining.rowCount) fail(409, 'LAST_ADMIN_REQUIRED');
  }

  app.post('/api/auth/profile', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const data = z.object({fullName:z.string().trim().min(1).max(120)}).strict().parse(req.body);
    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN','HR','MANAGER','EMPLOYEE']);
      const old = await db.query('SELECT full_name FROM users WHERE id=$1', [identity.userId]);
      await db.query('UPDATE users SET full_name=$1 WHERE id=$2', [data.fullName, identity.userId]);
      await audit(db, 'PROFILE_UPDATED', identity.userId, identity.orgId, identity.userId,
        {before:{fullName:old.rows[0].full_name},after:{fullName:data.fullName}});
    });
    res.status(204).end();
  });

  app.get(`${orgPrefix}/users`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR', 'MANAGER'].includes(identity.role)) fail(403, 'FORBIDDEN');

    const querySchema = z
      .object({
        q: z.string().trim().max(100).optional(),
        role: roleSchema.optional(),
        status: z.enum(['active','locked','inactive']).optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .strict();
    const { q, role, status, page, limit } = querySchema.parse(req.query);

    const conditions = ['m.organization_id = $1'];
    const params: unknown[] = [identity.orgId];

    if (identity.role === 'HR') {
      params.push(identity.userId);
      conditions.push(`(m.role = 'EMPLOYEE' OR m.user_id = $${params.length})`);
    } else if (identity.role === 'MANAGER') {
      const scope = await managementScope(pool, identity);
      params.push(scope!.users);
      conditions.push(`m.user_id = ANY($${params.length}::uuid[])`);
    }

    if (q) {
      params.push(`%${escapeLike(q)}%`);
      conditions.push(`(u.email ILIKE $${params.length} ESCAPE '\\' OR u.full_name ILIKE $${params.length} ESCAPE '\\')`);
    }

    if (role) { params.push(role); conditions.push(`m.role=$${params.length}`); }
    if(status==='active') conditions.push('m.is_active AND u.is_active');
    if(status==='locked') conditions.push('NOT m.is_active AND u.is_active');
    if(status==='inactive') conditions.push('NOT u.is_active');
    const whereClause = conditions.join(' AND ');
    const countResult = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].total;

    const listParams = [...params, limit, (page - 1) * limit];
    const rows = await pool.query(
      `SELECT u.id, u.email, u.full_name, m.role, m.is_active, u.is_active AS user_is_active,
              u.email_verified_at, m.manager_user_id, m.department_id, m.position_id,
              dept.name AS department_name, pos.title AS position_title, m.created_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN departments dept ON dept.id = m.department_id
       LEFT JOIN positions pos ON pos.id = m.position_id
       WHERE ${whereClause}
       ORDER BY m.created_at ASC, u.id ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    res.json({ items: rows.rows.map(mapUserRow), page, limit, total });
  });

  app.get(`${orgPrefix}/users/:userId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const targetUserId = parseUserId(req);

    if (identity.role === 'EMPLOYEE' && targetUserId !== identity.userId) fail(403, 'FORBIDDEN');
    if (!['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].includes(identity.role)) fail(403, 'FORBIDDEN');

    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, m.role, m.is_active, u.is_active AS user_is_active,
              u.email_verified_at, m.manager_user_id, m.department_id, m.position_id,
              dept.name AS department_name, pos.title AS position_title, m.created_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN departments dept ON dept.id = m.department_id
       LEFT JOIN positions pos ON pos.id = m.position_id
       WHERE m.organization_id = $1 AND m.user_id = $2`,
      [identity.orgId, targetUserId],
    );
    const row = result.rows[0];
    if (!row) fail(404, 'USER_NOT_FOUND');

    if (targetUserId !== identity.userId) {
      if (identity.role === 'HR' && row.role !== 'EMPLOYEE') fail(404, 'USER_NOT_FOUND');
      if (identity.role === 'MANAGER' && !(await managementScope(pool,identity))!.users.includes(targetUserId)) fail(404, 'USER_NOT_FOUND');
    }

    res.json({ user: mapUserRow(row) });
  });

  app.post(`${orgPrefix}/users/:userId/status`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const targetUserId = parseUserId(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
    if (targetUserId === identity.userId) fail(403, 'SELF_CHANGE_FORBIDDEN');

    const data = z.object({ isActive: z.boolean() }).strict().parse(req.body);

    await transaction(async db => {
      const actorRole = await authorizeMutation(db, identity, [identity.userId, targetUserId], ['ADMIN', 'HR']);

      const targetResult = await db.query<{ id: string; role: Role; is_active: boolean }>(
        'SELECT id, role, is_active FROM memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',
        [identity.orgId, targetUserId],
      );
      const target = targetResult.rows[0];
      if (!target) fail(404, 'USER_NOT_FOUND');

      if (actorRole === 'HR' && target.role !== 'EMPLOYEE') fail(403, 'FORBIDDEN');

      if (!data.isActive && target.role === 'ADMIN' && target.is_active) {
        await ensureAnotherActiveAdminExists(db, identity.orgId, targetUserId);
      }

      await db.query('UPDATE memberships SET is_active=$1 WHERE id=$2', [data.isActive, target.id]);
      await db.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND organization_id=$2 AND revoked_at IS NULL',
        [targetUserId, identity.orgId],
      );
      await audit(db, 'USER_STATUS_CHANGED', identity.userId, identity.orgId, targetUserId, {
        before: { isActive: target.is_active },
        after: { isActive: data.isActive },
      });
    });

    res.status(204).end();
  });

  app.post(`${orgPrefix}/users/:userId/role`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const targetUserId = parseUserId(req);
    if (identity.role !== 'ADMIN') fail(403, 'FORBIDDEN');
    if (targetUserId === identity.userId) fail(403, 'SELF_CHANGE_FORBIDDEN');

    const data = z.object({ role: roleSchema }).strict().parse(req.body);

    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId, targetUserId], ['ADMIN']);

      const targetResult = await db.query<{ id: string; role: Role; is_active: boolean; manager_user_id: string | null }>(
        'SELECT id, role, is_active, manager_user_id FROM memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',
        [identity.orgId, targetUserId],
      );
      const target = targetResult.rows[0];
      if (!target) fail(404, 'USER_NOT_FOUND');

      if (target.role === 'ADMIN' && data.role !== 'ADMIN' && target.is_active) {
        await ensureAnotherActiveAdminExists(db, identity.orgId, targetUserId);
      }

      const nextManagerUserId = ['EMPLOYEE', 'MANAGER'].includes(data.role) ? target.manager_user_id : null;
      await db.query('UPDATE memberships SET role=$1, manager_user_id=$2 WHERE id=$3', [
        data.role,
        nextManagerUserId,
        target.id,
      ]);

      if (target.role === 'MANAGER' && data.role !== 'MANAGER') {
        const cleared = await db.query(
          'UPDATE memberships SET manager_user_id=NULL WHERE organization_id=$1 AND manager_user_id=$2 RETURNING user_id',
          [identity.orgId, targetUserId],
        );
        for (const report of cleared.rows) await audit(db,'USER_MANAGER_CHANGED',identity.userId,identity.orgId,report.user_id,{before:{managerUserId:targetUserId},after:{managerUserId:null},reason:'MANAGER_ROLE_REVOKED'});
      }

      await db.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND organization_id=$2 AND revoked_at IS NULL',
        [targetUserId, identity.orgId],
      );
      await audit(db, 'USER_ROLE_CHANGED', identity.userId, identity.orgId, targetUserId, {
        before: { role: target.role, managerUserId: target.manager_user_id },
        after: { role: data.role, managerUserId: nextManagerUserId },
      });
    });

    res.status(204).end();
  });

  app.post(`${orgPrefix}/users/:userId/manager`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const targetUserId = parseUserId(req);
    if (identity.role !== 'ADMIN') fail(403, 'FORBIDDEN');
    if (targetUserId === identity.userId) fail(403, 'SELF_CHANGE_FORBIDDEN');

    const data = z.object({ managerUserId: uuid.nullable() }).strict().parse(req.body);
    if (data.managerUserId === targetUserId) fail(400, 'INVALID_MANAGER');

    await transaction(async db => {
      const lockIds = [identity.userId, targetUserId, ...(data.managerUserId ? [data.managerUserId] : [])];
      await authorizeMutation(db, identity, lockIds, ['ADMIN']);

      const targetResult = await db.query<{ id: string; role: Role; manager_user_id: string | null }>(
        'SELECT id, role, manager_user_id FROM memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',
        [identity.orgId, targetUserId],
      );
      const target = targetResult.rows[0];
      if (!target) fail(404, 'USER_NOT_FOUND');
      if (!['EMPLOYEE', 'MANAGER'].includes(target.role)) fail(400, 'INVALID_MANAGER');

      if (data.managerUserId !== null) {
        const isCycle = await detectReportingCycle(db, identity.orgId, targetUserId, data.managerUserId);
        if (isCycle) fail(400, 'CIRCULAR_REPORTING');

        const managerResult = await db.query<{
          role: Role;
          m_active: boolean;
          u_active: boolean;
          verified: Date | null;
        }>(
          `SELECT m.role, m.is_active AS m_active, u.is_active AS u_active, u.email_verified_at AS verified
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.organization_id = $1 AND m.user_id = $2
           FOR UPDATE OF m`,
          [identity.orgId, data.managerUserId],
        );
        const manager = managerResult.rows[0];
        if (!manager || manager.role !== 'MANAGER' || !manager.m_active || !manager.u_active || !manager.verified) {
          fail(400, 'INVALID_MANAGER');
        }
      }

      await db.query('UPDATE memberships SET manager_user_id=$1 WHERE id=$2', [data.managerUserId, target.id]);
      await audit(db, 'USER_MANAGER_CHANGED', identity.userId, identity.orgId, targetUserId, {
        before: { managerUserId: target.manager_user_id },
        after: { managerUserId: data.managerUserId },
      });
    });

    res.status(204).end();
  });

  app.get(`${orgPrefix}/audit-events`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (identity.role !== 'ADMIN') fail(403, 'FORBIDDEN');

    const querySchema = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .strict();
    const { page, limit } = querySchema.parse(req.query);

    const countResult = await pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM auth_audit_events WHERE organization_id=$1',
      [identity.orgId],
    );
    const total = countResult.rows[0].total;

    const rows = await pool.query(
      `SELECT id, event_type AS "eventType", actor_user_id AS "actorUserId",
              subject_user_id AS "subjectUserId", created_at AS "createdAt", metadata
       FROM auth_audit_events
       WHERE organization_id=$1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [identity.orgId, limit, (page - 1) * limit],
    );

    res.json({ items: rows.rows, page, limit, total });
  });
}
