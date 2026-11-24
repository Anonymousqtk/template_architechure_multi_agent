import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setLocale } from '../../../i18n';
import { request } from '../../../services/api';
import { PasskeySettings } from './PasskeySettings';

vi.mock('../../../services/api', async original => ({
  ...await original<typeof import('../../../services/api')>(),
  request: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => true }));

afterEach(() => { cleanup(); setLocale('vi'); vi.resetAllMocks(); });

it('updates passkey controls and device dates when language changes', async () => {
  setLocale('vi');
  vi.mocked(request).mockResolvedValue({ items: [{ id: 'one', createdAt: '2026-01-01T12:00:00Z', lastUsedAt: null }] });
  render(<PasskeySettings />);
  expect(await screen.findByText('Chưa dùng để đăng nhập')).toBeVisible();
  act(() => setLocale('en'));
  expect(screen.getByText('Never used to sign in')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Remove passkey' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create passkey' })).toBeVisible();
});
