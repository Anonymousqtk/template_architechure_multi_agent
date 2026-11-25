import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OrgStructureDeps } from './organization-structure.js';
import { detectMimeFromBytes, readFile, saveFile } from './file-storage.js';
import { fail, type Authed } from './types.js';

const avatarInput = z
  .object({
    fileName: z.string().trim().min(1).max(150),
    mimeType: z.enum(['image/jpeg', 'image/png']),
    contentBase64: z.string().min(1),
  })
  .strict();

const contentUrl = (filePath: string | null) =>
  filePath
    ? `/api/auth/profile/avatar/content?v=${createHash('sha256').update(filePath).digest('hex')}`
    : null;

export function organizationUserAvatarUrl(
  organizationId: string,
  userId: string,
  filePath: string | null,
): string | null {
  return filePath
    ? `/api/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(userId)}/avatar?v=${createHash('sha256').update(filePath).digest('hex')}`
    : null;
}

export function registerProfileAvatarRoutes(app: Express, deps: OrgStructureDeps): void {
  const { pool, transaction, audit, requireIdentity } = deps;

  app.get('/api/auth/profile/avatar', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const result = await pool.query<{ avatar_url: string | null }>(
      'SELECT avatar_url FROM users WHERE id=$1',
      [identity.userId],
    );
    res.json({ avatarUrl: contentUrl(result.rows[0]?.avatar_url ?? null) });
  });

  app.get('/api/auth/profile/avatar/content', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const result = await pool.query<{ avatar_url: string | null }>(
      'SELECT avatar_url FROM users WHERE id=$1',
      [identity.userId],
    );
    const filePath = result.rows[0]?.avatar_url;
    if (!filePath) return fail(404, 'AVATAR_NOT_FOUND');

    const { buffer } = await readFile(identity.userId, filePath);
    const mimeType = detectMimeFromBytes(buffer);
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png')
      return fail(500, 'INVALID_AVATAR_FILE');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  });

  app.post('/api/auth/profile/avatar', async (req: Authed, res) => {
    const identity = requireIdentity(req);
    const data = avatarInput.parse(req.body);
    const buffer = Buffer.from(data.contentBase64, 'base64');
    if (detectMimeFromBytes(buffer) !== data.mimeType) fail(400, 'INVALID_FILE_TYPE');
    let filePath = '';

    await transaction(async (db) => {
      const result = await db.query<{ avatar_url: string | null }>(
        'SELECT avatar_url FROM users WHERE id=$1 FOR UPDATE',
        [identity.userId],
      );
      if (!result.rows[0]) fail(404, 'USER_NOT_FOUND');

      const saved = await saveFile(
        identity.userId,
        'profile-avatars',
        data.fileName,
        buffer,
        ['image/jpeg', 'image/png'],
        10 * 1024 * 1024,
      );
      filePath = saved.filePath;

      await db.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [filePath, identity.userId]);
      await audit(
        db,
        'USER_PROFILE_AVATAR_UPDATED',
        identity.userId,
        identity.orgId,
        identity.userId,
        {
          filePath,
        },
      );
    });

    res.json({ avatarUrl: contentUrl(filePath) });
  });
}
