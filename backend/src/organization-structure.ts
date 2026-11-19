import type { Express } from 'express';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail, type Authed, type Identity } from './types.js';
import { authorizeMutation } from './authorization.js';
import { managementScope } from './management-scope.js';

const uuid = z.string().uuid();
const codeRegex = /^[A-Za-z0-9_.-]+$/;

export interface OrgStructureDeps {
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

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, char => `\\${char}`);
}

export async function detectDepartmentCycle(
  db: PoolClient,
  orgId: string,
  departmentId: string,
  targetParentId: string,
): Promise<boolean> {
  if (departmentId === targetParentId) return true;
  let current: string | null = targetParentId;
  const visited = new Set<string>([departmentId]);
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    const queryResult: QueryResult<{ parent_id: string | null }> = await db.query(
      'SELECT parent_id FROM departments WHERE organization_id = $1 AND id = $2',
      [orgId, current],
    );
    if (!queryResult.rowCount) break;
    current = queryResult.rows[0].parent_id;
  }
  return false;
}

export async function detectReportingCycle(
  db: PoolClient,
  orgId: string,
  userId: string,
  targetManagerId: string,
): Promise<boolean> {
  if (userId === targetManagerId) return true;
  let current: string | null = targetManagerId;
  const visited = new Set<string>([userId]);
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    const queryResult: QueryResult<{ manager_user_id: string | null }> = await db.query(
      'SELECT manager_user_id FROM memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, current],
    );
    if (!queryResult.rowCount) break;
    current = queryResult.rows[0].manager_user_id;
  }
  return false;
}

