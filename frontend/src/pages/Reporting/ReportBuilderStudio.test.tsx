import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setLocale } from '../../i18n';
import { request, type Profile } from '../../services/api';
import { reportBuilderMessages } from './reportBuilderMessages';
import { reportBuilderGuideMessages } from './reportBuilderGuideMessages';
import { ReportBuilderStudio } from './builder/ReportBuilderStudio';
import type {
  EntityMeta,
  FieldMeta,
  PrebuiltTemplate,
  ReportExecutionResult,
} from './builder/reportBuilderTypes';

vi.mock('../../services/api', async (original) => ({
  ...(await original<typeof import('../../services/api')>()),
  request: vi.fn(),
}));

const mockRequest = vi.mocked(request);

const hrProfile: Profile = {
  user: { id: 'u-hr', email: 'hr@acme.test', fullName: 'HR User' },
  organization: { id: 'org-1', name: 'Acme Corp', role: 'HR' },
  permissions: { invite: true, grantHR: true, readUsers: true },
  deliveryMode: 'DEV_ONLY',
};

const mockEntities: EntityMeta[] = [
  {
    id: 'employees',
    category: 'HR',
    labelVi: 'Nhân viên',
    labelEn: 'Employees',
    descriptionVi: 'Hồ sơ nhân sự',
    descriptionEn: 'Employee directory',
    minRole: 'EMPLOYEE',
    relatedEntities: [
      {
        entity: 'departments',
        relationshipType: 'MANY_TO_ONE',
        joinDescriptionVi: 'Phòng ban trực thuộc',
        joinDescriptionEn: 'Assigned department',
      },
    ],
  },
  {
    id: 'departments',
    category: 'ORG',
    labelVi: 'Phòng ban',
    labelEn: 'Departments',
    descriptionVi: 'Cơ cấu tổ chức',
    descriptionEn: 'Organization structure',
    minRole: 'EMPLOYEE',
    relatedEntities: [],
  },
];

const mockFields: FieldMeta[] = [
  {
    id: 'emp_full_name',
    entity: 'employees',
    categoryVi: 'Thông tin nhân viên',
    categoryEn: 'Employee Info',
    labelVi: 'Họ và tên',
    labelEn: 'Full Name',
    descriptionVi: 'Họ tên nhân viên',
    descriptionEn: 'Employee full name',
    dataType: 'string',
    defaultFormat: 'text',
    allowedAggregations: ['COUNT', 'COUNT_DISTINCT'],
    filterOperators: ['eq', 'contains', 'is_null'],
    groupable: true,
    sortable: true,
    minRole: 'EMPLOYEE',
  },
  {
    id: 'dept_name',
    entity: 'departments',
    categoryVi: 'Phòng ban',
    categoryEn: 'Department',
    labelVi: 'Tên phòng ban',
    labelEn: 'Department Name',
    descriptionVi: 'Tên phòng ban',
    descriptionEn: 'Department name',
    dataType: 'string',
    defaultFormat: 'text',
    allowedAggregations: ['COUNT', 'COUNT_DISTINCT'],
    filterOperators: ['eq', 'contains'],
    groupable: true,
    sortable: true,
    minRole: 'EMPLOYEE',
  },
  {
    id: 'emp_id',
    entity: 'employees',
    categoryVi: 'Định danh',
    categoryEn: 'Identity',
    labelVi: 'Số lượng nhân viên',
    labelEn: 'Employee Count',
    descriptionVi: 'Đếm nhân sự',
    descriptionEn: 'Headcount identifier',
    dataType: 'number',
    defaultFormat: 'number',
    allowedAggregations: ['COUNT', 'COUNT_DISTINCT'],
    filterOperators: ['is_not_null'],
    groupable: false,
    sortable: true,
    minRole: 'EMPLOYEE',
  },
];

const mockTemplates: PrebuiltTemplate[] = [
  {
    code: 'TPL-HC-01',
    nameVi: 'Phân bổ nhân sự theo phòng ban',
    nameEn: 'Headcount by Department',
    descriptionVi: 'Thống kê nhân sự đang làm việc',
    descriptionEn: 'Active employees grouped by department',
    category: 'HR',
    visualizationType: 'COLUMN',
    definition: {
      primaryEntity: 'employees',
      relatedEntities: ['departments'],
      rows: [{ fieldId: 'dept_name' }],
      values: [{ id: 'hc', fieldId: 'emp_id', aggregation: 'COUNT', label: 'Headcount' }],
      groupBy: [{ fieldId: 'dept_name' }],
    },
  },
];

const mockExecResult: ReportExecutionResult = {
  mode: 'GROUPED',
  columns: [
    {
      key: 'dept_name',
      fieldId: 'dept_name',
      label: 'Department Name',
      dataType: 'string',
      format: 'text',
      isMeasure: false,
    },
    {
      key: 'hc',
      fieldId: 'emp_id',
      label: 'Headcount',
      dataType: 'number',
      format: 'number',
      isMeasure: true,
      aggregation: 'COUNT',
    },
  ],
  rows: [
    { dept_name: 'Engineering', hc: 12 },
    { dept_name: 'HR & Admin', hc: 4 },
  ],
  totals: { hc: 16 },
  pagination: { page: 1, pageSize: 25, totalRows: 2, totalPages: 1 },
  meta: { executionMs: 14, cached: false, rowLimitReached: false },
};

