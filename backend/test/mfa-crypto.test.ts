import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, unseal } from '../src/mfa-crypto.js';

describe('MFA AES-GCM authentication tags',()=>{
  const key=randomBytes(32).toString('base64');
  const owner='test-owner';
  it('keeps existing 16-byte ciphertexts readable and binds them to their owner',()=>{
    const value=seal('test-secret',owner,key);
    expect(Buffer.from(value.split('.')[2],'base64url')).toHaveLength(16);
    expect(unseal(value,owner,key)).toBe('test-secret');
    expect(()=>unseal(value,'other-owner',key)).toThrow();
  });
  it.each([4,8,12,13,14,15])('rejects a truncated %i-byte tag',length=>{
    const parts=seal('test-secret',owner,key).split('.');
    parts[2]=Buffer.from(parts[2],'base64url').subarray(0,length).toString('base64url');
    expect(()=>unseal(parts.join('.'),owner,key)).toThrow();
  });
});
