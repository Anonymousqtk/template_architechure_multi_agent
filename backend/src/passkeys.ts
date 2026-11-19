import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { authorizeMutation } from './authorization.js';
import type { Config } from './config.js';
import { digest, token, validToken } from './security.js';
import { fail, type Authed, type Identity } from './types.js';
import type { UserRouteDeps } from './users.js';

type Dependencies = UserRouteDeps & {
  config: Config;
  profile: (identity: Identity) => object;
  throttle: (req: Authed, keys: string[], limit?: number) => Promise<void>;
};
type Purpose = 'login' | 'register';
const prefix = '/api/auth/passkeys';
const roles = ['ADMIN', 'HR'] as const;
const challengeInput = z.object({
  challenge: z.base64url().length(43),
  response: z.looseObject({ id: z.base64url().max(1400) }),
});
const userHandle = (userId: string) => Buffer.from(userId.replaceAll('-', ''), 'hex');

export function passkeysAvailable(config: Config) {
  const origin = new URL(config.origin);
  return config.requireMfa !== false && (origin.protocol === 'https:' || origin.hostname === 'localhost');
}

export function registerPasskeyRoutes(app: Express, deps: Dependencies) {
  const { config, pool, transaction, requireIdentity, audit, profile, throttle } = deps;
  if (!passkeysAvailable(config)) return;
  const rpID = new URL(config.origin).hostname;
  const sessionName = config.production ? '__Host-managerhr' : 'managerhr';
  const cookie = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
  const browserHash = (req: Authed) => digest(req.get('x-csrf-token') || '');

  async function save(req: Authed, challenge: string, purpose: Purpose, sessionId: string | null = null) {
    await pool.query('DELETE FROM passkey_challenges WHERE expires_at <= now()');
    await pool.query(
      "INSERT INTO passkey_challenges (challenge,browser_hash,purpose,session_id,expires_at) VALUES ($1,$2,$3,$4,now()+interval '5 minutes')",
      [challenge, browserHash(req), purpose, sessionId],
    );
  }

  async function consume(req: Authed, challenge: string, purpose: Purpose, sessionId: string | null = null) {
    const found = await pool.query(
      'DELETE FROM passkey_challenges WHERE challenge=$1 AND browser_hash=$2 AND purpose=$3 AND session_id IS NOT DISTINCT FROM $4 AND expires_at>now()',
      [challenge, browserHash(req), purpose, sessionId],
    );
    if (!found.rowCount) fail(401, 'PASSKEY_CHALLENGE_EXPIRED');
  }

  app.get(prefix, async (req: Authed, res) => {
    const identity = requireIdentity(req);
    if (!identity.mfaEnabled || !identity.mfaVerified || !roles.some(role => role === identity.role)) fail(403, 'FORBIDDEN');
    const { rows } = await pool.query(
      'SELECT id,created_at AS "createdAt",last_used_at AS "lastUsedAt" FROM user_passkeys WHERE user_id=$1 AND rp_id=$2 ORDER BY created_at,id',
      [identity.userId, rpID],
    );
    res.json({ items: rows });
  });

  app.post(prefix + '/register/options', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    await throttle(req, [`passkey-registration:${identity.userId}`]);
    const existing = await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], roles);
      if (!identity.mfaEnabled || !identity.mfaVerified) fail(403, 'MFA_REQUIRED');
      return (await db.query<{ id: string }>('SELECT id FROM user_passkeys WHERE user_id=$1 AND rp_id=$2', [identity.userId, rpID])).rows;
    });
    const options = await generateRegistrationOptions({
      rpName: 'ManagerHR', rpID, userName: identity.email,
      userDisplayName: identity.fullName, userID: userHandle(identity.userId),
      attestationType: 'none', excludeCredentials: existing,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await save(req, options.challenge, 'register', identity.sessionId);
    res.json(options);
  });

  app.post(prefix + '/register/verify', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    await throttle(req, [`passkey-registration:${identity.userId}`]);
    const { challenge, response } = challengeInput.parse(req.body);
    await consume(req, challenge, 'register', identity.sessionId);
    const proof = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON, expectedChallenge: challenge,
      expectedOrigin: config.origin, expectedRPID: rpID, requireUserVerification: true,
    }).catch(() => fail(401, 'INVALID_PASSKEY'));
    if (!proof.verified || !proof.registrationInfo) return fail(401, 'INVALID_PASSKEY');
    const { credential } = proof.registrationInfo;
    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], roles);
      if (!identity.mfaEnabled || !identity.mfaVerified) fail(403, 'MFA_REQUIRED');
      const existing = await db.query('SELECT id FROM user_passkeys WHERE user_id=$1 AND rp_id=$2 LIMIT 10', [identity.userId, rpID]);
      if ((existing.rowCount ?? 0) >= 10) fail(409, 'PASSKEY_LIMIT');
      const inserted = await db.query(
        'INSERT INTO user_passkeys (id,user_id,rp_id,public_key,counter) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [credential.id, identity.userId, rpID, Buffer.from(credential.publicKey), credential.counter],
      );
      if (!inserted.rowCount) fail(409, 'PASSKEY_EXISTS');
      await audit(db, 'PASSKEY_ADDED', identity.userId, identity.orgId, identity.userId);
    });
    res.status(204).end();
  });

  app.post(prefix + '/remove', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const { id } = z.object({ id: z.base64url().max(1400) }).parse(req.body);
    await transaction(async db => {
      await authorizeMutation(db, identity, [identity.userId], roles);
      const deleted = await db.query('DELETE FROM user_passkeys WHERE id=$1 AND user_id=$2 AND rp_id=$3', [id, identity.userId, rpID]);
      if (!deleted.rowCount) fail(404, 'PASSKEY_NOT_FOUND');
      await db.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [identity.userId, identity.sessionId]);
      await audit(db, 'PASSKEY_REMOVED', identity.userId, identity.orgId, identity.userId);
    });
    res.status(204).end();
  });

  app.post(prefix + '/login/options', async (req: Authed, res) => {
    await throttle(req, ['passkey-options:' + browserHash(req)]);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    await save(req, options.challenge, 'login');
    res.json(options);
  });

  app.post(prefix + '/login/verify', async (req: Authed, res) => {
    const { challenge, response } = challengeInput.parse(req.body);
    await throttle(req, ['passkey-login:' + digest(response.id)]);
    await consume(req, challenge, 'login');
    const raw = token();
    const sessionId = randomUUID();
    const hours = config.sessionHours || 8;
    const identity = await transaction(async db => {
      const owner = (await db.query('SELECT user_id FROM user_passkeys WHERE id=$1 AND rp_id=$2', [response.id, rpID])).rows[0];
      if (!owner) return fail(401, 'INVALID_PASSKEY');
      const user = (await db.query(
        'SELECT id,email,full_name FROM users WHERE id=$1 AND is_active AND email_verified_at IS NOT NULL FOR UPDATE',
        [owner.user_id],
      )).rows[0];
      if (!user) return fail(401, 'INVALID_PASSKEY');
      const member = (await db.query(
        `SELECT m.organization_id,o.name AS org_name,m.role
         FROM memberships m JOIN organizations o ON o.id=m.organization_id AND o.is_active
         WHERE m.user_id=$1 AND m.is_active ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE OF m`,
        [user.id],
      )).rows[0];
      if (!member || !roles.some(role => role === member.role)) return fail(401, 'INVALID_PASSKEY');
      const credential = (await db.query(
        `SELECT p.id,p.public_key,p.counter FROM user_passkeys p
         JOIN user_mfa f ON f.user_id=p.user_id AND f.enabled_at IS NOT NULL
         WHERE p.id=$1 AND p.user_id=$2 AND p.rp_id=$3 FOR UPDATE OF p`,
        [response.id, user.id, rpID],
      )).rows[0];
      const assertion = response as unknown as AuthenticationResponseJSON;
      if (!credential || assertion.response?.userHandle !== userHandle(user.id).toString('base64url')) return fail(401, 'INVALID_PASSKEY');
      const proof = await verifyAuthenticationResponse({
        response: assertion, expectedChallenge: challenge, expectedOrigin: config.origin,
        expectedRPID: rpID, requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: Number(credential.counter) },
      }).catch(() => fail(401, 'INVALID_PASSKEY'));
      if (!proof.verified) return fail(401, 'INVALID_PASSKEY');
      await db.query('UPDATE user_passkeys SET counter=$1,last_used_at=now() WHERE id=$2', [proof.authenticationInfo.newCounter, credential.id]);
      if (validToken(req.cookies[sessionName])) {
        await db.query('UPDATE user_sessions SET revoked_at=now() WHERE session_hash=$1', [digest(req.cookies[sessionName])]);
      }
      await db.query(
        `INSERT INTO user_sessions(id,user_id,organization_id,session_hash,expires_at,reauthenticated_at,mfa_verified_at,device_label)
         VALUES($1,$2,$3,$4,now()+($5*interval '1 hour'),now(),now(),'Passkey')`,
        [sessionId, user.id, member.organization_id, digest(raw), hours],
      );
      await audit(db, 'PASSKEY_LOGIN', user.id, member.organization_id, user.id);
      return {
        userId: user.id, email: user.email, fullName: user.full_name, role: member.role,
        orgId: member.organization_id, orgName: member.org_name, sessionId,
        mfaEnforced: true, mfaEnabled: true, mfaVerified: true,
      };
    });
    res.cookie(sessionName, raw, { ...cookie, maxAge: hours * 3600000 });
    res.json(profile(identity));
  });
}
