import { describe, expect, it } from 'vitest';
import { serviceErrorCode } from '../src/service-errors.js';

describe('safe service error classification', () => {
  it.each(['42P01', '42703'])('classifies schema code %s', (code) => {
    expect(serviceErrorCode({ code, message: 'sensitive SQL' })).toBe('SERVICE_NOT_READY');
  });
  it.each(['08006', '57P03', '53300', 'ECONNREFUSED', 'ETIMEDOUT'])(
    'classifies availability code %s',
    (code) => {
      expect(serviceErrorCode({ code })).toBe('SERVICE_UNAVAILABLE');
    },
  );
  it.each([null, undefined, 'secret', {}, { code: '23505' }, { code: 42 }])(
    'leaves other errors to existing handlers',
    (error) => {
      expect(serviceErrorCode(error)).toBeNull();
    },
  );
});
