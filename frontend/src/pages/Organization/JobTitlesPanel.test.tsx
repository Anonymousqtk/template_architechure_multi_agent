import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setLocale } from '../../i18n';
import { request } from '../../services/api';
import { JobTitlesPanel } from './JobTitlesPanel';

vi.mock('../../services/api', async (original) => ({
  ...(await original<typeof import('../../services/api')>()),
  request: vi.fn(),
}));

afterEach(() => {
  cleanup();
  setLocale('vi');
  vi.resetAllMocks();
});

it('switches job title labels while preserving organization data', async () => {
  setLocale('vi');
  vi.mocked(request).mockResolvedValue({
    items: [{ id: 'one', code: 'DEV', name: 'Developer', description: null, isActive: true }],
    total: 1,
  });
  render(<JobTitlesPanel organizationId="org" />);
  await screen.findByText('Developer');
  act(() => setLocale('en'));
  expect(screen.getByRole('searchbox', { name: 'Find job titles' })).toBeVisible();
  expect(screen.getByText('Developer')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '+ Add job title' }));
  expect(screen.getByLabelText('Job title name')).toBeVisible();
});
