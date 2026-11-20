import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Payroll } from './Payroll';
import { request, type Profile } from './api';

vi.mock('./api', async original => ({
  ...await original<typeof import('./api')>(),
  request: vi.fn(),
}));

const mock = vi.mocked(request);

const adminProfile: Profile = {
  user: { id: 'u-1', email: 'admin@payroll.test', fullName: 'Admin User' },
  organization: { id: 'org-1', name: 'Payroll Org', role: 'ADMIN' },
  permissions: { invite: true, grantHR: true, readUsers: true, manageUsers: true, assignRoles: true, viewAudit: true, manageOrg: true },
  deliveryMode: 'DEV_ONLY',
};

const employeeProfile: Profile = {
  user: { id: 'u-2', email: 'emp@payroll.test', fullName: 'Employee User' },
  organization: { id: 'org-1', name: 'Payroll Org', role: 'EMPLOYEE' },
  permissions: { invite: false, grantHR: false, readUsers: false, manageUsers: false, assignRoles: false, viewAudit: false, manageOrg: false },
  deliveryMode: 'DEV_ONLY',
};

const mockPeriod = {
  id: 'period-1',
  code: 'KY-2026-01',
  name: 'Kỳ lương Tháng 1/2026',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  paymentDate: '2026-02-05',
  standardWorkingDays: 22,
  status: 'DRAFT' as const,
  notes: null,
};

const mockSummary = {
  totalSlips: 1,
  totalGross: '23000000.00',
  totalNet: '22500000.00',
  totalEmployees: 1,
};

const mockSlip = {
  id: 'slip-1',
  periodId: 'period-1',
  employeeId: 'emp-1',
  employeeCode: 'NV-001',
  fullName: 'Nguyen Van A',
  departmentName: 'Kỹ thuật',
  positionTitle: 'Lập trình viên',
  salaryMode: 'GROSS' as const,
  standardDays: 22,
  actualWorkingDays: 22,
  paidLeaveDays: 0,
  baseSalary: '22000000.00',
  proratedBaseSalary: '22000000.00',
  totalAllowances: '1000000.00',
  totalBonuses: '0.00',
  totalDeductions: '500000.00',
  grossPay: '23000000.00',
  netPay: '22500000.00',
  status: 'DRAFT',
  periodName: 'Kỳ lương Tháng 1/2026',
  periodCode: 'KY-2026-01',
  periodStartDate: '2026-01-01',
  periodEndDate: '2026-01-31',
};

const mockItems = [
  { id: 'i-1', componentName: 'Lương cơ bản', type: 'BASE_SALARY', amount: '22000000.00', notes: null },
  { id: 'i-2', componentName: 'Phụ cấp ăn trưa', type: 'ALLOWANCE', amount: '1000000.00', notes: null },
  { id: 'i-3', componentName: 'Đoàn phí', type: 'DEDUCTION', amount: '500000.00', notes: null },
];

afterEach(() => {
  cleanup();
  mock.mockReset();
  vi.restoreAllMocks();
});

it('renders payroll period summary and allows draft calculation for HR/Admin', async () => {
  mock.mockImplementation(async (path: string) => {
    if (path.endsWith('/payroll/periods')) {
      return { items: [mockPeriod] };
    }
    if (path.includes('/payroll/periods/period-1') && !path.includes('/slips') && !path.includes('/calculate')) {
      return { period: mockPeriod, summary: mockSummary };
    }
    if (path.includes('/payroll/periods/period-1/slips')) {
      return { items: [mockSlip] };
    }
    if (path.includes('/payroll/periods/period-1/calculate')) {
      return { ok: true, generatedSlips: 1 };
    }
    return {};
  });

  render(<Payroll profile={adminProfile} view="periods" />);

  expect(await screen.findByText('Kỳ lương Tháng 1/2026 (KY-2026-01) — Bản nháp')).toBeInTheDocument();
  expect(await screen.findByText('Tổng quỹ lương Gross')).toBeInTheDocument();
  expect(await screen.findByText('NV-001')).toBeInTheDocument();
  expect(await screen.findByText('Nguyen Van A')).toBeInTheDocument();

  // Trigger calculate draft
  const calcBtn = screen.getByRole('button', { name: /Tính toán bảng lương nháp/i });
  fireEvent.click(calcBtn);

  await waitFor(() => {
    expect(mock).toHaveBeenCalledWith(
      '/api/organizations/org-1/payroll/periods/period-1/calculate',
      {}
    );
  });
  expect(await screen.findByText(/Đã tính toán xong bảng lương nháp/i)).toBeInTheDocument();
});

it('renders salary components catalog and allows creating new allowance', async () => {
  const mockComponent = {
    id: 'comp-1',
    code: 'LUNCH',
    name: 'Phụ cấp ăn trưa',
    type: 'ALLOWANCE' as const,
    calculationType: 'FIXED' as const,
    isTaxable: false,
    isStatutory: false,
    defaultAmount: '730000.00',
    active: true,
    description: 'Cơm trưa',
  };

  mock.mockImplementation(async (path: string) => {
    if (path.endsWith('/payroll/components')) {
      return { items: [mockComponent] };
    }
    return {};
  });

  render(<Payroll profile={adminProfile} view="components" />);

  expect(await screen.findByText('LUNCH')).toBeInTheDocument();
  expect(await screen.findByText('Phụ cấp ăn trưa')).toBeInTheDocument();

  const addBtn = screen.getByRole('button', { name: /\+ Thêm cấu phần mới/i });
  fireEvent.click(addBtn);

  expect(screen.getByText('Thêm cấu phần lương mới')).toBeInTheDocument();
});

it('allows employee to view self-service payslip history and detail breakdown', async () => {
  mock.mockImplementation(async (path: string) => {
    if (path.endsWith('/payroll/my-slips')) {
      return { items: [mockSlip], total: 1 };
    }
    if (path.includes('/payroll/slips/slip-1')) {
      return { slip: mockSlip, items: mockItems };
    }
    return {};
  });

  render(<Payroll profile={employeeProfile} view="my-slips" />);

  expect(await screen.findByText('Phiếu lương cá nhân')).toBeInTheDocument();
  expect(await screen.findByText('Kỳ lương Tháng 1/2026')).toBeInTheDocument();

  // Click View Detail
  const viewDetailBtn = await screen.findByRole('button', { name: 'Xem chi tiết' });
  fireEvent.click(viewDetailBtn);

  await waitFor(() => {
    expect(mock).toHaveBeenCalledWith('/api/organizations/org-1/payroll/slips/slip-1');
  });

  expect(await screen.findByText('Phiếu lương: Nguyen Van A')).toBeInTheDocument();
  expect(await screen.findByText('Chi tiết các khoản thu nhập & khấu trừ')).toBeInTheDocument();
  expect(await screen.findByText('Đoàn phí')).toBeInTheDocument();
  expect(await screen.findByText('THỰC LĨNH (NET):')).toBeInTheDocument();
});
