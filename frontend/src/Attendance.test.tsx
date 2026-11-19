import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Attendance } from './Attendance';
import { request, type Profile } from './api';

vi.mock('./api', async original => ({
  ...(await original<typeof import('./api')>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
const profile: Profile = {
  user: { id: 'actor', email: 'worker@example.test', fullName: 'Worker' },
  organization: { id: 'org-id', name: 'Organization', role: 'EMPLOYEE' },
  permissions: { invite: false, grantHR: false },
  deliveryMode: 'DEV_ONLY',
};
const prefix = '/api/organizations/org-id/attendance';
afterEach(() => { cleanup(); mock.mockReset(); });

it('shows the recorded schedule and sends only the check-in action', async () => {
  mock.mockImplementation(async path => {
    if (path.startsWith(prefix + '/employees?')) return { items: [{ id: 'employee', name: 'Worker', code: 'E1', self: true, status: 'ACTIVE' }] };
    if (path === prefix + '/catalog') return { shifts: [], leaveTypes: [] };
    if (path.includes('/ledger?')) return { schedule: [{
      id: 'schedule', workDate: '2026-11-20', label: 'Ca chính', shiftId: 'shift', timeZone: 'Asia/Bangkok',
      startsAt: '2026-11-20T01:00:00Z', endsAt: '2026-11-20T09:00:00Z', canCheckIn: true,
      status: 'SCHEDULED', recordedMinutes: null, overtimeMinutes: null,
    }], leave: [], corrections: [], balances: [] };
    return {};
  });
  render(<Attendance profile={profile} />);
  expect(screen.queryByRole('button', { name: 'Ca và loại phép' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Check-in' }));
  await waitFor(() => expect(mock).toHaveBeenCalledWith(prefix + '/punches/schedule', { action: 'IN' }, undefined));
});

it('requires an explicit debit when a scoped manager approves tracked leave', async () => {
  mock.mockImplementation(async path => {
    if (path.startsWith(prefix + '/employees?')) return { items: [{ id: 'employee', name: 'Worker', code: 'E1', self: false, status: 'ACTIVE' }] };
    if (path === prefix + '/catalog') return { shifts: [], leaveTypes: [] };
    if (path.includes('/ledger?')) return { schedule: [], corrections: [], balances: [], leave: [{
      id: 'leave', name: 'Phép năm', startsAt: '2026-11-23T01:00:00Z', endsAt: '2026-11-23T09:00:00Z',
      status: 'PENDING', tracksBalance: true, chargeMinutes: null, createdBy: 'worker',
    }] };
    return {};
  });
  render(<Attendance profile={{ ...profile, organization: { ...profile.organization, role: 'MANAGER' } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Đơn và số dư phép' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
  const minutes = screen.getByLabelText('Số phút trừ theo chính sách đã duyệt');
  expect(minutes).toBeRequired();
  expect(minutes).toHaveValue(null);
  fireEvent.change(minutes, { target: { value: '240' } });
  fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đã xác nhận chính sách' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(mock).toHaveBeenCalledWith(prefix + '/leave/leave/review', {
    action: 'APPROVE', chargeMinutes: 240, reason: 'Đã xác nhận chính sách',
  }, undefined));
});
