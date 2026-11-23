import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReportingCenter } from './ReportingCenter';
import { request, type Profile } from './api';

vi.mock('./api', async original => ({
  ...await original<typeof import('./api')>(),
  request: vi.fn(),
}));

const mock = vi.mocked(request);

const adminProfile: Profile = {
  user: { id: 'u-1', email: 'admin@acme.test', fullName: 'Admin User' },
  organization: { id: 'org-1', name: 'Acme Corp', role: 'ADMIN' },
  permissions: { invite: true, grantHR: true, readUsers: true, manageUsers: true, assignRoles: true, viewAudit: true, manageOrg: true },
  deliveryMode: 'DEV_ONLY',
};

const mockReports = [
  {
    id: 'r-1',
    code: 'RPT-EMP-01',
    category: 'EMPLOYEE' as const,
    name: 'Báo cáo nhân sự & biến động nhân sự',
    description: 'Tổng hợp danh sách nhân viên, trạng thái hoạt động...',
    minRole: 'MANAGER',
    displayOrder: 1,
    supportedFilters: ['departmentId', 'positionId', 'status', 'contractType', 'search']
  },
  {
    id: 'r-2',
    code: 'RPT-ORG-01',
    category: 'ORGANIZATION' as const,
    name: 'Báo cáo cơ cấu tổ chức & phòng ban',
    description: 'Thống kê sơ đồ phân cấp phòng ban...',
    minRole: 'MANAGER',
    displayOrder: 2,
    supportedFilters: ['departmentId', 'isActive']
  },
  {
    id: 'r-3',
    code: 'RPT-ATT-01',
    category: 'ATTENDANCE' as const,
    name: 'Báo cáo tổng hợp chấm công & ca làm việc',
    description: 'Thống kê chi tiết ca làm việc...',
    minRole: 'EMPLOYEE',
    displayOrder: 3,
    supportedFilters: ['startDate', 'endDate', 'departmentId', 'employeeId', 'status', 'search']
  },
  {
    id: 'r-4',
    code: 'RPT-LEAVE-01',
    category: 'LEAVE' as const,
    name: 'Báo cáo tình hình nghỉ phép & số dư phép',
    description: 'Theo dõi hạn mức phép, số ngày đã sử dụng...',
    minRole: 'EMPLOYEE',
    displayOrder: 4,
    supportedFilters: ['startDate', 'endDate', 'departmentId', 'leaveTypeId', 'employeeId', 'status', 'search']
  }
];

const mockEmpRoster = {
  metrics: {
    totalEmployees: 25,
    activeEmployees: 22,
    onLeaveEmployees: 2,
    terminatedEmployees: 1,
    averageTenureMonths: 18.5,
    departmentBreakdown: [{ name: 'Kỹ thuật', count: 15 }, { name: 'Kinh doanh', count: 10 }],
    contractBreakdown: [{ type: 'INDEFINITE', count: 20 }, { type: 'FIXED_TERM', count: 5 }]
  },
  pagination: {
    page: 1,
    pageSize: 20,
    totalRows: 25,
    totalPages: 2
  },
  items: [
    {
      id: 'e-1',
      employeeCode: 'NV-001',
      fullName: 'Nguyen Van Dev',
      departmentName: 'Kỹ thuật',
      positionTitle: 'Kỹ sư phần mềm',
      employmentStatus: 'ACTIVE',
      contractType: 'INDEFINITE',
      contractNumber: 'HD-001',
      hireDate: '2023-01-10',
      tenureMonths: 24,
      phone: '0901234567',
      personalEmail: 'dev@test.com'
    }
  ]
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('renders Reporting Center title, tabs and report catalog cards', async () => {
  mock.mockImplementation(async (path: string) => {
    if (path.includes('/reports/catalog')) return { reports: mockReports } as any;
    if (path.includes('/departments')) return { departments: [] } as any;
    return {} as any;
  });

  render(<ReportingCenter profile={adminProfile} />);

  expect(screen.getByText('Trung tâm báo cáo & Thống kê nhân sự')).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByText('Báo cáo nhân sự & biến động nhân sự')).toBeInTheDocument();
    expect(screen.getByText('Báo cáo cơ cấu tổ chức & phòng ban')).toBeInTheDocument();
    expect(screen.getByText('Báo cáo tổng hợp chấm công & ca làm việc')).toBeInTheDocument();
    expect(screen.getByText('Báo cáo tình hình nghỉ phép & số dư phép')).toBeInTheDocument();
  });
});

