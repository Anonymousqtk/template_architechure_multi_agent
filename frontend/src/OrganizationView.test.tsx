import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DepartmentsPanel, OrgChartView, OrganizationPanel, OrganizationView, PositionsPanel } from './OrganizationView';
import { request, type Profile, type OrgChartData, type OrgChartNode } from './api';

vi.mock('./api', async original => ({
  ...(await original<typeof import('./api')>()),
  request: vi.fn(),
}));

const mock = vi.mocked(request);

const adminProfile: Profile = {
  user: { id: 'admin', email: 'admin@example.test', fullName: 'Admin User' },
  organization: { id: 'org-test', name: 'Acme Corp', role: 'ADMIN' },
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

const sampleOrgChart: OrgChartData = {
  organization: {
    id: 'org-test',
    name: 'Acme Corp',
    code: 'ACME',
    description: 'Tech Company',
  },
  departmentTree: [
    {
      id: 'dept-1',
      parentId: null,
      code: 'TECH',
      name: 'Technology',
      description: 'Engineering',
      manager: {userId:'mgr-1',fullName:'Tech Lead',email:'tech@example.test'},
      memberCount: 1,
      members: [
        {
          userId: 'dev-1',
          fullName: 'Alice Dev',
          email: 'alice@example.test',
          role: 'EMPLOYEE',
          positionId: 'pos-1',
          positionTitle: 'Senior Software Engineer',
          managerUserId: 'mgr-1',
          managerName: 'Tech Lead',
        },
      ],
      children: [
        {
          id: 'dept-2',
          parentId: 'dept-1',
          code: 'QA',
          name: 'Quality Assurance',
          description: 'Testing team',
          manager: null,
          memberCount: 0,
          members: [],
          children: [],
        },
      ],
    },
  ],
  unassignedMembers: [
    {
      userId: 'intern-1',
      fullName: 'Bob Intern',
      email: 'bob@example.test',
      role: 'EMPLOYEE',
      positionId: null,
      positionTitle: null,
      managerUserId: null,
      managerName: null,
    },
  ],
  totalDepartments: 2,
  totalPositions: 1,
  totalMembers: 2,
};

const sampleDepts = [
  {
    id: 'dept-1',
    organizationId: 'org-test',
    parentId: null,
    parentName: null,
    code: 'TECH',
    name: 'Technology',
    description: 'Engineering',
    managerUserId: 'mgr-1',
    managerName: 'Tech Lead',
    managerEmail: 'tech@example.test',
    isActive: true,
    memberCount: 1,
    childCount: 1,
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  },
];

const samplePositions = [
  {
    id: 'pos-1',
    organizationId: 'org-test',
    departmentId: 'dept-1',
    departmentName: 'Technology',
    code: 'DEV_SR',
    title: 'Senior Software Engineer',
    description: 'Dev Lead',
    isActive: true,
    memberCount: 1,
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  },
];

beforeEach(() => {
  mock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ORG-001 Organization Structure UI', () => {
  it('ORG-002 renders a deep hierarchy and collapses the entire descendant branch', async () => {
    let branch:OrgChartNode|undefined;
    for(let level=15;level>=0;level--){
      branch={id:'level-'+level,parentId:level?'level-'+(level-1):null,code:'L'+level,
        name:'Department level '+level,description:null,manager:null,memberCount:0,members:[],children:branch?[branch]:[]};
    }
    mock.mockResolvedValue({...sampleOrgChart,departmentTree:[branch!],totalDepartments:16});
    render(<OrgChartView profile={adminProfile} />);
    expect(await screen.findByText('Department level 15')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button',{name:'Thu gọn ▲'})[0]);
    expect(screen.queryByText('Department level 15')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Mở rộng (1) ▼'}));
    expect(screen.getByText('Department level 15')).toBeVisible();
  });
  it('renders the backend wire contract, nested manager and collapsible department tree', async () => {
    mock.mockResolvedValue(sampleOrgChart);
    render(<OrgChartView profile={adminProfile} />);
    expect(await screen.findByText('Technology')).toBeVisible();
    expect(screen.getByText('Tech Lead (tech@example.test)')).toBeVisible();
    expect(screen.getByText('Quality Assurance')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'Thu gọn ▲'}));
    expect(screen.queryByText('Quality Assurance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Mở rộng (1) ▼'}));
    expect(screen.getByText('Quality Assurance')).toBeVisible();
  });
  it('renders an empty backend chart response without crashing', async () => {
    mock.mockResolvedValue({...sampleOrgChart, departmentTree:[], unassignedMembers:[], totalDepartments:0,totalPositions:0,totalMembers:0});
    render(<OrgChartView profile={adminProfile} />);
    expect(await screen.findByText('Chưa có phòng ban nào được thiết lập trong tổ chức.')).toBeVisible();
    expect(screen.getAllByText('0')).toHaveLength(3);
  });
  it.each([
    ['chart', OrgChartView],
    ['departments', DepartmentsPanel],
    ['positions', PositionsPanel],
  ] as const)('recovers %s after a load failure without showing a false empty state', async (kind, Component) => {
    let failed = true;
    mock.mockImplementation(async path => {
      const target = kind === 'chart' ? '/org-chart' : '/' + kind + '?';
      if (path.includes(target) && failed) throw new Error('offline');
      if (path.includes('/org-chart')) return sampleOrgChart;
      if (path.includes('/positions')) return {items: samplePositions, total: 1};
      if (path.includes('/departments')) return {items: sampleDepts, total: 1};
      return {items: []};
    });
    render(<Component profile={adminProfile} />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/Không tìm thấy (phòng ban|chức danh) nào/)).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', {name:'Thử tải lại'}));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText(kind === 'positions' ? 'DEV_SR' : 'Technology')).toBeVisible();
  });
  it('OrgChartView renders stats, hierarchical tree, positions and unassigned members', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/org-chart')) return sampleOrgChart;
      return {};
    });

    render(<OrgChartView profile={adminProfile} />);
    expect(screen.getByText('Đang tải sơ đồ tổ chức…')).toBeInTheDocument();

    expect(await screen.findByText('Acme Corp (ACME)')).toBeVisible();
    expect(screen.getByText('Technology')).toBeVisible();
    expect(screen.getByText('Alice Dev')).toBeVisible();
    expect(screen.getByText('Quality Assurance')).toBeVisible();
    expect(screen.getByText(/Bob Intern/)).toBeVisible();
    expect(screen.getByText('Tổng số phòng ban')).toBeVisible();
    expect(screen.getByText('Tổng số vị trí')).toBeVisible();
    expect(screen.getByText('Tổng số thành viên')).toBeVisible();
  });

  it('DepartmentsPanel renders departments table and handles create department modal', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/departments')) {
        return { items: sampleDepts, total: 1 };
      }
      if (path.includes('/users')) {
        return { items: [{ id: 'mgr-1', fullName: 'Tech Lead', email: 'tech@example.test' }] };
      }
      return {};
    });

    render(<DepartmentsPanel profile={adminProfile} />);
    expect(await screen.findByText('TECH')).toBeVisible();
    expect(screen.getByText('Technology')).toBeVisible();

    // Open Add Modal
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm phòng ban mới' }));
    expect(screen.getByText('Thêm phòng ban mới')).toBeVisible();

    fireEvent.change(screen.getByLabelText(/Mã phòng ban/i), { target: { value: 'HR' } });
    fireEvent.change(screen.getByLabelText(/Tên phòng ban/i), { target: { value: 'Human Resources' } });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Tạo mới' }));
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        '/api/organizations/org-test/departments',
        expect.objectContaining({
          code: 'HR',
          name: 'Human Resources',
        }),
      );
    });
  });

  it('PositionsPanel renders positions table and handles create position modal', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/job-titles')) return { items: [{ id: 'title-1', name: 'Engineer', code: 'ENG' }], total: 1 };
      if (path.includes('/positions')) {
        return { items: samplePositions, total: 1 };
      }
      if (path.includes('/departments')) {
        return { items: sampleDepts };
      }
      return {};
    });

    render(<PositionsPanel profile={adminProfile} />);
    expect(await screen.findByText('DEV_SR')).toBeVisible();
    expect(screen.getByText('Senior Software Engineer')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '+ Thêm vị trí mới' }));
    expect(screen.getByText('Thêm vị trí mới')).toBeVisible();

    fireEvent.change(screen.getByLabelText(/Mã vị trí/i), { target: { value: 'QA_ENG' } });
    fireEvent.change(screen.getByLabelText(/Tên vị trí/i), { target: { value: 'QA Engineer' } });
    await screen.findByRole('option', { name: 'Engineer (ENG)' });
    fireEvent.change(screen.getByLabelText('Chức danh'), { target: { value: 'title-1' } });
    fireEvent.change(screen.getByLabelText('Vị trí cấp trên'), { target: { value: samplePositions[0].id } });
    fireEvent.change(screen.getByLabelText('Trạng thái vị trí'), { target: { value: 'false' } });

    fireEvent.click(screen.getByRole('button', { name: 'Tạo mới' }));
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        '/api/organizations/org-test/positions',
        expect.objectContaining({
          code: 'QA_ENG',
          title: 'QA Engineer',
          jobTitleId: 'title-1',
          managerPositionId: samplePositions[0].id,
          isActive: false,
        }),
      );
    });
  });

  it('opens the distinct job-title catalog and edits title status', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/job-titles?')) return { items: [{ id: 'title-1', code: 'ENG', name: 'Engineer', isActive: true }], total: 1 };
      return { items: [], total: 0 };
    });
    render(<OrganizationView profile={adminProfile} activeTab="positions" />);
    fireEvent.click(screen.getByRole('button', { name: 'Danh mục chức danh' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa chức danh Engineer' }));
    fireEvent.change(screen.getByLabelText('Trạng thái chức danh'), { target: { value: 'false' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chức danh' }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/organizations/org-test/job-titles/title-1',
      expect.objectContaining({ code: 'ENG', isActive: false }), 'PATCH'));
  });

  it('OrganizationPanel displays organization details and allows Admin edit', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path === '/api/organizations/org-test') {
        return {
          organization: {
            id: 'org-test',
            name: 'Acme Corp',
            code: 'ACME',
            description: 'Tech Company',
            parentOrganizationId: null,
            parentOrganization: null,
            isActive: true,
            createdAt: '2026-11-19T00:00:00Z',
          },
        };
      }
      return {};
    });

    render(<OrganizationPanel profile={adminProfile} />);
    expect(await screen.findByText('Acme Corp')).toBeVisible();
    expect(screen.getByText('ACME')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(screen.getByLabelText(/Tên tổ chức/i), { target: { value: 'Acme International' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        '/api/organizations/org-test',
        expect.objectContaining({
          name: 'Acme International',
          code: 'ACME',
        }),
        'PATCH',
      );
    });
  });

  it('OrganizationView tab navigation switches between tabs', async () => {
    mock.mockImplementation(async (path: string) => {
      if (path.includes('/org-chart')) return sampleOrgChart;
      if (path.includes('/departments')) return { items: sampleDepts, total: 1 };
      if (path.includes('/positions')) return { items: samplePositions, total: 1 };
      return {};
    });

    render(<OrganizationView profile={adminProfile} activeTab="org-chart" />);
    expect(await screen.findByText('Acme Corp (ACME)')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: /Phòng ban/ }));
    expect(await screen.findByText('TECH')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: /Chức danh/ }));
    expect(await screen.findByText('DEV_SR')).toBeVisible();
  });
});
