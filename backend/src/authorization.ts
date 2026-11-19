import type { PoolClient } from 'pg';
import { fail, type Identity, type Role } from './types.js';

export function permissionsFor(role: string) {
 return {invite:['ADMIN','HR'].includes(role),grantHR:role==='ADMIN',readUsers:['ADMIN','HR','MANAGER'].includes(role),manageUsers:['ADMIN','HR'].includes(role),assignRoles:role==='ADMIN',viewAudit:role==='ADMIN',manageOrg:['ADMIN','HR'].includes(role)};
}

export async function authorizeMutation(
    db: PoolClient,
    identity: Identity,
    userIdsToLock: string[],
    allowedRoles: readonly Role[],
  ): Promise<Role> {
    const org = await db.query('SELECT id FROM organizations WHERE id=$1 AND is_active FOR UPDATE', [identity.orgId]);
    if (!org.rowCount) fail(401, 'AUTHENTICATION_REQUIRED');

    const sortedUsers = [...new Set(userIdsToLock)].sort();
    await db.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [sortedUsers]);

    const session = await db.query(
      "SELECT id,mfa_verified_at,reauthenticated_at FROM user_sessions WHERE id=$1 AND user_id=$2 AND organization_id=$3 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-($4*interval '1 minute') FOR UPDATE",
      [identity.sessionId, identity.userId, identity.orgId,identity.idleMinutes||30],
    );
    if (!session.rowCount) fail(401, 'AUTHENTICATION_REQUIRED');

    const actor = await db.query<{ role: Role; m_active: boolean; u_active: boolean; verified: Date | null }>(
      `SELECT m.role, m.is_active AS m_active, u.is_active AS u_active, u.email_verified_at AS verified
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.organization_id = $2
       WHERE u.id = $1
       FOR UPDATE OF m`,
      [identity.userId, identity.orgId],
    );
    const actorRow = actor.rows[0];
    if (!actorRow || !actorRow.u_active || !actorRow.verified || !actorRow.m_active) {
      fail(401, 'AUTHENTICATION_REQUIRED');
    }
    if (!allowedRoles.includes(actorRow.role)) fail(403, 'FORBIDDEN');
    if(identity.mfaEnforced!==false){
      const factor=await db.query('SELECT enabled_at FROM user_mfa WHERE user_id=$1',[identity.userId]);
      if((['ADMIN','HR'].includes(actorRow.role)||factor.rows[0]?.enabled_at)&&!session.rows[0].mfa_verified_at)fail(403,'MFA_REQUIRED');
      if(!session.rows[0].reauthenticated_at||Date.now()-new Date(session.rows[0].reauthenticated_at).getTime()>600000)fail(403,'REAUTH_REQUIRED');
    }
    return actorRow.role;
  }