it('opens report view and displays KPI metrics and data table', async () => {
  mock.mockImplementation(async (path: string) => {
    if (path.includes('/reports/catalog')) return { reports: mockReports } as any;
    if (path.includes('/departments')) return { departments: [{ id: 'd-1', name: 'Kỹ thuật', code: 'DEV' }] } as any;
    if (path.includes('/reports/emp-roster')) return mockEmpRoster as any;
    if (path.includes('/reports/templates')) return { templates: [] } as any;
    return {} as any;
  });

  render(<ReportingCenter profile={adminProfile} />);

  await waitFor(() => {
    expect(screen.getByText('Báo cáo nhân sự & biến động nhân sự')).toBeInTheDocument();
  });

  // Click on EMP report card
  fireEvent.click(screen.getByText('Báo cáo nhân sự & biến động nhân sự'));

  // Should display active report header & metrics
  await waitFor(() => {
    expect(screen.getByText('Xuất dữ liệu CSV (Excel)')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument(); // totalEmployees
    expect(screen.getByText('22')).toBeInTheDocument(); // activeEmployees
    expect(screen.getByText('Nguyen Van Dev')).toBeInTheDocument();
    expect(screen.getByText('NV-001')).toBeInTheDocument();
  });

  // Should have back button
  expect(screen.getByText('← Danh mục báo cáo')).toBeInTheDocument();
});

it('displays export audit tab and table when clicking Nhật ký xuất báo cáo', async () => {
  mock.mockImplementation(async (path: string) => {
    if (path.includes('/reports/catalog')) return { reports: mockReports } as any;
    if (path.includes('/departments')) return { departments: [] } as any;
    if (path.includes('/reports/export-audit')) {
      return {
        auditLogs: [
          {
            id: 'a-1',
            reportCode: 'RPT-EMP-01',
            format: 'CSV',
            rowCount: 25,
            filters: {},
            exportedBy: 'u-1',
            userName: 'Admin User',
            userEmail: 'admin@acme.test',
            exportedAt: '2026-03-10T08:00:00Z'
          }
        ]
      } as any;
    }
    return {} as any;
  });

  render(<ReportingCenter profile={adminProfile} />);

  await waitFor(() => {
    expect(screen.getByText('Nhật ký xuất báo cáo')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText('Nhật ký xuất báo cáo'));

  await waitFor(() => {
    expect(screen.getByText('25 dòng')).toBeInTheDocument();
    expect(screen.getByText('admin@acme.test')).toBeInTheDocument();
  });
});

it('renders PAYROLL category tab and displays payroll summary report data', async () => {
  const extendedMockReports = [
    ...mockReports,
    {
      id: 'r-5',
      code: 'RPT-PAY-01',
      category: 'PAYROLL' as const,
      name: 'Bảng lương tổng hợp & chi tiết theo kỳ',
      description: 'Tổng hợp bảng lương chi tiết từng nhân viên theo kỳ...',
      minRole: 'MANAGER',
      displayOrder: 5,
      supportedFilters: ['periodId', 'departmentId', 'status', 'search']
    },
    {
      id: 'r-6',
      code: 'RPT-ACC-01',
      category: 'ACCOUNTING' as const,
      name: 'Báo cáo phân bổ chi phí lương theo phòng ban & đơn vị',
      description: 'Phân bổ chi phí lương theo đơn vị tổ chức và tài khoản VAS...',
      minRole: 'HR',
      displayOrder: 8,
      supportedFilters: ['periodId', 'departmentId']
    }
  ];

  const mockPeriods = [
    { id: 'p-1', code: 'PR-2026-03', name: 'Kỳ lương Tháng 3/2026', status: 'CLOSED' }
  ];

  const mockPayrollSummary = {
    period: { id: 'p-1', code: 'PR-2026-03', name: 'Kỳ lương Tháng 3/2026', status: 'CLOSED' },
    metrics: {
      totalGrossPay: '50000000.00',
      totalNetPay: '43500000.00',
      totalDeductions: '6500000.00',
      totalAllowances: '2000000.00',
      totalBonuses: '3000000.00',
      slipCount: 2,
      employeeCount: 2
    },
    pagination: { page: 1, pageSize: 20, totalRows: 2, totalPages: 1 },
    items: [
      {
        id: 's-1',
        employeeCode: 'NV-001',
        fullName: 'Nguyen Van Dev',
        departmentName: 'Kỹ thuật',
        baseSalary: '25000000.00',
        actualWorkingDays: '22',
        standardDays: '22',
        grossPay: '25000000.00',
        totalAllowances: '1000000.00',
        totalBonuses: '1500000.00',
        totalDeductions: '3250000.00',
        netPay: '21750000.00',
        status: 'PAID'
      }
    ]
  };

  mock.mockImplementation(async (path: string) => {
    if (path.includes('/reports/catalog')) return { reports: extendedMockReports } as any;
    if (path.includes('/payroll/periods')) return { periods: mockPeriods } as any;
    if (path.includes('/departments')) return { departments: [] } as any;
    if (path.includes('/reports/payroll-summary')) return mockPayrollSummary as any;
    return {} as any;
  });

  render(<ReportingCenter profile={adminProfile} />);

  await waitFor(() => {
    expect(screen.getByText('Tiền lương (PAY)')).toBeInTheDocument();
    expect(screen.getByText('Hạch toán & Công nợ (ACC)')).toBeInTheDocument();
  });

  // Switch to PAYROLL tab
  fireEvent.click(screen.getByText('Tiền lương (PAY)'));

  await waitFor(() => {
    expect(screen.getByText('Bảng lương tổng hợp & chi tiết theo kỳ')).toBeInTheDocument();
  });

  // Click on RPT-PAY-01 card
  fireEvent.click(screen.getByText('Bảng lương tổng hợp & chi tiết theo kỳ'));

  await waitFor(() => {
    expect(screen.getByText('Tổng thực lĩnh (Net)')).toBeInTheDocument();
    expect(screen.getByText('Tổng lương Gross')).toBeInTheDocument();
    expect(screen.getByText('Nguyen Van Dev')).toBeInTheDocument();
    expect(screen.getByText('2 phiếu lương')).toBeInTheDocument();
  });
});
