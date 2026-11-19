import { describe, expect, it, vi } from 'vitest';
import { digest, hashPassword, same, sign, token, validToken, verifyPassword } from '../src/security.js';
import { createMailer } from '../src/mail.js';
import { loadConfig } from '../src/config.js';

describe('authentication primitives', () => {
  it('uses distinct 256-bit bearer tokens, SHA-256 digests and signed comparisons', () => {
    const first = token(); const second = token();
    expect(first).not.toBe(second); expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(validToken(first)).toBe(true); expect(validToken('short')).toBe(false); expect(validToken(null)).toBe(false);
    expect(digest(first)).toMatch(/^[a-f0-9]{64}$/); expect(same(first, first)).toBe(true); expect(same(first, second)).toBe(false);
    expect(sign(first, 'secret')).not.toBe(sign(first, 'another-secret'));
  });
  it('uses Argon2id parameters and rejects incorrect/corrupt passwords', async () => {
    const hash = await hashPassword('test-only sufficiently long password');
    expect(hash).toContain('$argon2id$v=19$m=65536,t=3,p=1$');
    expect(await verifyPassword(hash, 'test-only sufficiently long password')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false); expect(await verifyPassword('corrupt', 'wrong')).toBe(false);
  });
  it('absent SMTP is DEV_ONLY and never claims a sent message', async () => {
    vi.stubEnv('SMTP_HOST', '');
    try { const mailer = createMailer(); expect(mailer.mode).toBe('DEV_ONLY'); expect(await mailer.send('x@example.test', 'Test', 'https://example.test')).toBe('DEV_ONLY'); }
    finally { vi.unstubAllEnvs(); }
  });
  it('fails closed for insecure production origin, short secret and missing DB config', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_ORIGIN', 'http://example.test'); vi.stubEnv('CSRF_SECRET', 'x'.repeat(32)); vi.stubEnv('DATABASE_URL', 'postgres://test');
    try {
      expect(() => loadConfig()).toThrow('canonical HTTPS');
      vi.stubEnv('APP_ORIGIN', 'https://example.test'); vi.stubEnv('CSRF_SECRET', 'short'); expect(() => loadConfig()).toThrow('32');
      vi.stubEnv('CSRF_SECRET', 'x'.repeat(32)); vi.stubEnv('DATABASE_URL', ''); expect(() => loadConfig()).toThrow('DATABASE_URL');
    } finally { vi.unstubAllEnvs(); }
  });
});
