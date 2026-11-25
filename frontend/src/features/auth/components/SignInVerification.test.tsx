import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setLocale } from '../../../i18n';
import { SignInVerification } from './SignInVerification';

afterEach(() => {
  cleanup();
  setLocale('vi');
});

it('switches verification and recovery instructions without changing the account', () => {
  setLocale('vi');
  render(
    <SignInVerification email="member@example.test" onVerified={vi.fn()} onCancel={vi.fn()} />,
  );
  expect(screen.getByRole('heading', { name: 'Xác minh đăng nhập' })).toBeVisible();
  act(() => setLocale('en'));
  expect(screen.getByRole('heading', { name: 'Verify sign-in' })).toBeVisible();
  expect(screen.getByText('member@example.test')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
  expect(screen.getByLabelText('Recovery code')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset Authenticator' }));
  expect(screen.getByLabelText('Password')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Revoke and reset' })).toBeVisible();
});
