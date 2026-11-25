import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './types.js';

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const UPLOADS_ROOT = path.resolve(process.cwd(), 'data', 'uploads');

// Ensure base upload directory exists
if (!fsSync.existsSync(UPLOADS_ROOT)) {
  fsSync.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

export function detectMimeFromBytes(buffer: Buffer, declaredMime?: string): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'application/pdf';
  }
  // PKZip archive (XLSX, DOCX, ZIP)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  // Text / CSV check (no null bytes in the first 1KB, valid text characters)
  if (declaredMime === 'text/csv' || declaredMime === 'text/plain') {
    const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
    let hasNull = false;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0x00) {
        hasNull = true;
        break;
      }
    }
    if (!hasNull) return 'text/csv';
  }
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).trim();
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized.slice(0, 150) || 'file.bin';
}

export function getTenantUploadDir(orgId: string, subfolder = ''): string {
  const safeOrgId = orgId.replace(/[^a-zA-Z0-9-]/g, '');
  const safeSubfolder = subfolder.replace(/[^a-zA-Z0-9-_]/g, '');
  const dir = path.resolve(UPLOADS_ROOT, safeOrgId, safeSubfolder);
  // Guard against path traversal
  if (!dir.startsWith(UPLOADS_ROOT)) {
    throw new Error('PATH_TRAVERSAL_DETECTED');
  }
  return dir;
}

export async function saveFile(
  orgId: string,
  subfolder: string,
  fileName: string,
  buffer: Buffer,
  allowedMimes: readonly string[] = ALLOWED_MIME_TYPES,
  maxSizeBytes = 10 * 1024 * 1024,
): Promise<{
  fileId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}> {
  if (buffer.length === 0) {
    fail(400, 'EMPTY_FILE');
  }
  if (buffer.length > maxSizeBytes) {
    fail(400, 'FILE_TOO_LARGE');
  }

  const detectedMime = detectMimeFromBytes(
    buffer,
    allowedMimes.includes('text/csv') ? 'text/csv' : undefined,
  );
  if (!detectedMime || !allowedMimes.includes(detectedMime)) {
    fail(400, 'INVALID_FILE_TYPE');
  }

  const safeName = sanitizeFileName(fileName);
  const fileId = randomUUID();
  const dir = getTenantUploadDir(orgId, subfolder);
  await fs.mkdir(dir, { recursive: true });

  const diskFileName = `${fileId}-${safeName}`;
  const absolutePath = path.resolve(dir, diskFileName);

  if (!absolutePath.startsWith(dir)) {
    fail(400, 'INVALID_FILE_PATH');
  }

  await fs.writeFile(absolutePath, buffer);

  // Store relative path from tenant root
  const relativePath = path.join(subfolder, diskFileName).replace(/\\/g, '/');

  return {
    fileId,
    filePath: relativePath,
    fileName: safeName,
    fileSize: buffer.length,
    mimeType: detectedMime!,
  };
}

export async function readFile(
  orgId: string,
  relativePath: string,
): Promise<{ buffer: Buffer; absolutePath: string }> {
  const safeOrgId = orgId.replace(/[^a-zA-Z0-9-]/g, '');
  const tenantDir = path.resolve(UPLOADS_ROOT, safeOrgId);
  const absolutePath = path.resolve(tenantDir, relativePath);

  if (!absolutePath.startsWith(tenantDir)) {
    fail(403, 'ACCESS_DENIED');
  }

  try {
    const buffer = await fs.readFile(absolutePath);
    return { buffer, absolutePath };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ENOENT') {
      fail(404, 'FILE_NOT_FOUND');
    }
    throw err;
  }
}

export async function deleteFile(orgId: string, relativePath: string): Promise<void> {
  const safeOrgId = orgId.replace(/[^a-zA-Z0-9-]/g, '');
  const tenantDir = path.resolve(UPLOADS_ROOT, safeOrgId);
  const absolutePath = path.resolve(tenantDir, relativePath);

  if (!absolutePath.startsWith(tenantDir)) {
    fail(403, 'ACCESS_DENIED');
  }

  try {
    await fs.unlink(absolutePath);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== 'ENOENT') throw err;
  }
}
