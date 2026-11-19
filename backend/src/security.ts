import { createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{43}$/.test(value);
export const same = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export const sign = (value: string, secret: string) => createHmac('sha256', secret).update(value).digest('base64url');
export const hashPassword = (password: string) => hash(password,{algorithm:Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1});
export const verifyPassword = async (hash: string, password: string) => {
  try { return await verify(hash,password); } catch { return false; }
};
