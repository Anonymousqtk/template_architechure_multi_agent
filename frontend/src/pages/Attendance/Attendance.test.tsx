import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Attendance } from './Attendance';
import { request, type Profile } from '../../services/api';

vi.mock('../../services/api', async original => ({
  ...(await original<typeof import('../../services/api')>()),
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

it('opens the leave-type catalog directly without loading employee ledgers',async()=>{
  mock.mockImplementation(async path=>path===prefix+'/catalog'?{shifts:[],leaveTypes:[],departments:[]}:{});
  render(<Attendance profile={{...profile,organization:{...profile.organization,role:'HR'}}} view="leave-types"/>);
  expect(await screen.findByRole('heading',{name:'Thiết lập loại phép'})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Loại nghỉ phép'})).toBeInTheDocument();
  expect(screen.queryByRole('navigation',{name:'Chức năng chấm công'})).not.toBeInTheDocument();
  expect(mock.mock.calls.some(([path])=>path.includes('/employees?')||path.includes('/ledger?'))).toBe(false);
});

it('checks in to an office day without selecting a shift', async () => {
  mock.mockImplementation(async path => {
    if (path.startsWith(prefix + '/employees?')) return { items: [{ id: 'employee', name: 'Worker', code: 'E1', self: true, status: 'ACTIVE', attendanceMode: 'OFFICE' }] };
    if (path === prefix + '/catalog') return { shifts: [], leaveTypes: [] };
    if (path.includes('/ledger?')) return { schedule: [{
      id: 'office-day', attendanceKind: 'OFFICE', virtual: true, workDate: '2026-11-20', label: 'Giờ hành chính', shiftId: null,
      timeZone: 'Asia/Ho_Chi_Minh', startsAt: '2026-11-20T01:00:00Z', endsAt: '2026-11-20T10:00:00Z',
      canCheckIn: true, status: 'SCHEDULED', recordedMinutes: null, overtimeMinutes: null,
    }], leave: [], corrections: [], balances: [] };
    return {};
  });
  render(<Attendance profile={profile} />);
  expect(await screen.findByText('Giờ hành chính')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Check-in' }));
  await waitFor(() => expect(mock).toHaveBeenCalledWith(prefix + '/employees/employee/office-punch', { action: 'IN', workDate: '2026-11-20' }, undefined));
});

it('lets HR configure office hours and weekdays for a department', async () => {
  mock.mockImplementation(async path => {
    if (path.startsWith(prefix + '/employees?')) return { items: [] };
    if (path === prefix + '/catalog') return { shifts: [], leaveTypes: [], departments: [{ id: 'dept', name: 'Kế toán', mode: 'SHIFT', timeZone: 'Asia/Ho_Chi_Minh', startTime: '08:00', endTime: '17:00', weekdays: [1,2,3,4,5] }] };
    return {};
  });
  render(<Attendance profile={{ ...profile, organization: { ...profile.organization, role: 'HR' } }} view="policy" />);
  fireEvent.change(await screen.findByLabelText('Hình thức chấm công'), { target: { value: 'OFFICE' } });
  fireEvent.change(screen.getByLabelText('Giờ bắt đầu'), { target: { value: '07:30' } });
  fireEvent.click(screen.getByLabelText('Thứ bảy'));
  fireEvent.submit(screen.getByRole('button', { name: 'Lưu chế độ chấm công' }).closest('form')!);
  await waitFor(() => expect(mock).toHaveBeenCalledWith(prefix + '/departments/dept/policy', {
    mode: 'OFFICE', timeZone: 'Asia/Ho_Chi_Minh', startTime: '07:30', endTime: '17:00', weekdays: [1,2,3,4,5,6],
  }, 'PUT'));
});

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
