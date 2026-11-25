import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setLocale } from '../../i18n';
import '@testing-library/jest-dom/vitest';
import { Employees } from './Employees';
import { request, type Profile } from '../../services/api';
import type {
  Employee,
  EmployeeContract,
  WorkHistory,
} from '../../features/employees/employee-types';

vi.mock('../../services/api', async (original) => ({
  ...(await original<typeof import('../../services/api')>()),
  request: vi.fn(),
}));

const mock = vi.mocked(request);

const adminProfile: Profile = {
  user: { id: 'admin-1', email: 'admin@example.test', fullName: 'Admin User' },
  organization: { id: 'org-test', name: 'Test Org', role: 'ADMIN' },
  permissions: {
    invite: true,
    grantHR: true,
    readUsers: true,
    manageUsers: true,
    assignRoles: true,
    viewAudit: true,
    manageOrg: true,
  },
  deliveryMode: 'DEV_ONLY',
};

const managerProfile: Profile = {
  user: { id: 'manager-1', email: 'manager@example.test', fullName: 'Manager User' },
  organization: { id: 'org-test', name: 'Test Org', role: 'MANAGER' },
  permissions: {
    invite: false,
    grantHR: false,
    readUsers: true,
    manageUsers: false,
    assignRoles: false,
    viewAudit: false,
    manageOrg: false,
  },
  deliveryMode: 'DEV_ONLY',
};

const employeeProfile: Profile = {
  user: { id: 'emp-user-1', email: 'emp@example.test', fullName: 'Nguyen Van A' },
  organization: { id: 'org-test', name: 'Test Org', role: 'EMPLOYEE' },
  permissions: {
    invite: false,
    grantHR: false,
    readUsers: false,
    manageUsers: false,
    assignRoles: false,
    viewAudit: false,
    manageOrg: false,
  },
  deliveryMode: 'DEV_ONLY',
};

const sampleEmployee: Employee = {
  id: 'emp-1',
  userId: 'emp-user-1',
  employeeCode: 'EMP-001',
  fullName: 'Nguyen Van A',
  hireDate: '2022-01-15',
  employmentStatus: 'ACTIVE',
  departmentId: 'dept-1',
  departmentName: 'Phòng Kỹ Thuật',
  positionId: 'pos-1',
  positionTitle: 'Kỹ sư phần mềm',
  managerUserId: 'manager-1',
  managerName: 'Manager User',
  version: 1,
  canEdit: true,
  birthDate: '1995-05-20',
  phone: '0901234567',
  personalEmail: 'nguyenvana@gmail.com',
  address: '123 Đường ABC, Hà Nội',
  avatarUrl: '/api/organizations/org-test/employees/emp-1/avatar?v=version',
};

const sampleContracts: EmployeeContract[] = [
  {
    id: 'ct-1',
    contractNumber: 'HD-2022-001',
    contractType: 'FIXED_TERM',
    startDate: '2022-01-15',
    endDate: '2023-01-14',
    signedOn: '2022-01-10',
    terminationDate: null,
    status: 'ACTIVE',
    notes: 'Hợp đồng 1 năm',
    version: 1,
  },
];

const sampleHistory: WorkHistory[] = [
  {
    id: 'hist-1',
    effectiveOn: '2022-01-15',
    reason: 'PROFILE_CREATED',
    departmentName: 'Phòng Kỹ Thuật',
    positionTitle: 'Kỹ sư phần mềm',
    managerName: 'Manager User',
    recordedAt: '2022-01-15T08:00:00Z',
  },
];

