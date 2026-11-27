import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { setLocale } from '../../i18n';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Dashboard } from './Dashboard';
import { HomeLaunchpad } from './HomeLaunchpad';
import { request, type Profile } from '../../services/api';
vi.mock('../../services/api', async (original) => ({
  ...(await original<typeof import('../../services/api')>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
vi.mock('./ExecutiveAnalytics', () => ({ ExecutiveAnalytics: () => null }));
const profile: Profile = {
  user: { id: 'admin', email: 'admin@example.test', fullName: 'Admin' },
  organization: { id: 'org-a', name: 'Company', role: 'ADMIN' },
  permissions: { invite: true, grantHR: true, readUsers: true, viewAudit: true },
  security: { mfaRequired: true, mfaEnabled: true, mfaVerified: true },
  deliveryMode: 'DEV_ONLY',
};
const sessions = {
  items: [{ id: 'session', deviceLabel: 'Chrome', current: true, lastSeenAt: '2026-11-01' }],
};
const invites = {
  items: [
    {
      id: 'i1',
      email: 'one@example.test',
      role: 'EMPLOYEE',
      expiresAt: '2099-01-01',
      consumedAt: null,
      revokedAt: null,
      deliveryStatus: 'DEV_ONLY',
    },
    {
      id: 'i2',
      email: 'two@example.test',
      role: 'EMPLOYEE',
      expiresAt: '2099-01-01',
      consumedAt: '2026-11-01',
      revokedAt: null,
      deliveryStatus: 'SENT',
    },
  ],
};
const fixture = async (path: string) => {
  if (path === '/api/auth/sessions') return sessions;
  if (path.includes('/invitations')) return invites;
  if (path.includes('/audit-events'))
    return {
      items: [
        {
          id: 'a',
          eventType: 'INVITATION_CREATED',
          createdAt: '2026-11-01',
          metadata: { outcome: 'SUCCESS' },
        },
      ],
      total: 1,
    };
  const url = new URL(path, 'http://local');
  return {
    items: [],
    total: url.searchParams.has('role')
      ? { ADMIN: 1, HR: 1, MANAGER: 2, EMPLOYEE: 8 }[url.searchParams.get('role')!] || 0
      : url.searchParams.get('status') === 'active'
        ? 10
        : url.searchParams.get('status') === 'locked'
          ? 2
          : 12,
  };
};
const card = (name: string) => within(screen.getByRole('heading', { name }).closest('section')!);
const stat = (name: string) => within(screen.getByText(name).closest('.dash-stat-card')!);
beforeEach(() => {
  setLocale('vi');
  mock.mockReset();
  mock.mockImplementation(fixture);
});
afterEach(cleanup);
describe('permission-scoped dashboard', () => {
  it('updates overview labels when the language changes', async () => {
    setLocale('vi');
    renderAccounts(<Dashboard profile={profile} />);
    expect(await screen.findByText('Tổng tài khoản')).toBeVisible();
    act(() => setLocale('en'));
    expect(screen.getByText('Total accounts')).toBeVisible();
    expect(screen.getByText('Everyday tasks')).toBeVisible();
    expect(screen.getByText('Invitation tracking')).toBeVisible();
    expect(screen.getByText('Recent activity')).toBeVisible();
    act(() => setLocale('vi'));
    expect(screen.getByText('Tổng tài khoản')).toBeVisible();
  });
  it('retries only failed resources and preserves loaded totals', async () => {
    let failed = true;
    mock.mockImplementation(async (path) => {
      if (path.includes('status=active') && failed) throw Error('offline');
      return fixture(path);
    });
    renderAccounts(<Dashboard profile={profile} />);
    await screen.findByRole('alert');
    expect(screen.getByText('Xem 1 mục bị ảnh hưởng')).toBeVisible();
    const before = mock.mock.calls.length;
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mock.mock.calls.slice(before).map(([path]) => path)).toEqual([
      '/api/organizations/org-a/users?page=1&limit=1&status=active',
    ]);
    expect(stat('Tổng tài khoản').getByText('12')).toBeVisible();
  });
  it('uses server totals and labels invitation statistics as a recent sample', async () => {
    renderAccounts(<Dashboard profile={profile} />);
    await waitFor(() => expect(stat('Đang hoạt động').getByText('10')).toBeVisible());
    expect(stat('Tổng tài khoản').getByText('12')).toBeVisible();
    expect(stat('Đã khóa').getByText('2')).toBeVisible();
    expect(card('Theo dõi lời mời').getAllByText('1')).toHaveLength(2);
    expect(card('Theo dõi lời mời').getByText('50%')).toBeVisible();
    expect(await screen.findByText('Tạo lời mời')).toBeVisible();
    expect(
      mock.mock.calls.every(
        ([path]) => !path.includes('/organizations/') || path.includes('/organizations/org-a/'),
      ),
    ).toBe(true);
  });
  it('ordinary employee requests only own sessions and never privileged datasets', async () => {
    const employee = {
      ...profile,
      organization: { ...profile.organization, role: 'EMPLOYEE' as const },
      permissions: { invite: false, grantHR: false },
    };
    renderAccounts(<Dashboard profile={employee} />);
    expect(await screen.findByText('Chrome')).toBeVisible();
    expect(stat('Phiên đăng nhập').getByText('1')).toBeVisible();
    expect(stat('Xác thực hai bước').getByText('Đã bật')).toBeVisible();
    expect(mock.mock.calls.map(([path]) => path)).toEqual(['/api/auth/sessions']);
    expect(screen.queryByRole('heading', { name: 'Cơ cấu vai trò' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hoạt động gần đây' })).not.toBeInTheDocument();
  });
  it('Manager reads scoped users but never invitations or audit', async () => {
    renderAccounts(
      <Dashboard
        profile={{
          ...profile,
          organization: { ...profile.organization, role: 'MANAGER' },
          permissions: { invite: false, grantHR: false, readUsers: true },
        }}
      />,
    );
    await waitFor(() => expect(stat('Đang hoạt động').getByText('10')).toBeVisible());
    expect(
      mock.mock.calls.some(
        ([path]) => path.includes('/invitations') || path.includes('/audit-events'),
      ),
    ).toBe(false);
    expect(
      screen.getByText('Theo dõi chỉ số và hoạt động của đội ngũ trong phạm vi truy cập.'),
    ).toBeVisible();
  });
  it('shows unavailable data as a dash instead of a fabricated zero', async () => {
    mock.mockImplementation(async (path) => {
      if (path.includes('status=active')) throw Error('offline');
      return fixture(path);
    });
    renderAccounts(<Dashboard profile={profile} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Một số dữ liệu chưa tải được');
    expect(stat('Đang hoạt động').getByText('—')).toBeVisible();
    expect(stat('Tổng tài khoản').getByText('12')).toBeVisible();
  });
  it('handles empty invitation data and retries failed data explicitly', async () => {
    let fail = true;
    mock.mockImplementation(async (path) => {
      if (path === '/api/auth/sessions' && fail) throw Error('offline');
      if (path.includes('/invitations')) return { items: [] };
      return fixture(path);
    });
    renderAccounts(<Dashboard profile={profile} />);
    await screen.findByRole('alert');
    expect(card('Theo dõi lời mời').getByText('Chưa có dữ liệu')).toBeVisible();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(stat('Tổng tài khoản').getByText('12')).toBeVisible();
  });
});

// Account regression cases exercise the explicitly expanded management area.
it('keeps system account activity separate from the executive overview', async () => {
  setLocale('en');
  render(<Dashboard profile={profile} />);
  const summary = screen.getByText('Accounts and system activity');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(screen.queryByRole('heading', { name: 'Common actions' })).not.toBeInTheDocument();
  expect(screen.getByText('Total accounts')).not.toBeVisible();
  fireEvent.click(summary);
  expect(await screen.findByText('Total accounts')).toBeVisible();
});

it.each(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] as const)(
  'limits %s home shortcuts to three daily tasks',
  (role) => {
    setLocale('en');
    render(
      <HomeLaunchpad profile={{ ...profile, organization: { ...profile.organization, role } }} />,
    );
    const shortcuts = within(screen.getByRole('navigation', { name: 'Application shortcuts' }));
    expect(shortcuts.getAllByRole('link')).toHaveLength(3);
    expect(shortcuts.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/attendance',
      '/admin/employees',
      ['ADMIN', 'HR'].includes(role)
        ? '/admin/payroll'
        : role === 'MANAGER'
          ? '/admin/reports'
          : '/admin/my-payslips',
    ]);
    expect(
      shortcuts.queryByRole('link', { name: /accounting|invitations|catalog|security/i }),
    ).toBeNull();
  },
);

function renderAccounts(ui: ReactElement) {
  const view = render(ui);
  const summary = view.container.querySelector('.dash-account-overview > summary');
  if (summary && !summary.parentElement?.hasAttribute('open')) fireEvent.click(summary);
  return view;
}
