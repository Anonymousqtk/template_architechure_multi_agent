import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
  });

  const dummyEmployee = {
    id: '12345678-1234-1234-1234-123456789abc',
    employeeCode: 'EMP-001',
    fullName: 'Nguyễn Văn A',
    departmentName: 'Phòng Kỹ thuật',
    positionTitle: 'Kỹ sư phần mềm',
  };

  it('renders trigger button with accessible label', () => {
    render(
      <EmployeeQrBadge
        employee={dummyEmployee}
        orgId="org-123"
        orgName="Công ty Cổ phần ManagerHR"
      />
    );

    const trigger = screen.getByRole('button', { name: /Xem mã QR thẻ nhân viên của Nguyễn Văn A/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens dialog with QR code and card information when clicked', () => {
    render(
      <EmployeeQrBadge
        employee={dummyEmployee}
        orgId="org-123"
        orgName="Công ty Cổ phần ManagerHR"
      />
    );

    const trigger = screen.getByRole('button', { name: /Xem mã QR thẻ nhân viên của Nguyễn Văn A/i });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: /Mã QR thẻ nhân viên của Nguyễn Văn A/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Công ty Cổ phần ManagerHR')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('EMP-001')).toBeInTheDocument();
    expect(screen.getByText('Kỹ sư phần mềm')).toBeInTheDocument();

    // Close button works
    const closeBtn = screen.getByRole('button', { name: 'Đóng' });
    fireEvent.click(closeBtn);
    expect(dialog).not.toBeInTheDocument();
  });

  it('copies link to clipboard when "Sao chép link" is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <EmployeeQrBadge
        employee={dummyEmployee}
        orgId="org-123"
        orgName="Công ty Cổ phần ManagerHR"
      />
    );

    const trigger = screen.getByRole('button', { name: /Xem mã QR/i });
    fireEvent.click(trigger);

    const copyBtn = screen.getByRole('button', { name: /Sao chép liên kết/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
    expect(await screen.findByText('✓ Đã sao chép')).toBeInTheDocument();
  });
});
