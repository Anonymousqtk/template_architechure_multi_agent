import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText, request } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API validation errors', () => {
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
