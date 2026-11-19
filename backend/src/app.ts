import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { digest, hashPassword, verifyPassword, token, validToken, sign, same } from './security.js';
import type { Config } from './config.js';
import { createMailer, type Mailer } from './mail.js';
import { HttpError, fail, type Authed, type Identity } from './types.js';
import { authorizeMutation, permissionsFor } from './authorization.js';
import { registerSecurityRoutes } from './session-security.js';
import { passkeysAvailable, registerPasskeyRoutes } from './passkeys.js';
import { registerUserRoutes } from './users.js';
import { registerOrgStructureRoutes } from './organization-structure.js';
import { registerEmployeeRoutes } from './employees.js';
import { registerAttendanceRoutes } from './attendance.js';
import { serviceErrorCode } from './service-errors.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const uuid = z.string().uuid();
const forgotMessage = 'If the account exists, instructions will be sent.';
export interface AppOptions { pool: Pool; config: Config; mailer?: Mailer; rateLimit?: number }

export function createApp({pool,config,mailer=createMailer(),rateLimit=30}: AppOptions) {
  if(config.requireMfa!==false && Buffer.from(config.mfaKey||'','base64').length!==32)throw Error('MFA encryption key is required');
  if (config.csrfSecret.length < 32) throw new Error('CSRF secret too short');
  const app = express();
  const sessionName = config.production ? '__Host-managerhr' : 'managerhr';
  const csrfName = config.production ? '__Host-csrf' : 'managerhr-csrf';
  const cookieOptions = {httpOnly:true,secure:config.production,sameSite:'lax' as const,path:'/'};
  const dummyHash = hashPassword(token());
  const pendingMail: Array<()=>Promise<void>>=[];
  let activeMail=0;
  function dispatchMail(job: ()=>Promise<void>) {
    // Bounded ephemeral delivery queue: never persist or log bearer links.
    if(pendingMail.length>=100) return false;
    pendingMail.push(job);
    const drain=()=>{
      while(activeMail<2 && pendingMail.length) {
        const task=pendingMail.shift()!; activeMail++;
        void task().catch(()=>undefined).finally(()=>{activeMail--;setImmediate(drain);});
      }
    };
    setImmediate(drain);return true;
  }
  app.disable('x-powered-by');
  app.use(helmet({referrerPolicy:{policy:'no-referrer'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'"],connectSrc:["'self'"],formAction:["'self'"],frameAncestors:["'none'"]}}}));
  app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.use(express.json({limit:'16kb'}),cookieParser());

  async function transaction<T>(fn: (db: PoolClient)=>Promise<T>): Promise<T> {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  }
  async function audit(
    db: Pool | PoolClient,
    event: string,
    actor?: string,
    org?: string,
    subject?: string,
    metadata: Record<string, unknown> = {},
  ) {
    await db.query(
      'INSERT INTO auth_audit_events(id,event_type,actor_user_id,organization_id,subject_user_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [randomUUID(), event, actor || null, org || null, subject || null, JSON.stringify({outcome:'SUCCESS',...metadata})],
    );
  }
  async function throttle(req: Request, keys: string[], maximum=rateLimit, namespace='auth') {
    // Shared persistent counters; the default untrusted-forwarded-header policy uses socket IP.
    const ipKey = `ip:${req.ip || req.socket.remoteAddress}`;
    for (const key of [namespace === 'auth' ? ipKey : `${namespace}:${ipKey}`, ...keys]) {
      const result = await pool.query(`INSERT INTO auth_rate_limits(key_hash,window_start,attempts) VALUES($1,now(),1)
        ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start < now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
        window_start=CASE WHEN auth_rate_limits.window_start < now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END RETURNING attempts`,[digest(key)]);
      if (result.rows[0].attempts > maximum) fail(429,'RATE_LIMITED');
    }
  }
  app.get('/api/auth/csrf',(_req,res)=>{
    const current=String(_req.cookies[csrfName]||'').split('.');
    const value=current.length===2 && validToken(current[0]) && same(sign(current[0],config.csrfSecret),current[1]) ? current[0] : token();
    const signed=`${value}.${sign(value,config.csrfSecret)}`;
    res.cookie(csrfName,signed,{...cookieOptions,maxAge:3600000}); res.json({csrfToken:value,deliveryMode:mailer.mode,passkeysAvailable:passkeysAvailable(config)});
  });
  app.use('/api',(req,res,next)=>{
    if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
    const origin=req.get('origin'); const header=req.get('x-csrf-token')||'';
    const cookie=String(req.cookies[csrfName]||'').split('.');
    if (origin!==config.origin || !req.is('application/json') || cookie.length!==2 || !validToken(header) || !same(header,cookie[0]) || !same(sign(cookie[0],config.csrfSecret),cookie[1])) {
      res.status(403).json({code:'CSRF_REJECTED'});return;
    }
    next();
  });
  app.use('/api',async (req: Authed,_res,next)=>{
    try {
      const raw=req.cookies[sessionName];
      if (validToken(raw)) {
        const result=await pool.query(`SELECT s.id AS "sessionId",u.id AS "userId",u.email,u.full_name AS "fullName",o.id AS "orgId",o.name AS "orgName",m.role,s.mfa_verified_at,s.reauthenticated_at,f.enabled_at AS mfa_enabled
          FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN organizations o ON o.id=s.organization_id
          JOIN memberships m ON m.user_id=u.id AND m.organization_id=o.id LEFT JOIN user_mfa f ON f.user_id=u.id
          WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-($2*interval '1 minute') AND u.is_active AND u.email_verified_at IS NOT NULL AND o.is_active AND m.is_active`,[digest(raw),config.idleMinutes||30]);
        if(result.rows[0]) {
          const row=result.rows[0];const touched=await pool.query("UPDATE user_sessions SET last_seen_at=now() WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-($2*interval '1 minute') RETURNING id",[row.sessionId,config.idleMinutes||30]);
          if(touched.rowCount)req.identity={...row,mfaEnforced:config.requireMfa!==false,mfaEnabled:Boolean(row.mfa_enabled),mfaVerified:Boolean(row.mfa_verified_at),reauthenticatedAt:row.reauthenticated_at,idleMinutes:config.idleMinutes||30};
        }
      }
      next();
    } catch(error) { next(error); }
  });
  const limitedPaths=new Set(['/api/auth/login','/api/auth/forgot-password','/api/auth/reset-password','/api/auth/invitations/validate','/api/auth/me','/api/auth/logout','/api/auth/mfa/status','/api/auth/mfa/enroll','/api/auth/mfa/confirm','/api/auth/mfa/verify','/api/auth/mfa/recover']);
  limitedPaths.add('/api/auth/passkeys/login/options');
  limitedPaths.add('/api/auth/passkeys/login/verify');
  app.use('/api',(req:Authed,res,next)=>{
    const identity=req.identity;
    if(identity && config.requireMfa!==false && (['ADMIN','HR'].includes(identity.role)||identity.mfaEnabled) && !identity.mfaVerified && !limitedPaths.has(req.originalUrl.split('?')[0])) {
      res.status(403).json({code:'MFA_REQUIRED'});return;
    }
    next();
  });
  const requireIdentity=(req: Authed): Identity=>req.identity||fail(401,'AUTHENTICATION_REQUIRED');
  const requireManager=(req: Authed): Identity=>{
    const identity=requireIdentity(req);
    if (!uuid.safeParse(req.params.organizationId).success || identity.orgId!==req.params.organizationId || !['HR','ADMIN'].includes(identity.role)) fail(403,'FORBIDDEN');
    return identity;
  };
  const profile = (identity: Identity) => ({
    user: { id: identity.userId, email: identity.email, fullName: identity.fullName },
    organization: { id: identity.orgId, name: identity.orgName, role: identity.role },
    permissions: permissionsFor(config.requireMfa!==false&&(['ADMIN','HR'].includes(identity.role)||identity.mfaEnabled)&&!identity.mfaVerified?'LIMITED':identity.role),
    security:{mfaRequired:config.requireMfa!==false&&(['ADMIN','HR'].includes(identity.role)||Boolean(identity.mfaEnabled)),mfaEnabled:Boolean(identity.mfaEnabled),mfaVerified:Boolean(identity.mfaVerified)},
    deliveryMode: mailer.mode,
  });
  app.get('/api/auth/me',(req: Authed,res)=>res.json(profile(requireIdentity(req))));
  app.post('/api/auth/login',async(req: Authed,res)=>{
    const data=z.object({email,password:z.string().min(1).max(128)}).strict().parse(req.body);
    await throttle(req,[`login:${data.email}`]);
    const raw=token(),sessionId=randomUUID();
    const loginResult=await transaction(async db=>{
      // Serialize credential verification/session insertion in strict u -> m lock order.
      const userResult=await db.query(
        'SELECT * FROM users WHERE email=$1 AND is_active AND email_verified_at IS NOT NULL FOR UPDATE',
        [data.email],
      );
      const user=userResult.rows[0];
      const memberResult=user ? await db.query(
        `SELECT m.organization_id,o.name AS org_name,m.role
         FROM memberships m
         JOIN organizations o ON o.id=m.organization_id AND o.is_active
         WHERE m.user_id=$1 AND m.is_active
         ORDER BY m.created_at,m.id
         LIMIT 1
         FOR UPDATE OF m`,
        [user.id],
      ) : undefined;
      const membership=memberResult?.rows[0];
      const correct=await verifyPassword(user?.password_hash || await dummyHash,data.password);
      if (!user || !membership || !correct) fail(401,'INVALID_CREDENTIALS');
      if(validToken(req.cookies[sessionName])) await db.query('UPDATE user_sessions SET revoked_at=now() WHERE session_hash=$1',[digest(req.cookies[sessionName])]);
      const factor=(await db.query('SELECT enabled_at FROM user_mfa WHERE user_id=$1',[user.id])).rows[0];
      const limited=config.requireMfa!==false&&(['ADMIN','HR'].includes(membership.role)||factor?.enabled_at);
      const device=/Edg\//.test(req.get('user-agent')||'')?'Edge':/Chrome\//.test(req.get('user-agent')||'')?'Chrome':/Firefox\//.test(req.get('user-agent')||'')?'Firefox':/Safari\//.test(req.get('user-agent')||'')?'Safari':'Browser';
      await db.query(`INSERT INTO user_sessions(id,user_id,organization_id,session_hash,expires_at,reauthenticated_at,device_label) VALUES($1,$2,$3,$4,now()+($5 * interval '1 minute'),now(),$6)`,[sessionId,user.id,membership.organization_id,digest(raw),limited?5:(config.sessionHours||8)*60,device]);
      await audit(db,'LOGIN',user.id,membership.organization_id,user.id);
      return { user, membership, mfaEnabled:Boolean(factor?.enabled_at),limited };
    });
    res.cookie(sessionName,raw,{...cookieOptions,maxAge:loginResult.limited?300000:(config.sessionHours||8)*3600000});
    res.json(profile({
      userId:loginResult.user.id,
      email:loginResult.user.email,
      fullName:loginResult.user.full_name,
      orgId:loginResult.membership.organization_id,
      orgName:loginResult.membership.org_name,
      role:loginResult.membership.role,
      sessionId,mfaEnforced:config.requireMfa!==false,mfaEnabled:loginResult.mfaEnabled,mfaVerified:false,
    }));
  });
  app.post('/api/auth/logout',async(req: Authed,res)=>{
    const identity=requireIdentity(req);
    await transaction(async db=>{await db.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1',[identity.sessionId]);await audit(db,'LOGOUT',identity.userId,identity.orgId);});
    res.clearCookie(sessionName,cookieOptions);res.status(204).end();
  });
  app.post('/api/auth/forgot-password',async(req,res)=>{
    const data=z.object({email}).strict().parse(req.body);
    await throttle(req,[`reset-account:${data.email}`,`recipient:${data.email}`],Math.min(rateLimit,10));
    const raw=token();
    const user=await transaction(async db=>{
      const found=await db.query(`SELECT id,email FROM users WHERE email=$1 AND is_active AND email_verified_at IS NOT NULL FOR UPDATE`,[data.email]);
      if(!found.rows[0]) return undefined;
      const u=found.rows[0];
      await db.query('UPDATE password_reset_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[u.id]);
      await db.query(`INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')`,[randomUUID(),u.id,digest(raw)]);
      await audit(db,'RESET_REQUESTED',undefined,undefined,u.id);return u;
    });
    if(user) {
      const queued=dispatchMail(async()=>{try {await mailer.send(user.email,'Reset your ManagerHR password',`${config.origin}/reset-password?token=${raw}`);}catch {await audit(pool,'RESET_DELIVERY_FAILED',undefined,undefined,user.id);}});
      if(!queued) await audit(pool,'RESET_DELIVERY_QUEUE_FULL',undefined,undefined,user.id);
    }
    res.status(202).json({message:forgotMessage,deliveryMode:mailer.mode});
  });
  app.post('/api/auth/reset-password',async(req,res)=>{
    const data=z.object({token:z.string(),newPassword:password}).strict().parse(req.body);
    await throttle(req,[`reset-token:${digest(data.token)}`]);
    if(!validToken(data.token)) fail(410,'INVALID_TOKEN');
    const hash=await hashPassword(data.newPassword);
    await transaction(async db=>{
      const owner=await db.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1',[digest(data.token)]);
      if(!owner.rows[0]) fail(410,'INVALID_TOKEN');
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner.rows[0].user_id]);
      const result=await db.query(`SELECT r.*,u.is_active FROM password_reset_tokens r JOIN users u ON u.id=r.user_id WHERE r.token_hash=$1 FOR UPDATE OF r`,[digest(data.token)]);
      const row=result.rows[0];
      if(!row || row.consumed_at || new Date(row.expires_at).getTime()<=Date.now() || !row.is_active) fail(410,'INVALID_TOKEN');
      await db.query('UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2',[hash,row.user_id]);
      await db.query('UPDATE password_reset_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[row.user_id]);
      await db.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[row.user_id]);
      await audit(db,'PASSWORD_RESET',row.user_id,undefined,row.user_id);
    });
    res.clearCookie(sessionName,cookieOptions);res.status(204).end();
  });
  app.get('/api/auth/invitations/validate',async(req,res)=>{
    await throttle(req,[`invite-validation:${digest(String(req.query.token||''))}`],rateLimit*4);
    if(!validToken(req.query.token)) {res.json({status:'invalid'});return;}
    const result=await pool.query(`SELECT i.expires_at,i.consumed_at,i.revoked_at,o.is_active FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE token_hash=$1`,[digest(req.query.token)]);
    const row=result.rows[0];
    res.json({status:!row||row.consumed_at||row.revoked_at||!row.is_active?'invalid':new Date(row.expires_at).getTime()<=Date.now()?'expired':'valid'});
  });
  app.post('/api/auth/invitations/accept',async(req: Authed,res)=>{
    const data=z.object({token:z.string(),fullName:z.string().trim().min(1).max(120).optional(),password:password.optional()}).strict().parse(req.body);
    await throttle(req,[`accept:${digest(data.token)}`]);
    if(!validToken(data.token)) fail(410,'INVALID_TOKEN');
    const hash=data.password?await hashPassword(data.password):undefined;
    await transaction(async db=>{
      const found=await db.query(`SELECT i.*,o.is_active FROM invitations i JOIN organizations o ON o.id=i.organization_id WHERE i.token_hash=$1 FOR UPDATE OF i`,[digest(data.token)]);
      const invite=found.rows[0];
      if(!invite||invite.consumed_at||invite.revoked_at||!invite.is_active||new Date(invite.expires_at).getTime()<=Date.now()) fail(410,'INVALID_TOKEN');
      // Serialize identity creation across distinct invitations for the same normalized address.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[invite.email]);
      const existing=await db.query('SELECT * FROM users WHERE email=$1 FOR UPDATE',[invite.email]);
      let user=existing.rows[0];
      if(user) {
        if(!req.identity||req.identity.userId!==user.id||req.identity.email!==invite.email||!user.is_active||!user.email_verified_at) fail(403,'MATCHING_ACCOUNT_REQUIRED');
        const member=await db.query('SELECT id FROM memberships WHERE user_id=$1 AND organization_id=$2',[user.id,invite.organization_id]);
        if(member.rowCount) fail(409,'MEMBERSHIP_EXISTS');
      } else {
        if(req.identity) fail(403,'MATCHING_ACCOUNT_REQUIRED');
        if(!hash||!data.fullName) fail(400,'NAME_AND_PASSWORD_REQUIRED');
        user={id:randomUUID()};
        await db.query(`INSERT INTO users(id,email,full_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())`,[user.id,invite.email,data.fullName,hash]);
      }
      await db.query(`INSERT INTO memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)`,[randomUUID(),user.id,invite.organization_id,invite.role]);
      await db.query('UPDATE invitations SET consumed_at=now() WHERE id=$1',[invite.id]);
      await audit(db,'INVITATION_ACCEPTED',user.id,invite.organization_id,user.id);
    });
    res.status(204).end();
  });
  const route='/api/organizations/:organizationId/invitations';
  app.get(route,async(req: Authed,res)=>{
    const identity=requireManager(req);
    const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const limit=z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit);
    const result=await pool.query(`SELECT id,email,role,expires_at AS "expiresAt",consumed_at AS "consumedAt",revoked_at AS "revokedAt",delivery_status AS "deliveryStatus" FROM invitations WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,[identity.orgId,limit,(page-1)*limit]);
    res.json({items:result.rows,page,limit,deliveryMode:mailer.mode});
  });
  async function deliver(id: string, to: string, raw: string, identity: Identity) {
    let status: 'SENT'|'DEV_ONLY'|'FAILED';
    try {status=await mailer.send(to,'Your ManagerHR invitation',`${config.origin}/invite/accept?token=${raw}`);}catch {status='FAILED';}
    await transaction(async db=>{const updated=await db.query('UPDATE invitations SET delivery_status=$1 WHERE id=$2 AND token_hash=$3 AND revoked_at IS NULL AND consumed_at IS NULL',[status,id,digest(raw)]);
      if(updated.rowCount) await audit(db,`INVITATION_DELIVERY_${status}`,identity.userId,identity.orgId);});
  }
  app.post(route,async(req: Authed,res)=>{
    const identity=requireManager(req);
    const data=z.object({email,role:z.enum(['EMPLOYEE','HR'])}).strict().parse(req.body);
    if(data.role==='HR'&&identity.role!=='ADMIN') fail(403,'FORBIDDEN');
    await throttle(req,[`organization:${identity.orgId}`,`recipient:${data.email}`],Math.min(rateLimit,10));
    const raw=token(),id=randomUUID();
    const created=await transaction(async db=>{
      const role=await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);
      if(data.role==='HR' && role!=='ADMIN') fail(403,'FORBIDDEN');
      const member=await db.query(`SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=$1 AND m.organization_id=$2`,[data.email,identity.orgId]);
      if(member.rowCount) return false;
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${identity.orgId}:${data.email}`]);
      await db.query('UPDATE invitations SET revoked_at=now() WHERE organization_id=$1 AND email=$2 AND consumed_at IS NULL AND revoked_at IS NULL',[identity.orgId,data.email]);
      await db.query(`INSERT INTO invitations(id,organization_id,email,role,token_hash,created_by_user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '48 hours')`,[id,identity.orgId,data.email,data.role,digest(raw),identity.userId]);
      await audit(db,'INVITATION_CREATED',identity.userId,identity.orgId);return true;
    });
    if(created) await deliver(id,data.email,raw,identity);
    res.status(202).json({message:'Invitation request processed.',deliveryMode:mailer.mode});
  });
  app.post(`${route}/:id/revoke`,async(req: Authed,res)=>{
    const identity=requireManager(req); const id=uuid.parse(req.params.id);
    await transaction(async db=>{
      await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);
      const result=await db.query('UPDATE invitations SET revoked_at=now() WHERE id=$1 AND organization_id=$2 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id',[id,identity.orgId]);
      if(!result.rowCount) fail(404,'INVITATION_NOT_FOUND');
      await audit(db,'INVITATION_REVOKED',identity.userId,identity.orgId);
    });res.status(204).end();
  });
  app.post(`${route}/:id/resend`,async(req: Authed,res)=>{
    const identity=requireManager(req);const id=uuid.parse(req.params.id),raw=token();
    const recipient=await pool.query('SELECT email FROM invitations WHERE id=$1 AND organization_id=$2',[id,identity.orgId]);
    if(!recipient.rows[0]) fail(404,'INVITATION_NOT_FOUND');
    await throttle(req,[`organization:${identity.orgId}`,`resend:${id}`,`recipient:${recipient.rows[0].email}`],Math.min(rateLimit,10));
    const to=await transaction(async db=>{
      const actorRole=await authorizeMutation(db,identity,[identity.userId],['ADMIN','HR']);
      const found=await db.query('SELECT * FROM invitations WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,identity.orgId]);
      const invite=found.rows[0];
      if(!invite||invite.consumed_at||invite.revoked_at) fail(404,'INVITATION_NOT_FOUND');
      if(invite.role==='HR'&&actorRole!=='ADMIN') fail(403,'FORBIDDEN');
      await db.query(`UPDATE invitations SET token_hash=$1,expires_at=now()+interval '48 hours',delivery_status='DEV_ONLY' WHERE id=$2`,[digest(raw),id]);
      await audit(db,'INVITATION_REISSUED',identity.userId,identity.orgId);return invite.email;
    });
    await deliver(id,to,raw,identity);res.status(202).json({message:'Invitation request processed.',deliveryMode:mailer.mode});
  });
  registerSecurityRoutes(app, {pool,config,transaction,audit,requireIdentity,throttle});
  registerPasskeyRoutes(app, {pool,config,transaction,audit,requireIdentity,profile,
    throttle:(req,keys,limit)=>throttle(req,keys,limit,'passkey')});
  registerUserRoutes(app, { pool, transaction, audit, requireIdentity });
  registerOrgStructureRoutes(app, { pool, transaction, audit, requireIdentity });
  registerEmployeeRoutes(app, { pool, transaction, audit, requireIdentity });
  registerAttendanceRoutes(app, { pool, transaction, audit, requireIdentity });
  app.use('/api',(_req,res)=>res.status(404).json({code:'NOT_FOUND'}));
  app.use(async(error: unknown,_req: Authed,res: Response,_next: NextFunction)=>{
    void _next;
    if(error instanceof HttpError && [403,404,409].includes(error.status) && _req.identity && _req.originalUrl.startsWith('/api/organizations/')) {
      try { await audit(pool,'ADMIN_ACTION_DENIED',_req.identity.userId,_req.identity.orgId,undefined,{outcome:'DENIED',code:error.code,method:_req.method}); } catch { /* Do not expose audit infrastructure or request secrets. */ }
    }
    if(error instanceof HttpError && (error.status===429 || (_req.path==='/api/auth/login'&&error.status===401) || (_req.path.startsWith('/api/auth/mfa/')&&error.status===401))) {
      const event=error.status===429?'AUTH_RATE_LIMITED':_req.path==='/api/auth/login'?'LOGIN_FAILED':'MFA_FAILED';
      try{await audit(pool,event,_req.identity?.userId,_req.identity?.orgId,undefined,{outcome:'DENIED',code:error.code});}catch{/* Never serialize sensitive input/provider errors. */}
    }
    if(error instanceof z.ZodError) {res.status(400).json({code:'INVALID_INPUT'});return;}
    if(error instanceof HttpError) {if(error.status===429) res.setHeader('Retry-After','900');res.status(error.status).json({code:error.code});return;}
    if(error instanceof SyntaxError) {res.status(400).json({code:'INVALID_JSON'});return;}
    // Never serialize database, SMTP, request, password or URL/token errors.
    const serviceCode=serviceErrorCode(error);
    if(serviceCode) {res.status(503).json({code:serviceCode});return;}
    res.status(500).json({code:'INTERNAL_ERROR'});
  });
  return app;
}
