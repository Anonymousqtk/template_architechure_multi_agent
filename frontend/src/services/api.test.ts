import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorText, request } from './api';
import { setLocale } from '../i18n';

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale('vi');
});

describe('API validation errors', () => {
  it('uses English safe messages and field labels without exposing unknown codes', () => {
    setLocale('en');
    expect(errorText(new ApiError(400, 'INVALID_INPUT', ['personalEmail', 'unknown']))).toBe('Please check: Personal email.');
    expect(errorText(new ApiError(403, 'MFA_REQUIRED'))).toContain('two-factor authentication');
    expect(errorText(new ApiError(400, 'UNKNOWN_INTERNAL_CODE'))).toBe('The request could not be completed. Please try again.');
    expect(errorText(new Error('private detail'))).toBe('Could not connect. Please try again.');
  });
  it('preserves safe invalid field paths and shows employee-friendly guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'INVALID_INPUT', fields: ['personalEmail'] }),
    }));

    const error = await request('/api/organizations/org/employees', {}).then(
      () => null,
      cause => cause,
    );
    expect(error).toMatchObject({ code: 'INVALID_INPUT', fields: ['personalEmail'] });
    expect(errorText(error)).toBe('Vui lòng kiểm tra lại: Email cá nhân.');
  });
});
