import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { setLocale } from '../../../i18n';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmployeeQrBadge } from './EmployeeQrBadge';

describe('EmployeeQrBadge component', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const dummyEmployee = {
    id: '12345678-1234-1234-1234-123456789abc',
    employeeCode: 'EMP-001',
    fullName: 'Nguyễn Văn A',
    departmentName: 'Phòng Kỹ thuật',
    positionTitle: 'Kỹ sư phần mềm',
  };
  const orgId = '22345678-1234-1234-1234-123456789abc';
  const cardUrl = `${window.location.origin}/employee-card#org=${orgId}&code=EMP-001`;

  it('updates QR controls without translating employee data', () => {
    setLocale('vi');
    render(<EmployeeQrBadge employee={dummyEmployee} orgId={orgId} />);
    fireEvent.click(screen.getByRole('button', { name: /Xem mã QR thẻ nhân viên/ }));
    act(() => setLocale('en'));
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeVisible();
    expect(screen.getByText('Nguyễn Văn A')).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('renders trigger button with accessible label', () => {
    render(<EmployeeQrBadge employee={dummyEmployee} orgId={orgId} orgName="Công ty Cổ phần ManagerHR" />);
    expect(screen.getByRole('button', { name: /Xem mã QR thẻ nhân viên của Nguyễn Văn A/i })).toBeInTheDocument();
  });

  it('opens the modal with a QR and displays the local-only URL', () => {
    render(<EmployeeQrBadge employee={dummyEmployee} orgId={orgId} orgName="Công ty Cổ phần ManagerHR" />);
    fireEvent.click(screen.getByRole('button', { name: /Xem mã QR thẻ nhân viên của Nguyễn Văn A/i }));

    const dialog = screen.getByRole('dialog', { name: /Mã QR thẻ nhân viên của Nguyễn Văn A/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Công ty Cổ phần ManagerHR')).toBeInTheDocument();
    expect(screen.getByText('Kỹ sư phần mềm')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Mã QR truy cập hồ sơ/i })).toBeInTheDocument();
    expect(screen.getByText(cardUrl)).toBeInTheDocument();
    expect(screen.getByText(/localhost chỉ dùng trên thiết bị này/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(dialog).not.toBeInTheDocument();
  });

  it('copies the displayed URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<EmployeeQrBadge employee={dummyEmployee} orgId={orgId} />);
    fireEvent.click(screen.getByRole('button', { name: /Xem mã QR/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép URL' }));

    expect(writeText).toHaveBeenCalledWith(cardUrl);
    expect(await screen.findByText('✓ Đã sao chép')).toBeInTheDocument();
  });
});