export function registerOrgStructureRoutes(app: Express, deps: OrgStructureDeps) {
  const { pool, transaction, audit, requireIdentity } = deps;
  const orgPrefix = '/api/organizations/:organizationId';

  function requireOrgIdentity(req: Authed): Identity {
    const identity = requireIdentity(req);
    if (!uuid.safeParse(req.params.organizationId).success) fail(400, 'INVALID_INPUT');
    if (identity.orgId !== req.params.organizationId) fail(403, 'FORBIDDEN');
    return identity;
  }

  // =========================================================================
  // 1. Organization Details & Hierarchy (ORG-001.1)
  // =========================================================================
  app.get(orgPrefix, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const result = await pool.query<{
      id: string;
      name: string;
      code: string | null;
      description: string | null;
      parent_organization_id: string | null;
      is_active: boolean;
      created_at: Date;
    }>(
      `SELECT id, name, code, description, parent_organization_id, is_active, created_at
       FROM organizations WHERE id = $1`,
      [identity.orgId],
    );
    const org = result.rows[0];
    if (!org) fail(404, 'ORGANIZATION_NOT_FOUND');


    res.json({
      organization: {
        id: org.id,
        name: org.name,
        code: org.code,
        description: org.description,
        parentOrganizationId: null,
        parentOrganization: null,
        isActive: org.is_active,
        createdAt: org.created_at.toISOString(),
      },
    });
  });

  app.patch(orgPrefix, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (identity.role !== 'ADMIN') fail(403, 'FORBIDDEN');

    const schema = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        code: z.string().trim().min(1).max(30).regex(codeRegex, 'INVALID_CODE').optional().nullable(),
        description: z.string().trim().max(500).optional().nullable(),
        parentOrganizationId: uuid.optional().nullable(),
      })
      .strict();
    const data = schema.parse(req.body);

    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN']);

      const currentOrg = (
        await db.query<{ id: string; name: string; code: string | null; parent_organization_id: string | null }>(
          'SELECT id, name, code, parent_organization_id FROM organizations WHERE id = $1 FOR UPDATE',
          [identity.orgId],
        )
      ).rows[0];
      if (!currentOrg) fail(404, 'ORGANIZATION_NOT_FOUND');

      if (data.parentOrganizationId !== undefined && data.parentOrganizationId !== null) {
        if (data.parentOrganizationId === identity.orgId) fail(400, 'INVALID_PARENT');
        // organizations are tenant boundaries, not units within a tenant.
        fail(400, 'INVALID_PARENT');
      }

      if (data.code !== undefined && data.code !== null) {
        const normCode = data.code.toUpperCase();
        const codeCheck = await db.query(
          'SELECT id FROM organizations WHERE lower(btrim(code)) = lower($1) AND id <> $2',
          [normCode, identity.orgId],
        );
        if (codeCheck.rowCount) fail(409, 'ORGANIZATION_CODE_EXISTS');
      }

      const updated = await db.query(
        `UPDATE organizations
         SET name = COALESCE($1, name),
             code = CASE WHEN $2::boolean THEN $3 ELSE code END,
             description = CASE WHEN $4::boolean THEN $5 ELSE description END,
             parent_organization_id = CASE WHEN $6::boolean THEN $7 ELSE parent_organization_id END
         WHERE id = $8 RETURNING id, name, code, description, parent_organization_id`,
        [
          data.name ?? null,
          data.code !== undefined,
          data.code ? data.code.toUpperCase() : null,
          data.description !== undefined,
          data.description ?? null,
          data.parentOrganizationId !== undefined,
          data.parentOrganizationId ?? null,
          identity.orgId,
        ],
      );

      await audit(db, 'ORGANIZATION_UPDATED', identity.userId, identity.orgId, undefined, {
        before: currentOrg,
        after: updated.rows[0],
      });
    });

    res.status(204).end();
  });

  // =========================================================================
  // 2. Department Management (ORG-001.2)
  // =========================================================================
  app.get(`${orgPrefix}/departments`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const querySchema = z
      .object({
        q: z.string().trim().max(100).optional(),
        parentId: z.string().optional(),
        isActive: z.enum(['true', 'false', 'all']).default('all').optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict();
    const { q, parentId, isActive, page, limit } = querySchema.parse(req.query);

    const conditions = ['d.organization_id = $1'];
    const params: unknown[] = [identity.orgId];
    const scope = await managementScope(pool, identity);
    if(scope){params.push(scope.departments);conditions.push(`d.id=ANY($${params.length}::uuid[])`);}

    if (isActive === 'true') conditions.push('d.is_active = true');
    else if (isActive === 'false') conditions.push('d.is_active = false');

    if (parentId !== undefined) {
      if (parentId === 'root') {
        conditions.push('d.parent_id IS NULL');
      } else if (uuid.safeParse(parentId).success) {
        params.push(parentId);
        conditions.push(`d.parent_id = $${params.length}`);
      }
    }

    if (q) {
      params.push(`%${escapeLike(q)}%`);
      conditions.push(`(d.name ILIKE $${params.length} ESCAPE '\\' OR d.code ILIKE $${params.length} ESCAPE '\\')`);
    }

    const whereClause = conditions.join(' AND ');
    const countRes = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM departments d WHERE ${whereClause}`,
      params,
    );
    const total = countRes.rows[0].total;

    const listParams = [...params, limit, (page - 1) * limit];
    const rows = await pool.query<{
      id: string;
      organization_id: string;
      parent_id: string | null;
      parent_name: string | null;
      code: string;
      name: string;
      description: string | null;
      manager_user_id: string | null;
      manager_name: string | null;
      manager_email: string | null;
      is_active: boolean;
      member_count: number;
      child_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT d.id, d.organization_id, d.parent_id, p.name AS parent_name, d.code, d.name, d.description,
              d.manager_user_id, u.full_name AS manager_name, u.email AS manager_email, d.is_active,
              d.created_at, d.updated_at,
              COALESCE(m_count.total, 0)::int AS member_count,
              COALESCE(c_count.total, 0)::int AS child_count
       FROM departments d
       LEFT JOIN departments p ON p.id = d.parent_id
       LEFT JOIN users u ON u.id = d.manager_user_id AND u.is_active AND u.email_verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM memberships dm WHERE dm.organization_id=d.organization_id AND dm.user_id=u.id AND dm.is_active)
       LEFT JOIN (
         SELECT department_id, count(*)::int AS total
         FROM memberships
         WHERE organization_id = $1 AND is_active = true AND department_id IS NOT NULL
         GROUP BY department_id
       ) m_count ON m_count.department_id = d.id
       LEFT JOIN (
         SELECT parent_id, count(*)::int AS total
         FROM departments
         WHERE organization_id = $1 AND parent_id IS NOT NULL
         GROUP BY parent_id
       ) c_count ON c_count.parent_id = d.id
       WHERE ${whereClause}
       ORDER BY d.code ASC, d.created_at ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    res.json({
      items: rows.rows.map(r => ({
        id: r.id,
        organizationId: r.organization_id,
        parentId: scope && !scope.departments.includes(r.parent_id || '') ? null : r.parent_id,
        parentName: scope && !scope.departments.includes(r.parent_id || '') ? null : r.parent_name,
        code: r.code,
        name: r.name,
        description: r.description,
        managerUserId: r.manager_user_id,
        managerName: r.manager_name,
        managerEmail: r.manager_email,
        isActive: r.is_active,
        memberCount: r.member_count,
        childCount: r.child_count,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
      page,
      limit,
      total,
    });
  });

  app.get(`${orgPrefix}/departments/:departmentId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const deptId = z.string().uuid().parse(req.params.departmentId);
    const scope = await managementScope(pool,identity);
    if(scope && !scope.departments.includes(deptId)) fail(404,'DEPARTMENT_NOT_FOUND');

    const result = await pool.query<{
      id: string;
      organization_id: string;
      parent_id: string | null;
      parent_name: string | null;
      code: string;
      name: string;
      description: string | null;
      manager_user_id: string | null;
      manager_name: string | null;
      manager_email: string | null;
      is_active: boolean;
      member_count: number;
      child_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT d.id, d.organization_id, d.parent_id, p.name AS parent_name, d.code, d.name, d.description,
              d.manager_user_id, u.full_name AS manager_name, u.email AS manager_email, d.is_active,
              d.created_at, d.updated_at,
              COALESCE(m_count.total, 0)::int AS member_count,
              COALESCE(c_count.total, 0)::int AS child_count
       FROM departments d
       LEFT JOIN departments p ON p.id = d.parent_id
       LEFT JOIN users u ON u.id = d.manager_user_id AND u.is_active AND u.email_verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM memberships dm WHERE dm.organization_id=d.organization_id AND dm.user_id=u.id AND dm.is_active)
       LEFT JOIN (
         SELECT department_id, count(*)::int AS total
         FROM memberships
         WHERE organization_id = $1 AND is_active = true AND department_id = $2
         GROUP BY department_id
       ) m_count ON m_count.department_id = d.id
       LEFT JOIN (
         SELECT parent_id, count(*)::int AS total
         FROM departments
         WHERE organization_id = $1 AND parent_id = $2
         GROUP BY parent_id
       ) c_count ON c_count.parent_id = d.id
       WHERE d.organization_id = $1 AND d.id = $2`,
      [identity.orgId, deptId],
    );
    const row = result.rows[0];
    if (!row) fail(404, 'DEPARTMENT_NOT_FOUND');

    res.json({
      department: {
        id: row.id,
        organizationId: row.organization_id,
        parentId: scope && !scope.departments.includes(row.parent_id || '') ? null : row.parent_id,
        parentName: scope && !scope.departments.includes(row.parent_id || '') ? null : row.parent_name,
        code: row.code,
        name: row.name,
        description: row.description,
        managerUserId: row.manager_user_id,
        managerName: row.manager_name,
        managerEmail: row.manager_email,
        isActive: row.is_active,
        memberCount: row.member_count,
        childCount: row.child_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
    });
  });

  app.post(`${orgPrefix}/departments`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');

    const schema = z
      .object({
        code: z.string().trim().min(1).max(30).regex(codeRegex, 'INVALID_CODE'),
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(500).optional().nullable(),
        parentId: uuid.optional().nullable(),
        managerUserId: uuid.optional().nullable(),
      })
      .strict();
    const data = schema.parse(req.body);
    const code = data.code.toUpperCase();

    const createdId = await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

      // Check unique code in org
      const existing = await db.query(
        'SELECT id FROM departments WHERE organization_id = $1 AND code = $2',
        [identity.orgId, code],
      );
      if (existing.rowCount) fail(409, 'DEPARTMENT_CODE_EXISTS');

      // Check parent belongs to same org
      if (data.parentId) {
        const pRes = await db.query(
          'SELECT id FROM departments WHERE organization_id = $1 AND id = $2 AND is_active = true',
          [identity.orgId, data.parentId],
        );
        if (!pRes.rowCount) fail(400, 'INVALID_PARENT');
      }

      // Check manager belongs to same org
      if (data.managerUserId) {
        const mRes = await db.query(
          'SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id AND u.is_active AND u.email_verified_at IS NOT NULL WHERE m.organization_id = $1 AND m.user_id = $2 AND m.is_active = true',
          [identity.orgId, data.managerUserId],
        );
        if (!mRes.rowCount) fail(400, 'INVALID_MANAGER');
      }

      const id = randomUUID();
      await db.query(
        `INSERT INTO departments(id, organization_id, parent_id, code, name, description, manager_user_id)
         VALUES($1, $2, $3, $4, $5, $6, $7)`,
        [id, identity.orgId, data.parentId ?? null, code, data.name, data.description ?? null, data.managerUserId ?? null],
      );

      await audit(db, 'DEPARTMENT_CREATED', identity.userId, identity.orgId, undefined, {
        departmentId: id,
        code,
        name: data.name,
        parentId: data.parentId ?? null,
      });

      return id;
    });

    res.status(201).json({ id: createdId });
  });

  app.patch(`${orgPrefix}/departments/:departmentId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
    const deptId = z.string().uuid().parse(req.params.departmentId);

    const schema = z
      .object({
        code: z.string().trim().min(1).max(30).regex(codeRegex, 'INVALID_CODE').optional(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(500).optional().nullable(),
        parentId: uuid.optional().nullable(),
        managerUserId: uuid.optional().nullable(),
        isActive: z.boolean().optional(),
      })
      .strict();
    const data = schema.parse(req.body);

    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

      const deptRes = await db.query<{
        id: string;
        code: string;
        name: string;
        parent_id: string | null;
        manager_user_id: string | null;
        is_active: boolean;
      }>(
        'SELECT id, code, name, parent_id, manager_user_id, is_active FROM departments WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [identity.orgId, deptId],
      );
      const dept = deptRes.rows[0];
      if (!dept) fail(404, 'DEPARTMENT_NOT_FOUND');
      if(data.isActive===false){
        const dependencies=await db.query(`SELECT 1 FROM departments WHERE organization_id=$1 AND parent_id=$2 AND is_active
          UNION ALL SELECT 1 FROM memberships WHERE organization_id=$1 AND department_id=$2 AND is_active
          UNION ALL SELECT 1 FROM positions WHERE organization_id=$1 AND department_id=$2 AND is_active LIMIT 1`,[identity.orgId,deptId]);
        if(dependencies.rowCount)fail(409,'DEPARTMENT_IN_USE');
      }

      let nextCode = dept.code;
      if (data.code !== undefined) {
        nextCode = data.code.toUpperCase();
        if (nextCode !== dept.code) {
          const dup = await db.query(
            'SELECT id FROM departments WHERE organization_id = $1 AND code = $2 AND id <> $3',
            [identity.orgId, nextCode, deptId],
          );
          if (dup.rowCount) fail(409, 'DEPARTMENT_CODE_EXISTS');
        }
      }

      let nextParentId = dept.parent_id;
      if (data.parentId !== undefined) {
        nextParentId = data.parentId;
        if (nextParentId !== null) {
          if (nextParentId === deptId) fail(400, 'INVALID_PARENT');
          const pCheck = await db.query(
            'SELECT id FROM departments WHERE organization_id = $1 AND id = $2 AND is_active = true',
            [identity.orgId, nextParentId],
          );
          if (!pCheck.rowCount) fail(400, 'INVALID_PARENT');

          const isCycle = await detectDepartmentCycle(db, identity.orgId, deptId, nextParentId);
          if (isCycle) fail(400, 'CIRCULAR_HIERARCHY');
        }
      }

      let nextManagerId = dept.manager_user_id;
      if (data.managerUserId !== undefined) {
        nextManagerId = data.managerUserId;
        if (nextManagerId !== null) {
          const mCheck = await db.query(
            'SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id AND u.is_active AND u.email_verified_at IS NOT NULL WHERE m.organization_id = $1 AND m.user_id = $2 AND m.is_active = true',
            [identity.orgId, nextManagerId],
          );
          if (!mCheck.rowCount) fail(400, 'INVALID_MANAGER');
        }
      }

      await db.query(
        `UPDATE departments
         SET code = $1,
             name = COALESCE($2, name),
             description = CASE WHEN $3::boolean THEN $4 ELSE description END,
             parent_id = CASE WHEN $5::boolean THEN $6 ELSE parent_id END,
             manager_user_id = CASE WHEN $7::boolean THEN $8 ELSE manager_user_id END,
             is_active = COALESCE($9, is_active),
             updated_at = now()
         WHERE id = $10`,
        [
          nextCode,
          data.name ?? null,
          data.description !== undefined,
          data.description ?? null,
          data.parentId !== undefined,
          nextParentId,
          data.managerUserId !== undefined,
          nextManagerId,
          data.isActive ?? null,
          deptId,
        ],
      );

      await audit(db, 'DEPARTMENT_UPDATED', identity.userId, identity.orgId, undefined, {
        departmentId: deptId,
        before: dept,
        after: { code: nextCode, name: data.name ?? dept.name, parentId: nextParentId, isActive: data.isActive ?? dept.is_active },
      });
    });

    res.status(204).end();
  });

  app.delete(`${orgPrefix}/departments/:departmentId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
    const deptId = z.string().uuid().parse(req.params.departmentId);

    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

      const deptRes = await db.query(
        'SELECT id, name, code FROM departments WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [identity.orgId, deptId],
      );
      if (!deptRes.rowCount) fail(404, 'DEPARTMENT_NOT_FOUND');

      // Rule: Do not hard delete departments currently in use
      const childCount = await db.query(
        'SELECT count(*)::int AS count FROM departments WHERE organization_id = $1 AND parent_id = $2',
        [identity.orgId, deptId],
      );
      if (childCount.rows[0].count > 0) {
        fail(409, 'DEPARTMENT_IN_USE_HAS_CHILDREN');
      }

      const memberCount = await db.query(
        'SELECT count(*)::int AS count FROM memberships WHERE organization_id = $1 AND department_id = $2',
        [identity.orgId, deptId],
      );
      if (memberCount.rows[0].count > 0) {
        fail(409, 'DEPARTMENT_IN_USE_HAS_MEMBERS');
      }

      const positionCount = await db.query(
        'SELECT count(*)::int AS count FROM positions WHERE organization_id = $1 AND department_id = $2',
        [identity.orgId, deptId],
      );
      if (positionCount.rows[0].count > 0) {
        fail(409, 'DEPARTMENT_IN_USE_HAS_POSITIONS');
      }

      await db.query('DELETE FROM departments WHERE id = $1', [deptId]);
      await audit(db, 'DEPARTMENT_DELETED', identity.userId, identity.orgId, undefined, { departmentId: deptId });
    });

    res.status(204).end();
  });

  // =========================================================================
  // 3. Position Management (ORG-001.3)
  // =========================================================================
  app.get(`${orgPrefix}/positions`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const querySchema = z
      .object({
        q: z.string().trim().max(100).optional(),
        departmentId: z.string().optional(),
        isActive: z.enum(['true', 'false', 'all']).default('all').optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict();
    const { q, departmentId, isActive, page, limit } = querySchema.parse(req.query);

    const conditions = ['p.organization_id = $1'];
    const params: unknown[] = [identity.orgId];
    const scope = await managementScope(pool,identity);
    if(scope){params.push(scope.departments);conditions.push(`p.department_id=ANY($${params.length}::uuid[]) AND p.is_active`);}

    if (isActive === 'true') conditions.push('p.is_active = true');
    else if (isActive === 'false') conditions.push('p.is_active = false');

    if (departmentId && uuid.safeParse(departmentId).success) {
      params.push(departmentId);
      conditions.push(`p.department_id = $${params.length}`);
    }

    if (q) {
      params.push(`%${escapeLike(q)}%`);
      conditions.push(`(p.title ILIKE $${params.length} ESCAPE '\\' OR p.code ILIKE $${params.length} ESCAPE '\\')`);
    }

    const whereClause = conditions.join(' AND ');
    const countRes = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM positions p WHERE ${whereClause}`,
      params,
    );
    const total = countRes.rows[0].total;

    const listParams = [...params, limit, (page - 1) * limit];
    const rows = await pool.query<{
      id: string;
      organization_id: string;
      department_id: string | null;
      department_name: string | null;
      code: string;
      title: string;
      description: string | null;
      is_active: boolean;
      member_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT p.id, p.organization_id, p.department_id, d.name AS department_name, p.code, p.title,
              p.description, p.is_active, p.created_at, p.updated_at,
              COALESCE(m_count.total, 0)::int AS member_count
       FROM positions p
       LEFT JOIN departments d ON d.id = p.department_id
       LEFT JOIN (
         SELECT position_id, count(*)::int AS total
         FROM memberships
         WHERE organization_id = $1 AND is_active = true AND position_id IS NOT NULL
         GROUP BY position_id
       ) m_count ON m_count.position_id = p.id
       WHERE ${whereClause}
       ORDER BY p.code ASC, p.created_at ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    res.json({
      items: rows.rows.map(r => ({
        id: r.id,
        organizationId: r.organization_id,
        departmentId: r.department_id,
        departmentName: r.department_name,
        code: r.code,
        title: r.title,
        description: r.description,
        isActive: r.is_active,
        memberCount: r.member_count,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
      page,
      limit,
      total,
    });
  });

  app.get(`${orgPrefix}/positions/:positionId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const posId = z.string().uuid().parse(req.params.positionId);
    const scope = await managementScope(pool,identity);
    if(scope){const check=await pool.query('SELECT id FROM positions WHERE organization_id=$1 AND id=$2 AND is_active AND department_id=ANY($3::uuid[])',[identity.orgId,posId,scope.departments]);if(!check.rowCount)fail(404,'POSITION_NOT_FOUND');}

    const result = await pool.query<{
      id: string;
      organization_id: string;
      department_id: string | null;
      department_name: string | null;
      code: string;
      title: string;
      description: string | null;
      is_active: boolean;
      member_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT p.id, p.organization_id, p.department_id, d.name AS department_name, p.code, p.title,
              p.description, p.is_active, p.created_at, p.updated_at,
              COALESCE(m_count.total, 0)::int AS member_count
       FROM positions p
       LEFT JOIN departments d ON d.id = p.department_id
       LEFT JOIN (
         SELECT position_id, count(*)::int AS total
         FROM memberships
         WHERE organization_id = $1 AND is_active = true AND position_id = $2
         GROUP BY position_id
       ) m_count ON m_count.position_id = p.id
       WHERE p.organization_id = $1 AND p.id = $2`,
      [identity.orgId, posId],
    );
    const row = result.rows[0];
    if (!row) fail(404, 'POSITION_NOT_FOUND');

    res.json({
      position: {
        id: row.id,
        organizationId: row.organization_id,
        departmentId: row.department_id,
        departmentName: row.department_name,
        code: row.code,
        title: row.title,
        description: row.description,
        isActive: row.is_active,
        memberCount: row.member_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
    });
  });

  app.post(`${orgPrefix}/positions`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');

    const schema = z
      .object({
        code: z.string().trim().min(1).max(30).regex(codeRegex, 'INVALID_CODE'),
        title: z.string().trim().min(1).max(100),
        description: z.string().trim().max(500).optional().nullable(),
        departmentId: uuid.optional().nullable(),
      })
      .strict();
    const data = schema.parse(req.body);
    const code = data.code.toUpperCase();

    const createdId = await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

      const existing = await db.query(
        'SELECT id FROM positions WHERE organization_id = $1 AND code = $2',
        [identity.orgId, code],
      );
      if (existing.rowCount) fail(409, 'POSITION_CODE_EXISTS');

      if (data.departmentId) {
        const dRes = await db.query(
          'SELECT id FROM departments WHERE organization_id = $1 AND id = $2 AND is_active = true',
          [identity.orgId, data.departmentId],
        );
        if (!dRes.rowCount) fail(400, 'INVALID_DEPARTMENT');
      }

      const id = randomUUID();
      await db.query(
        `INSERT INTO positions(id, organization_id, department_id, code, title, description)
         VALUES($1, $2, $3, $4, $5, $6)`,
        [id, identity.orgId, data.departmentId ?? null, code, data.title, data.description ?? null],
      );

      await audit(db, 'POSITION_CREATED', identity.userId, identity.orgId, undefined, {
        positionId: id,
        code,
        title: data.title,
        departmentId: data.departmentId ?? null,
      });

      return id;
    });

    res.status(201).json({ id: createdId });
  });

  app.patch(`${orgPrefix}/positions/:positionId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
    const posId = z.string().uuid().parse(req.params.positionId);

    const schema = z
      .object({
        code: z.string().trim().min(1).max(30).regex(codeRegex, 'INVALID_CODE').optional(),
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(500).optional().nullable(),
        departmentId: uuid.optional().nullable(),
        isActive: z.boolean().optional(),
      })
      .strict();
    const data = schema.parse(req.body);

    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

      const posRes = await db.query<{
        id: string;
        code: string;
        title: string;
        department_id: string | null;
        is_active: boolean;
      }>(
        'SELECT id, code, title, department_id, is_active FROM positions WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [identity.orgId, posId],
      );
      const pos = posRes.rows[0];
      if (!pos) fail(404, 'POSITION_NOT_FOUND');

      let nextCode = pos.code;
      if (data.code !== undefined) {
        nextCode = data.code.toUpperCase();
        if (nextCode !== pos.code) {
          const dup = await db.query(
            'SELECT id FROM positions WHERE organization_id = $1 AND code = $2 AND id <> $3',
            [identity.orgId, nextCode, posId],
          );
          if (dup.rowCount) fail(409, 'POSITION_CODE_EXISTS');
        }
      }

      let nextDeptId = pos.department_id;
      if (data.departmentId !== undefined) {
        nextDeptId = data.departmentId;
        if (nextDeptId !== null) {
          const dCheck = await db.query(
            'SELECT id FROM departments WHERE organization_id = $1 AND id = $2 AND is_active = true',
            [identity.orgId, nextDeptId],
          );
          if (!dCheck.rowCount) fail(400, 'INVALID_DEPARTMENT');
        }
      }

      if(data.departmentId!==undefined && nextDeptId!==null){
        const assigned=await db.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND position_id=$2 AND department_id IS DISTINCT FROM $3::uuid LIMIT 1',[identity.orgId,posId,nextDeptId]);
        if(assigned.rowCount)fail(409,'POSITION_IN_USE');
      }
      await db.query(
        `UPDATE positions
         SET code = $1,
             title = COALESCE($2, title),
             description = CASE WHEN $3::boolean THEN $4 ELSE description END,
             department_id = CASE WHEN $5::boolean THEN $6 ELSE department_id END,
             is_active = COALESCE($7, is_active),
             updated_at = now()
         WHERE id = $8`,
        [
          nextCode,
          data.title ?? null,
          data.description !== undefined,
          data.description ?? null,
          data.departmentId !== undefined,
          nextDeptId,
          data.isActive ?? null,
          posId,
        ],
      );

      await audit(db, 'POSITION_UPDATED', identity.userId, identity.orgId, undefined, {
        positionId: posId,
        before: pos,
        after: { code: nextCode, title: data.title ?? pos.title, departmentId: nextDeptId, isActive: data.isActive ?? pos.is_active },
      });
    });

    res.status(204).end();
  });

  app.delete(`${orgPrefix}/positions/:positionId`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
    const posId = z.string().uuid().parse(req.params.positionId);

    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], ['ADMIN', 'HR']);

      const posRes = await db.query(
        'SELECT id, title, code FROM positions WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [identity.orgId, posId],
      );
      if (!posRes.rowCount) fail(404, 'POSITION_NOT_FOUND');

      const memberCount = await db.query(
        'SELECT count(*)::int AS count FROM memberships WHERE organization_id = $1 AND position_id = $2',
        [identity.orgId, posId],
      );
      if (memberCount.rows[0].count > 0) {
        fail(409, 'POSITION_IN_USE_HAS_MEMBERS');
      }

      await db.query('DELETE FROM positions WHERE id = $1', [posId]);
      await audit(db, 'POSITION_DELETED', identity.userId, identity.orgId, undefined, { positionId: posId });
    });

    res.status(204).end();
  });

  // =========================================================================
  // 4. Member Assignment: Department & Position (ORG-001.3 & ORG-001.4)
  // =========================================================================
  app.post(`${orgPrefix}/users/:userId/assignment`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    if (!['ADMIN', 'HR'].includes(identity.role)) fail(403, 'FORBIDDEN');
    const targetUserId = z.string().uuid().parse(req.params.userId);

    const schema = z
      .object({
        departmentId: uuid.nullable(),
        positionId: uuid.nullable(),
      })
      .strict();
    const data = schema.parse(req.body);

    await transaction(async db => {
      const lockIds = [identity.userId, targetUserId];
      await authorizeMutation(db, identity, lockIds, ['ADMIN', 'HR']);

      const targetMember = await db.query<{ id: string; role: string; department_id: string | null; position_id: string | null }>(
        'SELECT id, role, department_id, position_id FROM memberships WHERE organization_id = $1 AND user_id = $2 FOR UPDATE',
        [identity.orgId, targetUserId],
      );
      const target = targetMember.rows[0];
      if (!target) fail(404, 'USER_NOT_FOUND');

      if (identity.role === 'HR' && target.role !== 'EMPLOYEE') {
        fail(403, 'FORBIDDEN');
      }

      if (data.departmentId !== null) {
        const dCheck = await db.query(
          'SELECT id FROM departments WHERE organization_id = $1 AND id = $2 AND is_active = true',
          [identity.orgId, data.departmentId],
        );
        if (!dCheck.rowCount) fail(400, 'INVALID_DEPARTMENT');
      }

      if (data.positionId !== null) {
        const pCheck = await db.query(
          'SELECT id, department_id FROM positions WHERE organization_id = $1 AND id = $2 AND is_active = true',
          [identity.orgId, data.positionId],
        );
        if (!pCheck.rowCount) fail(400, 'INVALID_POSITION');
        const posDept = pCheck.rows[0].department_id;
        if (posDept && posDept !== data.departmentId) {
          fail(400, 'POSITION_DEPARTMENT_MISMATCH');
        }
      }

      await db.query(
        'UPDATE memberships SET department_id = $1, position_id = $2 WHERE id = $3',
        [data.departmentId, data.positionId, target.id],
      );

      await audit(db, 'USER_ASSIGNMENT_CHANGED', identity.userId, identity.orgId, targetUserId, {
        before: { departmentId: target.department_id, positionId: target.position_id },
        after: { departmentId: data.departmentId, positionId: data.positionId },
      });
    });

    res.status(204).end();
  });

  // =========================================================================
  // 5. Organization Chart API (ORG-001.5)
  // =========================================================================
  app.get(`${orgPrefix}/org-chart`, async (req: Authed, res) => {
    const identity = requireOrgIdentity(req);
    const scope = await managementScope(pool,identity);

    // Fetch organization info
    const orgRes = await pool.query<{ id: string; name: string; code: string | null; description: string | null }>(
      'SELECT id, name, code, description FROM organizations WHERE id = $1',
      [identity.orgId],
    );
    const organization = orgRes.rows[0];
    if (!organization) fail(404, 'ORGANIZATION_NOT_FOUND');

    // Fetch active departments
    const deptRows = await pool.query<{
      id: string;
      parent_id: string | null;
      code: string;
      name: string;
      description: string | null;
      manager_user_id: string | null;
      manager_name: string | null;
      manager_email: string | null;
      is_active: boolean;
      created_at: Date;
    }>(
      `SELECT d.id, d.parent_id, d.code, d.name, d.description, d.manager_user_id,
              u.full_name AS manager_name, u.email AS manager_email, d.is_active, d.created_at
       FROM departments d
       LEFT JOIN users u ON u.id = d.manager_user_id AND u.is_active AND u.email_verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM memberships dm WHERE dm.organization_id=d.organization_id AND dm.user_id=u.id AND dm.is_active)
       WHERE d.organization_id = $1 AND d.is_active = true AND ($2::uuid[] IS NULL OR d.id=ANY($2))
       ORDER BY d.code ASC`,
      [identity.orgId,scope?.departments??null],
    );

    // Fetch active positions
    const posRows = await pool.query<{
      id: string;
      department_id: string | null;
      code: string;
      title: string;
    }>(
      `SELECT id, department_id, code, title
       FROM positions
       WHERE organization_id = $1 AND is_active = true AND ($2::uuid[] IS NULL OR department_id=ANY($2))
       ORDER BY code ASC`,
      [identity.orgId,scope?.departments??null],
    );

    // Fetch members with position and department
    const memberRows = await pool.query<{
      user_id: string;
      full_name: string;
      email: string;
      role: string;
      manager_user_id: string | null;
      manager_name: string | null;
      department_id: string | null;
      position_id: string | null;
      position_title: string | null;
    }>(
      `SELECT m.user_id, u.full_name, u.email, m.role, m.manager_user_id, mgr.full_name AS manager_name,
              m.department_id, m.position_id, pos.title AS position_title
       FROM memberships m
       JOIN users u ON u.id = m.user_id AND u.is_active = true AND u.email_verified_at IS NOT NULL
       LEFT JOIN users mgr ON mgr.id = m.manager_user_id
       LEFT JOIN positions pos ON pos.id = m.position_id
       WHERE m.organization_id = $1 AND m.is_active = true
         AND ($2::uuid[] IS NULL OR m.user_id=ANY($2))
         AND ($3::text <> 'HR' OR m.role='EMPLOYEE' OR m.user_id=$4)
         AND ($3::text <> 'EMPLOYEE' OR m.user_id=$4)
       ORDER BY u.full_name ASC`,
      [identity.orgId,scope?.users??null,identity.role,identity.userId],
    );

    if(scope){
      deptRows.rows=deptRows.rows.filter(d=>scope.departments.includes(d.id));
      posRows.rows=posRows.rows.filter(p=>p.department_id && scope.departments.includes(p.department_id));
      memberRows.rows=memberRows.rows.filter(m=>scope.users.includes(m.user_id));
      for(const d of deptRows.rows)if(d.parent_id&&!scope.departments.includes(d.parent_id))d.parent_id=null;
    }
    if(identity.role==='EMPLOYEE')memberRows.rows=memberRows.rows.filter(m=>m.user_id===identity.userId);
    if(identity.role==='HR')memberRows.rows=memberRows.rows.filter(m=>m.role==='EMPLOYEE'||m.user_id===identity.userId);
    // Members outside visible active departments remain visible as unassigned.
    const visibleDepartments=new Set(deptRows.rows.map(d=>d.id));
    for(const m of memberRows.rows)if(m.department_id&&!visibleDepartments.has(m.department_id))m.department_id=null;
    const visibleUsers=new Set(memberRows.rows.map(m=>m.user_id));
    if(identity.role!=='ADMIN')for(const m of memberRows.rows)if(m.manager_user_id&&!visibleUsers.has(m.manager_user_id)){m.manager_user_id=null;m.manager_name=null;}
    // Map members by department
    const membersByDept = new Map<string, Array<{
      userId: string;
      fullName: string;
      email: string;
      role: string;
      positionId: string | null;
      positionTitle: string | null;
      managerUserId: string | null;
      managerName: string | null;
    }>>();

    const unassignedMembers: Array<{
      userId: string;
      fullName: string;
      email: string;
      role: string;
      positionId: string | null;
      positionTitle: string | null;
      managerUserId: string | null;
      managerName: string | null;
    }> = [];

    for (const m of memberRows.rows) {
      const item = {
        userId: m.user_id,
        fullName: m.full_name,
        email: m.email,
        role: m.role,
        positionId: m.position_id,
        positionTitle: m.position_title,
        managerUserId: m.manager_user_id,
        managerName: m.manager_name,
      };
      if (m.department_id) {
        if (!membersByDept.has(m.department_id)) membersByDept.set(m.department_id, []);
        membersByDept.get(m.department_id)!.push(item);
      } else {
        unassignedMembers.push(item);
      }
    }

    // Build department tree
    interface DeptNode {
      id: string;
      parentId: string | null;
      code: string;
      name: string;
      description: string | null;
      manager: { userId: string; fullName: string; email: string } | null;
      members: typeof unassignedMembers;
      memberCount: number;
      children: DeptNode[];
    }

    const deptMap = new Map<string, DeptNode>();
    for (const d of deptRows.rows) {
      const members = membersByDept.get(d.id) || [];
      deptMap.set(d.id, {
        id: d.id,
        parentId: d.parent_id,
        code: d.code,
        name: d.name,
        description: d.description,
        manager: d.manager_user_id && d.manager_name ? {
          userId: d.manager_user_id,
          fullName: d.manager_name,
          email: d.manager_email || '',
        } : null,
        members,
        memberCount: members.length,
        children: [],
      });
    }

    const tree: DeptNode[] = [];
    for (const node of deptMap.values()) {
      if (node.parentId && deptMap.has(node.parentId)) {
        deptMap.get(node.parentId)!.children.push(node);
      } else {
        tree.push(node);
      }
    }

    res.json({
      organization: {
        id: organization.id,
        name: organization.name,
        code: organization.code,
        description: organization.description,
      },
      departmentTree: tree,
      unassignedMembers,
      totalDepartments: deptRows.rows.length,
      totalPositions: posRows.rows.length,
      totalMembers: memberRows.rows.length,
    });
  });
}
