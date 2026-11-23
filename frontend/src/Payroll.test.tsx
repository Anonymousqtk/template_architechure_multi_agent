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

it('renders accounting and reconciliation tab and allows running reconciliation', async () => {
  mock.mockImplementation(async (path: string, options?: unknown, method?: string) => {
    if (path.endsWith('/payroll/periods')) {
      return { items: [{ ...mockPeriod, status: 'APPROVED' }], total: 1 };
    }
    if (path.includes('/payroll/periods/period-1/slips')) {
      return { items: [mockSlip], total: 1 };
    }
    if (path.includes('/payroll/periods/period-1') && !path.includes('/reconcile') && !path.includes('/accounting') && !path.includes('/liabilities')) {
      return { period: { ...mockPeriod, status: 'APPROVED' }, summary: mockSummary };
    }
    if (path.includes('/payroll/periods/period-1/reconciliation')) {
      return {
        reconciliation: {
          id: 'rec-1',
          periodId: 'period-1',
          reconciliationDate: '2026-02-05',
          status: 'RECONCILED',
          totalExpectedSlips: 1,
          totalExpectedAmount: '22500000.00',
          totalDisbursedSlips: 1,
          totalDisbursedAmount: '22500000.00',
          differenceAmount: '0.00',
          matchedCount: 1,
          discrepancyCount: 0,
        },
        discrepancies: [],
      };
    }
    if (path.includes('/payroll/periods/period-1/accounting/entries')) {
      return {
        items: [
          {
            id: 'entry-1',
            entryNumber: 'PKT-KY-2026-01-01',
            entryDate: '2026-01-31',
            status: 'POSTED',
            totalDebit: '23000000.00',
            totalCredit: '23000000.00',
            description: 'Bút toán chi phí lương',
          },
        ],
      };
    }
    if (path.includes('/payroll/periods/period-1/liabilities')) {
      return {
        liability: {
          id: 'liab-1',
          periodId: 'period-1',
          periodCode: 'KY-2026-01',
          periodName: 'Kỳ lương Tháng 1/2026',
          beginningBalance: '0.00',
          incurredAmount: '22500000.00',
          paidAmount: '22500000.00',
          endingBalance: '0.00',
          status: 'SETTLED',
        },
      };
    }
    if (path.includes('/payroll/periods/period-1/reconcile')) {
      return { ok: true, status: 'RECONCILED' };
    }
    return {};
  });

  render(<Payroll profile={adminProfile} view="accounting" />);

  expect(await screen.findByText('Đối chiếu & Hạch toán')).toBeInTheDocument();
  expect(await screen.findByText('🔍 Chạy đối chiếu')).toBeInTheDocument();
  expect(await screen.findByText('📝 Tạo bút toán kế toán')).toBeInTheDocument();

  // Trigger reconciliation
  const reconcileBtn = screen.getByText('🔍 Chạy đối chiếu');
  fireEvent.click(reconcileBtn);

  await waitFor(() => {
    expect(mock).toHaveBeenCalledWith('/api/organizations/org-1/payroll/periods/period-1/reconcile', {}, 'POST');
  });
});

it('renders compliance & statutory reporting tab and executes compliance scan', async () => {
  mock.mockImplementation(async (path: string, options?: unknown, method?: string) => {
    if (path.endsWith('/payroll/periods')) {
      return { items: [mockPeriod] };
    }
    if (path.includes('/payroll/periods/period-1/slips')) {
      return { items: [mockSlip] };
    }
    if (path.includes('/payroll/periods/period-1')) {
      return { period: mockPeriod, summary: mockSummary };
    }
    if (path.includes('/compliance/rules')) {
      return {
        rules: [
          {
            id: 'rule-1',
            ruleType: 'PIT_DEDUCTIONS',
            ruleCode: 'PIT_DEDUCTIONS_2020',
            name: 'Mức giảm trừ gia cảnh thuế TNCN',
            effectiveFrom: '2020-07-01',
            effectiveTo: null,
            parameters: { personal: 11000000, dependent: 4400000 },
            legalReference: 'Nghị quyết 954/2020/UBTVQH14',
            isVerified: true,
            notes: null,
          },
        ],
      };
    }
    if (path.includes('/compliance/pit/period/period-1')) {
      return {
        summary: {
          totalEmployees: 1,
          totalGrossPay: '23000000.00',
          totalTaxableIncome: '23000000.00',
          totalPersonalDeduction: '11000000.00',
          totalDependentDeduction: '0.00',
          totalInsuranceDeduction: '0.00',
          totalAssessableIncome: '12000000.00',
          totalCalculatedTax: '1050000.00',
          totalWithheldTax: '500000.00',
          totalVariance: '550000.00',
        },
        employees: [],
      };
    }
    if (path.includes('/compliance/insurance/period/period-1')) {
      return {
        summary: {
          totalParticipants: 1,
          totalSiSalaryFund: '22000000.00',
          totalEmployeePortion: '2310000.00',
          totalEmployerPortion: '4730000.00',
          totalTradeUnion: '440000.00',
          totalPayableInsuranceAgency: '7040000.00',
          totalCostToCompany: '5170000.00',
        },
        rates: {},
        employees: [],
      };
    }
    if (path.includes('/compliance/analytics/period/period-1')) {
      return {
        analytics: {
          employeeCount: 1,
          grossPayroll: '23000000.00',
          proratedBaseSalary: '22000000.00',
          allowances: '1000000.00',
          bonuses: '0.00',
          overtimePay: '0.00',
          employerSocialInsurance: '4730000.00',
          employerTradeUnion: '440000.00',
          totalCostToCompany: '28170000.00',
          financialMetrics: {
            accruedExpense: '28170000.00',
            payableLiability: '22500000.00',
            disbursedPayment: '0.00',
            remainingUnpaid: '22500000.00',
          },
          momComparison: { previousGross: '0.00', deltaAmount: '23000000.00', percentChange: 0 },
          departmentDistribution: [],
        },
      };
    }
    if (path.includes('/compliance/anomalies')) {
      return { anomalies: [] };
    }
    if (path.includes('/compliance/reports')) {
      return { reports: [] };
    }
    if (path.includes('/compliance/check/period-1')) {
      return { success: true, count: 0, anomalies: [] };
    }
    return {};
  });

  render(<Payroll profile={adminProfile} view="compliance" />);

  expect(await screen.findByText('Tuân thủ & Báo cáo')).toBeInTheDocument();
  expect(await screen.findByText('🛡 Quét kiểm tra tuân thủ')).toBeInTheDocument();
  expect(await screen.findByText('📜 Nạp quy tắc chuẩn VN')).toBeInTheDocument();

  // Trigger compliance scan
  const scanBtn = screen.getByText('🛡 Quét kiểm tra tuân thủ');
  fireEvent.click(scanBtn);

  await waitFor(() => {
    expect(mock).toHaveBeenCalledWith('/api/organizations/org-1/payroll/compliance/check/period-1', {}, 'POST');
  });
});
