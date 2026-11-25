export interface Config {
  origin: string;
  production: boolean;
  csrfSecret: string;
  sessionHours?: number;
  idleMinutes?: number;
  requireMfa?: boolean;
  mfaKey?: string;
}
export function loadConfig(): Config {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
  if (new URL(origin).origin !== origin || (production && !origin.startsWith('https://')))
    throw new Error('APP_ORIGIN must be a canonical HTTPS origin in production');
  const csrfSecret = process.env.CSRF_SECRET || '';
  if (csrfSecret.length < 32) throw new Error('CSRF_SECRET must contain at least 32 characters');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const mfaKey = process.env.MFA_ENCRYPTION_KEY || '';
  if (Buffer.from(mfaKey, 'base64').length !== 32)
    throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
  return {
    origin,
    production,
    csrfSecret,
    sessionHours: 8,
    idleMinutes: 30,
    requireMfa: true,
    mfaKey,
  };
}
