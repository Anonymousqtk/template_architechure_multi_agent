import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmployeeCardPage } from './EmployeeCardPage';

describe('EmployeeCardPage component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders error message when URL parameters are missing', () => {
    window.history.pushState(null, '', '/employee-card');

    render(<EmployeeCardPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Thiếu thông tin tổ chức hoặc mã nhân viên/i)).toBeInTheDocument();
  });

  it('fetches and renders digital card with bank details when params present', async () => {
    window.history.pushState(null, '', '/employee-card?org=org-abc&code=EMP-001');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        employee: {
          id: 'emp-1',
          organizationId: 'org-abc',
          organizationName: 'Tập đoàn ABC',
          employeeCode: 'EMP-001',
          fullName: 'Trần Văn B',
          avatarUrl: null,
          hireDate: '2025-01-15',
          employmentStatus: 'ACTIVE',
          departmentName: 'Phòng Kế toán',
          positionTitle: 'Chuyên viên tài chính',
          phone: '0901234567',
          personalEmail: 'tranvanb@example.com',
          bankName: 'Vietcombank',
          bankAccountNumber: '0123456789',
          bankAccountName: 'TRAN VAN B',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<EmployeeCardPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Trần Văn B')).toBeInTheDocument();
    });

    expect(screen.getByText('Tập đoàn ABC')).toBeInTheDocument();
    expect(screen.getByText('EMP-001')).toBeInTheDocument();
    expect(screen.getByText('Chuyên viên tài chính')).toBeInTheDocument();
    expect(screen.getByText('Phòng Kế toán')).toBeInTheDocument();
    expect(screen.getByText('Vietcombank')).toBeInTheDocument();
    expect(screen.getByText('0123456789')).toBeInTheDocument();
    expect(screen.getByText('TRAN VAN B')).toBeInTheDocument();
  });
});