describe('RPT-002 ReportBuilderStudio UI', () => {
  it('hands guided detail configuration to Studio and executes it as a new report', async () => {
    setupApiMocks();
    setLocale('en');
    const t = reportBuilderGuideMessages.en;
    render(
      <ReportBuilderStudio
        organizationId="org-1"
        currentUserId="u-hr"
        userRole="HR"
        locale="en"
        msg={reportBuilderMessages.en}
      />,
    );
    const start = await screen.findByRole('button', {
      name: new RegExp(t.guided + ' ' + t.guidedHint),
    });
    await waitFor(() => expect(start).not.toBeDisabled());
    fireEvent.click(start);
    fireEvent.click(screen.getByRole('button', { name: t.next }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Departments' }));
    fireEvent.click(screen.getByRole('button', { name: t.next }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full Name' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Department Name' }));
    fireEvent.click(screen.getByRole('button', { name: t.next }));
    fireEvent.click(screen.getByRole('button', { name: t.next }));
    fireEvent.change(screen.getByLabelText(t.name), {
      target: { value: 'People and departments' },
    });
    fireEvent.click(screen.getByRole('button', { name: t.finish }));
    expect(screen.getByLabelText('Report name')).toHaveValue('People and departments');
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/builder/execute'),
        expect.objectContaining({
          reportId: undefined,
          definition: expect.objectContaining({
            primaryEntity: 'employees',
            relatedEntities: ['departments'],
            columns: [{ fieldId: 'emp_full_name' }, { fieldId: 'dept_name' }],
          }),
        }),
        'POST',
      ),
    );
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByText('Save Report to Library')).toBeVisible();
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save Report' }));
      });
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/builder/library'),
        expect.objectContaining({
          name: 'People and departments',
          definition: expect.objectContaining({
            columns: [{ fieldId: 'emp_full_name' }, { fieldId: 'dept_name' }],
          }),
        }),
        'POST',
      );
      const saved = screen.getByText(reportBuilderMessages.en.toolbar.savedSuccess);
      expect(saved.closest('.rbs-save-action')).not.toBeNull();
      expect(saved).not.toHaveClass('rbs-pill');
      act(() => vi.advanceTimersByTime(3999));
      expect(saved).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(
        screen.queryByText(reportBuilderMessages.en.toolbar.savedSuccess),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes stale results from unsaved changes and clears staleness on undo or rerun', async () => {
    setupApiMocks();
    setLocale('en');
    render(
      <ReportBuilderStudio
        organizationId="org-1"
        currentUserId="u-hr"
        userRole="HR"
        locale="en"
        msg={reportBuilderMessages.en}
      />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Templates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Template' }));
    await screen.findByText('Total Records: 2');
    fireEvent.click(screen.getByLabelText('+ Columns: Full Name'));
    expect(screen.getByText(reportBuilderGuideMessages.en.stale)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText(reportBuilderGuideMessages.en.stale)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByText(reportBuilderGuideMessages.en.stale)).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Run Report' })[0]);
    await waitFor(() =>
      expect(screen.queryByText(reportBuilderGuideMessages.en.stale)).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  afterEach(() => {
    cleanup();
    mockRequest.mockReset();
    setLocale('vi');
  });

  function setupApiMocks() {
    mockRequest.mockImplementation(async (path, _body, method) => {
      if (path.includes('/reports/builder/metadata')) {
        return { entities: mockEntities, fields: mockFields, templates: mockTemplates };
      }
      if (path.includes('/reports/builder/library') && (!method || method === 'GET')) {
        return { reports: [] };
      }
      if (path.includes('/reports/builder/execute')) {
        return mockExecResult;
      }
      if (path.includes('/reports/builder/validate-formula')) {
        return { valid: true, resultType: 'number' };
      }
      if (path.includes('/reports/builder/library') && method === 'POST') {
        return {
          report: {
            id: 'rep-1',
            name: 'Saved Custom Report',
            description: '',
            primaryEntity: 'employees',
            relatedEntities: ['departments'],
            definition: mockTemplates[0].definition,
            visualizationType: 'COLUMN',
            visibility: 'PRIVATE',
            sharedRoles: [],
            sharedUserIds: [],
            isTemplate: false,
            templateCode: null,
            version: 1,
            createdBy: hrProfile.user.id,
            lastRunAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isFavorite: false,
            lastViewedAt: null,
          },
        };
      }
      return {};
    });
  }

  it('loads templates, opens template in Studio, renders chart/table/KPI, supports undo/redo and formulas', async () => {
    setupApiMocks();
    setLocale('en');

    render(
      <ReportBuilderStudio
        organizationId={hrProfile.organization.id}
        currentUserId={hrProfile.user.id}
        userRole={hrProfile.organization.role}
        locale="en"
        msg={reportBuilderMessages.en}
      />,
    );

    // Switch to Templates tab in library
    await waitFor(() => expect(screen.getByText('Templates')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Templates'));

    await waitFor(() => expect(screen.getByText('Headcount by Department')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Use Template'));

    // Studio opens and runs template automatically
    await waitFor(() => expect(screen.getByLabelText('Report name')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Total Records: 2')).toBeInTheDocument());

    // Add Full Name to Display Columns via quick add button
    const quickBtn = screen.getByLabelText('+ Columns: Full Name');
    fireEvent.click(quickBtn);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Undo and Redo
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    expect(undoBtn).not.toBeDisabled();
    fireEvent.click(undoBtn);

    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect(redoBtn).not.toBeDisabled();
    fireEvent.click(redoBtn);

    // Switch visualization to Table and KPI Card
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    await waitFor(() =>
      expect(screen.getAllByText('Engineering').length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByText('GRAND TOTAL')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Chart' }));
    fireEvent.change(screen.getByLabelText('Chart Type'), { target: { value: 'KPI' } });
    await waitFor(() => expect(screen.getByText('16')).toBeInTheDocument());

    // Open Calculated Field Modal & validate formula
    fireEvent.click(screen.getByText('+ New Formula Field'));
    await waitFor(() => expect(screen.getByLabelText('Metric Name')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Metric Name'), { target: { value: 'Double HC' } });
    fireEvent.change(screen.getByLabelText('Safe Formula Expression'), {
      target: { value: '[emp_id] * 2' },
    });
    fireEvent.click(screen.getByText('Validate Syntax'));
    await waitFor(() => expect(screen.getByText(/Formula Valid/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Save Calculated Field'));

    // Open Advanced Filter Builder and apply empty/updated filter
    fireEvent.click(screen.getByText('Advanced Filter Builder (Nested AND / OR)'));
    await waitFor(() => expect(screen.getByText('+ Add Rule')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Add Rule'));
    fireEvent.click(screen.getByText('Apply'));

    // Save As modal (via More Actions menu)
    fireEvent.click(screen.getByText(/More Actions/));
    fireEvent.click(screen.getByText('Save As'));
    await waitFor(() => expect(screen.getByText('Save Report to Library')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Save Report'));
    await waitFor(() => expect(screen.getByText('Report definition saved.')).toBeInTheDocument());
  });

  it('supports Vietnamese localization cleanly', async () => {
    setupApiMocks();
    setLocale('vi');

    render(
      <ReportBuilderStudio
        organizationId={hrProfile.organization.id}
        currentUserId={hrProfile.user.id}
        userRole={hrProfile.organization.role}
        locale="vi"
        msg={reportBuilderMessages.vi}
      />,
    );

    await waitFor(() => expect(screen.getByText('Mẫu báo cáo chuẩn')).toBeInTheDocument());
    const advanced = screen.getByRole('button', { name: /^Studio nâng cao/ });
    await waitFor(() => expect(advanced).toBeEnabled());
    fireEvent.click(advanced);
    expect(screen.getByRole('heading', { name: 'Trường dữ liệu' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cấu hình báo cáo' })).toBeInTheDocument();
    expect(screen.getAllByText('Chạy báo cáo').length).toBeGreaterThanOrEqual(1);
  });

  it('supports touch quick-assign sheet, mobile 3-tab switcher, and tablet drawer toggles', async () => {
    setupApiMocks();
    setLocale('en');

    const { container } = render(
      <ReportBuilderStudio
        organizationId={hrProfile.organization.id}
        currentUserId={hrProfile.user.id}
        userRole={hrProfile.organization.role}
        locale="en"
        msg={reportBuilderMessages.en}
      />,
    );

    const advanced = await screen.findByRole('button', { name: /^Advanced Studio/ });
    await waitFor(() => expect(advanced).toBeEnabled());
    fireEvent.click(advanced);

    // Tap field row to open Quick Destination Sheet instead of drag-and-drop
    await waitFor(() => expect(screen.getByText('Full Name')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Full Name'));
    await waitFor(() => expect(screen.getByText('Add Field to Zone')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Display Columns (Detail Table)' }));
    await waitFor(() => expect(screen.getByText('Build (1)')).toBeInTheDocument());

    // Mobile 3-tab switcher updates data-mobile-tab cleanly
    const workspace = container.querySelector('.rbs-workspace');
    expect(workspace).toHaveAttribute('data-mobile-tab', 'DATA');
    fireEvent.click(screen.getByRole('tab', { name: 'Build (1)' }));
    expect(workspace).toHaveAttribute('data-mobile-tab', 'CONFIG');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(workspace).toHaveAttribute('data-mobile-tab', 'RESULT');

    // Tablet drawer toggle updates data-tablet-drawer
    fireEvent.click(screen.getByRole('button', { name: 'Data Fields' }));
    expect(workspace).toHaveAttribute('data-tablet-drawer', 'DATA');
    fireEvent.click(screen.getByRole('button', { name: 'Report Configuration (1)' }));
    expect(workspace).toHaveAttribute('data-tablet-drawer', 'CONFIG');
  });
});