describe('EMP-001 & EMP-002: Employees UI Component', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
    mock.mockReset();
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/contracts')) {
        return { items: sampleContracts, total: 1, page: 1, limit: 20 };
      }
      if (path.includes('/work-history')) {
        return { items: sampleHistory, total: 1, page: 1, limit: 20 };
      }
      if (path.includes('/employees/emp-1')) {
        return { employee: sampleEmployee, today: '2026-11-19' };
      }
      if (path.includes('/users?')) {
        return {
          items: [{ id: 'emp-user-1', fullName: 'Nguyen Van A', email: 'emp@example.test' }],
          total: 1,
          page: 1,
          limit: 20,
        };
      }
      if (path.includes('/departments?')) {
        return { items: [{ id: 'dept-1', name: 'Phòng Kỹ Thuật' }], total: 1, page: 1, limit: 20 };
      }
      if (path.includes('/positions?')) {
        return {
          items: [{ id: 'pos-1', title: 'Kỹ sư phần mềm', departmentId: 'dept-1' }],
          total: 1,
          page: 1,
          limit: 20,
        };
      }
      if (path.includes('/employees?')) {
        return { items: [sampleEmployee], total: 1, page: 1, limit: 20 };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('switches employee list labels without translating employee data', async () => {
    setLocale('vi');
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Employee records' })).toBeVisible();
    expect(screen.getByLabelText('Find employees')).toBeVisible();
    expect(screen.getByText('Nguyen Van A')).toBeVisible();
    expect(screen.getByText('Phòng Kỹ Thuật')).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('switches import dialog instructions when language changes', async () => {
    setLocale('vi');
    render(<Employees profile={adminProfile} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nhập từ Excel/ }));
    act(() => setLocale('en'));
    expect(
      screen.getByRole('heading', { name: 'Import employees from Excel / CSV' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /Download Excel template/ })).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('renders employee list for Admin with search filters and action buttons', async () => {
    render(<Employees profile={adminProfile} />);
    expect(await screen.findByText('Hồ sơ nhân viên')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thêm nhân viên' })).toBeVisible();
    expect(await screen.findByText('EMP-001')).toBeVisible();
    expect(screen.getByText('Nguyen Van A')).toBeVisible();
    expect(screen.getByText('Phòng Kỹ Thuật')).toBeVisible();
    expect(
      screen.getByText(
        (content, element) =>
          element?.tagName.toLowerCase() === 'span' &&
          (element?.className.includes('emp-badge') || element?.className.includes('badge')) &&
          content.includes('Đang làm việc'),
      ),
    ).toBeVisible();
  });

  it('supports filtering by query and status', async () => {
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.change(screen.getByLabelText('Tìm nhân viên'), { target: { value: 'EMP-001' } });
    fireEvent.change(screen.getByLabelText('Lọc trạng thái'), { target: { value: 'ACTIVE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));

    await waitFor(() => {
      expect(
        mock.mock.calls.some(([p]) => p.includes('q=EMP-001') && p.includes('status=ACTIVE')),
      ).toBe(true);
    });
  });

  it('shows the XLSX template guidance and uploads an XLSX workbook for preview', async () => {
    mock.mockImplementation(async (path) => {
      if (path.includes('/employees-import/preview')) {
        return { totalRows: 0, validCount: 0, duplicateCount: 0, errorCount: 0, rows: [] };
      }
      if (path.includes('/employees?'))
        return { items: [sampleEmployee], total: 1, page: 1, limit: 20 };
      return {};
    });
    const { container } = render(<Employees profile={adminProfile} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nhập từ Excel/ }));
    expect(await screen.findByText('File mẫu Excel (.XLSX)')).toBeVisible();
    expect(
      screen.getByText(/sheet hướng dẫn; nhập dữ liệu từ dòng 2 trong sheet Danh sách nhân viên/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /Tải file Excel mẫu/ })).toBeVisible();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toContain('.xlsx');
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'mau_nhap_nhan_vien.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('/employees-import/preview'),
        expect.objectContaining({
          fileName: 'mau_nhap_nhan_vien.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'POST',
      ),
    );
    expect(await screen.findByText('mau_nhap_nhan_vien.xlsx')).toBeVisible();
  });

  it('opens employee detail view and displays full profile information for Admin', async () => {
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));

    expect(await screen.findByText('Thông tin hồ sơ')).toBeVisible();
    expect(screen.getByText('0901234567')).toBeVisible();
    expect(screen.getByText('nguyenvana@gmail.com')).toBeVisible();
    expect(screen.getByText('123 Đường ABC, Hà Nội')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa hồ sơ' })).toBeVisible();
  });

  it('switches employee detail tabs without changing profile data', async () => {
    setLocale('vi');
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    await screen.findByText('Thông tin hồ sơ');
    act(() => setLocale('en'));
    expect(screen.getByRole('tab', { name: 'Profile information' })).toBeVisible();
    expect(screen.getByText('0901234567')).toBeVisible();
    expect(screen.getByText('1/15/2022')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(screen.getByLabelText('Employment status')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('switches contract labels without changing the contract number', async () => {
    setLocale('vi');
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Hợp đồng lao động' }));
    await screen.findByText(sampleContracts[0].contractNumber);
    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Employment contracts' })).toBeVisible();
    expect(screen.getByText(sampleContracts[0].contractNumber)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add contract' })).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('switches employment history labels while preserving history data', async () => {
    setLocale('vi');
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Lịch sử công tác' }));
    await screen.findByRole('heading', { name: 'Lịch sử thay đổi công tác' });
    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Employment history' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Record transfer' })).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('switches salary history labels without changing the loaded records', async () => {
    setLocale('vi');
    const previous = mock.getMockImplementation()!;
    mock.mockImplementation(async (path, ...args) =>
      path.includes('/salary-history') ? { items: [], total: 0 } : previous(path, ...args),
    );
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Lịch sử lương' }));
    await screen.findByText('Chưa có hồ sơ lương nào.');
    act(() => setLocale('en'));
    expect(screen.getByText('No salary records.')).toBeVisible();
    act(() => setLocale('vi'));
  });

  it('opens employee avatars from the roster and detail drawer in the zoom viewer', async () => {
    render(<Employees profile={adminProfile} />);
    const rosterAvatar = await screen.findByRole('button', {
      name: 'Xem ảnh đại diện của Nguyen Van A',
    });
    fireEvent.click(rosterAvatar);
    const rosterViewer = await screen.findByRole('dialog', {
      name: 'Ảnh đại diện của Nguyen Van A',
    });
    expect(rosterViewer.tagName).toBe('DIALOG');
    expect(rosterViewer).toBeVisible();
    fireEvent(rosterViewer, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Ảnh đại diện của Nguyen Van A' }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    await screen.findByText('Thông tin hồ sơ');
    const employeeDrawer = screen.getByRole('dialog');
    const detailAvatar = within(employeeDrawer).getByRole('button', {
      name: 'Xem ảnh đại diện của Nguyen Van A',
    });
    fireEvent.click(detailAvatar);
    const detailViewer = await screen.findByRole('dialog', {
      name: 'Ảnh đại diện của Nguyen Van A',
    });
    expect(detailViewer.tagName).toBe('DIALOG');
    expect(detailViewer).toBeVisible();
    fireEvent(detailViewer, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(detailViewer).not.toBeInTheDocument());
    expect(employeeDrawer).toBeVisible();
  });

  it('renders employee self view with "Hồ sơ của tôi" and omits create/edit actions', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/employees?')) {
        return { items: [{ ...sampleEmployee, canEdit: false }], total: 1, page: 1, limit: 20 };
      }
      if (path.includes('/employees/emp-1')) {
        return { employee: { ...sampleEmployee, canEdit: false }, today: '2026-11-19' };
      }
      return {};
    });

    render(<Employees profile={employeeProfile} />);
    expect(await screen.findByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Thêm nhân viên' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    await screen.findByText('Thông tin hồ sơ');
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa hồ sơ' })).not.toBeInTheDocument();
  });

  it('omits private fields for Manager view in detail', async () => {
    const { birthDate, phone, personalEmail, address, ...rest } = sampleEmployee;
    void birthDate;
    void phone;
    void personalEmail;
    void address;
    const managerScopedEmployee: Employee = {
      ...rest,
      canEdit: false,
    };

    mock.mockImplementation(async (path: string) => {
      if (path.includes('/employees?')) {
        return { items: [managerScopedEmployee], total: 1, page: 1, limit: 20 };
      }
      if (path.includes('/employees/emp-1')) {
        return { employee: managerScopedEmployee, today: '2026-11-19' };
      }
      return {};
    });

    render(<Employees profile={managerProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));

    await screen.findByText('Thông tin hồ sơ');
    expect(screen.queryByText('Điện thoại')).not.toBeInTheDocument();
    expect(screen.queryByText('Email cá nhân')).not.toBeInTheDocument();
    expect(screen.queryByText('Địa chỉ')).not.toBeInTheDocument();
  });

  it('allows Admin to open create employee form and submit new profile', async () => {
    mock.mockImplementation(async (path: string, body?: unknown) => {
      if (path.includes('/employees') && body) {
        return { id: 'emp-new' };
      }
      if (path.includes('/employees/emp-new')) {
        return {
          employee: {
            ...sampleEmployee,
            id: 'emp-new',
            employeeCode: 'EMP-002',
            fullName: 'Tran Thi B',
          },
          today: '2026-11-19',
        };
      }
      return { items: [sampleEmployee], total: 1, page: 1, limit: 20 };
    });

    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));

    expect(await screen.findByRole('heading', { name: /Tạo hồ sơ nhân viên/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Mã nhân viên'), { target: { value: 'EMP-002' } });
    fireEvent.change(screen.getByLabelText('Họ và tên hồ sơ'), { target: { value: 'Tran Thi B' } });
    fireEvent.change(screen.getByLabelText('Ngày vào làm'), { target: { value: '2024-01-01' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('/employees'),
        expect.objectContaining({
          employeeCode: 'EMP-002',
          fullName: 'Tran Thi B',
          hireDate: '2024-01-01',
        }),
      );
    });
  });

  it('switches to contracts tab and displays existing labor contracts', async () => {
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));

    await screen.findByText('Thông tin hồ sơ');
    fireEvent.click(screen.getByRole('tab', { name: 'Hợp đồng lao động' }));

    expect(await screen.findByText('HD-2022-001')).toBeVisible();
    expect(screen.getByText('Xác định thời hạn')).toBeVisible();
    expect(screen.getByText('Đang thực hiện')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thêm hợp đồng' })).toBeVisible();
  });

  it('switches to work history tab and displays timeline entries', async () => {
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));

    await screen.findByText('Thông tin hồ sơ');
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử công tác' }));

    expect(await screen.findByText('Tạo hồ sơ')).toBeVisible();
    expect(
      screen.getByText(
        (_c, el) =>
          el?.className === 'emp-timeline-desc' &&
          (el?.textContent?.includes('Phòng Kỹ Thuật') ?? false),
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ghi nhận điều chuyển' })).toBeVisible();
  });

  it('allows Admin to record employee transfer in work history tab', async () => {
    render(<Employees profile={adminProfile} />);
    await screen.findByText('EMP-001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ Nguyen Van A' }));
    await screen.findByText('Thông tin hồ sơ');
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử công tác' }));
    await screen.findByRole('button', { name: 'Ghi nhận điều chuyển' });

    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận điều chuyển' }));
    fireEvent.change(screen.getByLabelText('Lý do điều chuyển'), {
      target: { value: 'Chuyển dự án mới' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chuyển' }));
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('/work-history'),
        expect.objectContaining({
          reason: 'Chuyển dự án mới',
        }),
      );
    });
  });
});
