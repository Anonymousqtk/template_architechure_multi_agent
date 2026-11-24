import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setLocale } from '../../i18n';
import '@testing-library/jest-dom/vitest';
import { AccountProfile } from './AccountProfile';
import { request, type Profile } from '../../services/api';

vi.mock('../../services/api', async original => ({
  ...(await original<typeof import('../../services/api')>()),
  request: vi.fn(),
}));

vi.mock('../Users/Users', () => ({
  ProfileEditor: () => <div />,
  roleLabels: { EMPLOYEE: 'Nhân viên', HR: 'Nhân sự', MANAGER: 'Quản lý', ADMIN: 'Quản trị viên' },
}));

const mock = vi.mocked(request);
const profile: Profile = {
  user: { id: 'user-1', email: 'employee@example.test', fullName: 'Nguyen Van A' },
  organization: { id: 'org-1', name: 'Test Org', role: 'EMPLOYEE' },
  permissions: { invite: false, grantHR: false },
  deliveryMode: 'DEV_ONLY',
};
beforeEach(() => {
  mock.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AccountProfile avatar', () => {
  it('updates account labels and validation messages when changing language', async () => {
    setLocale('vi');
    mock.mockResolvedValue({ avatarUrl: null } as never);
    render(<AccountProfile profile={profile} />);
    const input = await screen.findByLabelText('Chọn ảnh đại diện');
    fireEvent.change(input, { target: { files: [new File(['bad'], 'avatar.gif', { type: 'image/gif' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ chấp nhận');
    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Profile & Account' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Only JPG or PNG images are accepted.');
    expect(screen.getByRole('img', { name: 'Profile photo of Nguyen Van A' })).toBeVisible();
    expect(screen.getByText('Nguyen Van A')).toBeVisible();
    act(() => setLocale('vi'));
  });
  it('shows upload for accounts without an employee record and refreshes the account avatar', async () => {
    const avatarUrl = '/api/auth/profile/avatar/content?v=profile-avatars%2Favatar.png';
    mock.mockResolvedValueOnce({ avatarUrl: null } as never);
    mock.mockResolvedValueOnce({ avatarUrl } as never);

    render(<AccountProfile profile={profile} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật ảnh' }));
    expect(screen.getByText('JPG hoặc PNG · tối đa 10MB')).toBeInTheDocument();
    const input = screen.getByLabelText('Chọn ảnh đại diện');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'avatar.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mock).toHaveBeenNthCalledWith(
        2,
        '/api/auth/profile/avatar',
        expect.objectContaining({ fileName: 'avatar.png', mimeType: 'image/png', contentBase64: expect.any(String) }),
        'POST'
      );
    });
    expect(await screen.findByText('Đã cập nhật ảnh đại diện.')).toHaveAttribute('role', 'status');
    expect(mock).toHaveBeenNthCalledWith(1, '/api/auth/profile/avatar');

    const avatarButton = screen.getByRole('button', { name: 'Xem ảnh đại diện của Nguyen Van A' });
    expect(avatarButton.querySelector('img')?.getAttribute('src')).toBe(avatarUrl);
    avatarButton.focus();
    fireEvent.click(avatarButton);
    const viewer = await screen.findByRole('dialog', { name: 'Ảnh đại diện của Nguyen Van A' });
    expect(viewer.tagName).toBe('DIALOG');
    expect(viewer).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to ảnh' }));
    expect(screen.getByText('125%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ ảnh' }));
    expect(screen.getAllByText('100%')[0]).toBeVisible();
    fireEvent(viewer, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(avatarButton).toHaveFocus();
  });
});
