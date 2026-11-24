import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setLocale } from '../../i18n';
import { registerSensitiveActionConfirmation } from '../../services/api';
import { SensitiveActionConfirmation } from './SensitiveActionConfirmation';

vi.mock('../../services/api', async original => ({
  ...await original<typeof import('../../services/api')>(),
  registerSensitiveActionConfirmation: vi.fn(() => () => {}),
}));

afterEach(() => {
  cleanup();
  setLocale('vi');
  vi.restoreAllMocks();
});

it('updates verification labels while preserving cancel behavior', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  setLocale('vi');
  render(<SensitiveActionConfirmation useCode />);
  const callback = vi.mocked(registerSensitiveActionConfirmation).mock.calls.at(-1)?.[0];
  expect(callback).toBeDefined();
  let result!: Promise<boolean>;
  act(() => { result = callback!(); });
  expect(screen.getByRole('heading', { name: 'Xác minh để tiếp tục' })).toBeVisible();
  act(() => setLocale('en'));
  expect(screen.getByRole('heading', { name: 'Verify to continue' })).toBeVisible();
  expect(screen.getByLabelText('6-digit Authenticator code')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await result).toBe(false);
});
