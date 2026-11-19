import type { Express, Response } from 'express';
import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { fail, type Authed, type Identity } from './types.js';
import { digest, token, verifyPassword } from './security.js';
import { newTotpSecret, seal, unseal, verifyTotp } from './mfa-crypto.js';
import type { Config } from './config.js';
import type { UserRouteDeps } from './users.js';

type Dependencies=UserRouteDeps&{config:Config;throttle:(req:Authed,keys:string[],limit?:number)=>Promise<void>};
type Factor={encrypted_secret:string|null;pending_secret:string|null;pending_expires_at:Date|null;enabled_at:Date|null;last_counter:string;recovery_hashes:string[]};
const password=z.string().min(1).max(128),code=z.string().min(6).max(64);
export function registerSecurityRoutes(app:Express,{pool,transaction,audit,requireIdentity,config,throttle}:Dependencies) {
  const cookieName=config.production?'__Host-managerhr':'managerhr';
  const cookie={httpOnly:true,secure:config.production,sameSite:'lax' as const,path:'/'};
  const key=config.mfaKey||'';
  async function locked(db:PoolClient,identity:Identity) {
    await db.query('SELECT id FROM organizations WHERE id=$1 AND is_active FOR UPDATE',[identity.orgId]);
    const user=await db.query('SELECT id,password_hash FROM users WHERE id=$1 AND is_active AND email_verified_at IS NOT NULL FOR UPDATE',[identity.userId]);
    const session=await db.query(`SELECT s.*,m.role FROM user_sessions s JOIN memberships m ON m.user_id=s.user_id AND m.organization_id=s.organization_id JOIN organizations o ON o.id=m.organization_id
      WHERE s.id=$1 AND s.user_id=$2 AND s.organization_id=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-($4*interval '1 minute') AND m.is_active AND o.is_active FOR UPDATE OF s,m`,[identity.sessionId,identity.userId,identity.orgId,config.idleMinutes||30]);
    if(!user.rowCount||!session.rowCount)fail(401,'AUTHENTICATION_REQUIRED');
    await db.query('INSERT INTO user_mfa(user_id) VALUES($1) ON CONFLICT DO NOTHING',[identity.userId]);
    const factor=await db.query<Factor>('SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE',[identity.userId]);
    return {user:user.rows[0],session:session.rows[0],factor:factor.rows[0]};
  }
  function recent(session:{reauthenticated_at:Date|null}) {if(!session.reauthenticated_at||Date.now()-new Date(session.reauthenticated_at).getTime()>600000)fail(403,'REAUTH_REQUIRED');}
  async function factorProof(db:PoolClient,identity:Identity,factor:Factor,value:string) {
    if(!factor.enabled_at||!factor.encrypted_secret)fail(403,'MFA_NOT_ENROLLED');
    if(/^\d{6}$/.test(value)) {
      const next=verifyTotp(unseal(factor.encrypted_secret!,identity.userId,key),value,Number(factor.last_counter));
      if(next===null)fail(401,'INVALID_FACTOR');
      await db.query('UPDATE user_mfa SET last_counter=$1 WHERE user_id=$2',[next,identity.userId]);
    } else {
      const hash=digest(value),index=factor.recovery_hashes.indexOf(hash);
      if(index<0)fail(401,'INVALID_FACTOR');
      const remaining=[...factor.recovery_hashes];remaining.splice(index,1);
      await db.query('UPDATE user_mfa SET recovery_hashes=$1::jsonb WHERE user_id=$2',[JSON.stringify(remaining),identity.userId]);
      await audit(db,'MFA_RECOVERY_CODE_USED',identity.userId,identity.orgId,identity.userId);
    }
  }
  async function rotate(db:PoolClient,identity:Identity,session:{expires_at:Date;device_label:string},verified:boolean,full:boolean,all=false) {
    const raw=token();
    await db.query(all?'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL':'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',all?[identity.userId]:[identity.userId,identity.sessionId]);
    const expiry=full?new Date(Date.now()+(config.sessionHours||8)*3600000):session.expires_at;
    await db.query(`INSERT INTO user_sessions(id,user_id,organization_id,session_hash,expires_at,reauthenticated_at,mfa_verified_at,device_label) VALUES(gen_random_uuid(),$1,$2,$3,$4,now(),CASE WHEN $5 THEN now() ELSE NULL END,$6)`,[identity.userId,identity.orgId,digest(raw),expiry,verified,session.device_label]);
    return {raw,expiry};
  }
  function setCookie(res:Response,result:{raw:string;expiry:Date}) {res.cookie(cookieName,result.raw,{...cookie,maxAge:Math.max(0,new Date(result.expiry).getTime()-Date.now())});}
  app.get('/api/auth/mfa/status',async(req:Authed,res)=>{
    const identity=requireIdentity(req);const row=(await pool.query('SELECT enabled_at,recovery_hashes FROM user_mfa WHERE user_id=$1',[identity.userId])).rows[0];
    res.json({enabled:Boolean(row?.enabled_at),required:['ADMIN','HR'].includes(identity.role),verified:Boolean(identity.mfaVerified),recoveryCodesRemaining:row?.recovery_hashes.length||0});
  });
  app.post('/api/auth/mfa/enroll',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({password}).strict().parse(req.body);await throttle(req,[`mfa:${identity.userId}`],10);
    const secret=newTotpSecret();
    await transaction(async db=>{const state=await locked(db,identity);if(!await verifyPassword(state.user.password_hash,data.password))fail(401,'INVALID_CREDENTIALS');if(state.factor.enabled_at)fail(409,'MFA_ALREADY_ENABLED');
      await db.query("UPDATE user_mfa SET pending_secret=$1,pending_expires_at=now()+interval '10 minutes' WHERE user_id=$2",[seal(secret,identity.userId,key),identity.userId]);await audit(db,'MFA_ENROLLMENT_STARTED',identity.userId,identity.orgId,identity.userId);});
    res.json({secret,uri:`otpauth://totp/${encodeURIComponent('ManagerHR:'+identity.email)}?secret=${secret}&issuer=ManagerHR&algorithm=SHA1&digits=6&period=30`});
  });
  app.post('/api/auth/mfa/confirm',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({code}).strict().parse(req.body);await throttle(req,[`mfa:${identity.userId}`],10);
    const codes=Array.from({length:10},()=>randomBytes(16).toString('hex'));
    const rotated=await transaction(async db=>{const state=await locked(db,identity),f=state.factor;
      if(f.enabled_at||!f.pending_secret||!f.pending_expires_at||new Date(f.pending_expires_at).getTime()<=Date.now())fail(410,'ENROLLMENT_EXPIRED');
      const next=verifyTotp(unseal(f.pending_secret!,identity.userId,key),data.code,-1);if(next===null)fail(401,'INVALID_FACTOR');
      await db.query('UPDATE user_mfa SET encrypted_secret=pending_secret,pending_secret=NULL,pending_expires_at=NULL,enabled_at=now(),last_counter=$1,recovery_hashes=$2::jsonb WHERE user_id=$3',[next,JSON.stringify(codes.map(digest)),identity.userId]);
      await audit(db,'MFA_ENABLED',identity.userId,identity.orgId,identity.userId);return rotate(db,identity,state.session,true,true,true);});
    setCookie(res,rotated);res.json({recoveryCodes:codes});
  });
  app.post('/api/auth/mfa/verify',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({code}).strict().parse(req.body);await throttle(req,[`mfa:${identity.userId}`],10);
    const rotated=await transaction(async db=>{const state=await locked(db,identity);if(state.session.mfa_verified_at)fail(409,'MFA_ALREADY_VERIFIED');await factorProof(db,identity,state.factor,data.code);await audit(db,'MFA_VERIFIED',identity.userId,identity.orgId,identity.userId);return rotate(db,identity,state.session,true,!state.session.mfa_verified_at);});setCookie(res,rotated);res.status(204).end();
  });
  app.post('/api/auth/reauthenticate',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({password,code:code.optional()}).strict().parse(req.body);await throttle(req,[`reauth:${identity.userId}`],10);
    const rotated=await transaction(async db=>{const state=await locked(db,identity);if(!await verifyPassword(state.user.password_hash,data.password))fail(401,'INVALID_CREDENTIALS');
      if(state.factor.enabled_at)await factorProof(db,identity,state.factor,data.code||'');else if(['ADMIN','HR'].includes(state.session.role))fail(403,'MFA_REQUIRED');
      await audit(db,'REAUTHENTICATED',identity.userId,identity.orgId,identity.userId);return rotate(db,identity,state.session,Boolean(state.factor.enabled_at),false);});setCookie(res,rotated);res.status(204).end();
  });
  app.post('/api/auth/mfa/recovery-codes',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({password,code}).strict().parse(req.body);await throttle(req,[`mfa:${identity.userId}`],10);
    const codes=Array.from({length:10},()=>randomBytes(16).toString('hex'));
    const rotated=await transaction(async db=>{const state=await locked(db,identity);if(!await verifyPassword(state.user.password_hash,data.password))fail(401,'INVALID_CREDENTIALS');await factorProof(db,identity,state.factor,data.code);
      await db.query('UPDATE user_mfa SET recovery_hashes=$1::jsonb WHERE user_id=$2',[JSON.stringify(codes.map(digest)),identity.userId]);await audit(db,'MFA_RECOVERY_CODES_ROTATED',identity.userId,identity.orgId,identity.userId);return rotate(db,identity,state.session,true,false,true);});setCookie(res,rotated);res.json({recoveryCodes:codes});
  });
  app.post('/api/auth/mfa/disable',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({password,code}).strict().parse(req.body);await throttle(req,[`mfa:${identity.userId}`],10);
    const rotated=await transaction(async db=>{const state=await locked(db,identity);if(['ADMIN','HR'].includes(state.session.role))fail(403,'MFA_REQUIRED');if(!await verifyPassword(state.user.password_hash,data.password))fail(401,'INVALID_CREDENTIALS');await factorProof(db,identity,state.factor,data.code);await db.query('DELETE FROM user_mfa WHERE user_id=$1',[identity.userId]);await audit(db,'MFA_DISABLED',identity.userId,identity.orgId,identity.userId);return rotate(db,identity,state.session,false,false,true);});setCookie(res,rotated);res.status(204).end();
  });
  app.post('/api/auth/mfa/recover',async(req:Authed,res)=>{
    const identity=requireIdentity(req),data=z.object({password,code:z.string().regex(/^[a-f0-9]{32}$/)}).strict().parse(req.body);await throttle(req,[`mfa:${identity.userId}`],10);
    const rotated=await transaction(async db=>{const state=await locked(db,identity);if(!await verifyPassword(state.user.password_hash,data.password))fail(401,'INVALID_CREDENTIALS');await factorProof(db,identity,state.factor,data.code);await db.query('DELETE FROM user_mfa WHERE user_id=$1',[identity.userId]);await audit(db,'MFA_RECOVERED',identity.userId,identity.orgId,identity.userId);state.session.expires_at=new Date(Date.now()+300000);return rotate(db,identity,state.session,false,false,true);});setCookie(res,rotated);res.status(204).end();
  });
  app.get('/api/auth/sessions',async(req:Authed,res)=>{
    const identity=requireIdentity(req);const rows=await pool.query(`SELECT id,device_label AS "deviceLabel",created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt",id=$2 AS current FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-($3*interval '1 minute') ORDER BY created_at DESC`,[identity.userId,identity.sessionId,config.idleMinutes||30]);res.json({items:rows.rows});
  });
  app.post('/api/auth/sessions/revoke-others',async(req:Authed,res)=>{
    z.object({}).strict().parse(req.body);const identity=requireIdentity(req);await transaction(async db=>{const state=await locked(db,identity);recent(state.session);await db.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',[identity.userId,identity.sessionId]);await audit(db,'OTHER_SESSIONS_REVOKED',identity.userId,identity.orgId,identity.userId);});res.status(204).end();
  });
  app.post('/api/auth/sessions/:id/revoke',async(req:Authed,res)=>{
    z.object({}).strict().parse(req.body);const identity=requireIdentity(req),id=z.string().uuid().parse(req.params.id);await transaction(async db=>{const state=await locked(db,identity);recent(state.session);const changed=await db.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id',[id,identity.userId]);if(!changed.rowCount)fail(404,'SESSION_NOT_FOUND');await audit(db,'SESSION_REVOKED',identity.userId,identity.orgId,identity.userId);});if(id===identity.sessionId)res.clearCookie(cookieName,cookie);res.status(204).end();
  });
}
