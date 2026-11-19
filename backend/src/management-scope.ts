import type { Pool } from 'pg';
import type { Identity } from './types.js';
import { fail } from './types.js';

/** Active branches assigned to a Manager, plus active reporting descendants.
 * UNION deduplicates nodes, so corrupt pre-existing cycles cannot recurse forever.
 * Job titles never participate in authorization. Null means tenant-wide visibility.
 */
export async function managementScope(db: Pick<Pool, 'query'>, identity: Identity): Promise<{departments:string[];users:string[]}|null> {
  if(['ADMIN','HR','EMPLOYEE'].includes(identity.role)) return null;
  if(identity.role !== 'MANAGER') fail(403,'FORBIDDEN');
  const departments = await db.query<{id:string}>(`WITH RECURSIVE scope(id) AS (
    SELECT id FROM departments WHERE organization_id=$1 AND is_active AND manager_user_id=$2
    UNION
    SELECT d.id FROM departments d JOIN scope s ON d.parent_id=s.id
    WHERE d.organization_id=$1 AND d.is_active
  ) SELECT id FROM scope`,[identity.orgId,identity.userId]);
  const ids=departments.rows.map(row=>row.id);
  const users=await db.query<{id:string}>(`WITH RECURSIVE reports(id) AS (
    SELECT user_id FROM memberships WHERE organization_id=$1 AND user_id=$2 AND is_active
    UNION
    SELECT m.user_id FROM memberships m JOIN reports r ON m.manager_user_id=r.id
    JOIN users u ON u.id=m.user_id AND u.is_active AND u.email_verified_at IS NOT NULL
    WHERE m.organization_id=$1 AND m.is_active AND m.role IN ('MANAGER','EMPLOYEE')
  ) SELECT id FROM reports UNION
    SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=$1 AND m.department_id=ANY($3::uuid[]) AND m.is_active
      AND m.role IN ('MANAGER','EMPLOYEE') AND u.is_active AND u.email_verified_at IS NOT NULL`,
  [identity.orgId,identity.userId,ids]);
  return {departments:ids,users:users.rows.map(row=>row.id)};
}
