import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setLocale } from '../../i18n';
import { ApiError, request, type Profile } from '../../services/api';
import { ExecutiveAnalytics } from './ExecutiveAnalytics';
import type { ExecutiveAnalytics as Analytics, CostPeriod } from './executiveTypes';
import { executiveMessages } from './executiveMessages';

vi.mock('../../services/api', async (original) => ({
  ...(await original<typeof import('../../services/api')>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
const profile: Profile = {
  user: { id: 'admin', email: 'admin@example.test', fullName: 'Admin' },
  organization: { id: 'org-a', name: 'Company A', role: 'ADMIN' },
  permissions: { invite: true, grantHR: true, readUsers: true, viewAudit: true },
  security: { mfaRequired: true, mfaEnabled: true, mfaVerified: true },
  deliveryMode: 'DEV_ONLY',
};
const period: CostPeriod = {
  records: 2,
  employees: 2,
  gross: '46000000.00',
  net: '42300000.00',
  base: '35000000.00',
  allowances: '3000000.00',
  bonuses: '8000000.00',
  overtime: '0.00',
  overtimeHours: '0',
  averageSalary: '23000000.00',
  updatedAt: '2026-01-31T12:00:00Z',
  insurance: { records: 0, employer: null, employee: null, updatedAt: null },
  payments: { records: 0, amount: null, updatedAt: null },
  departments: [{ id: 'dept', label: 'Engineering', gross: '46000000.00', employees: 2 }],
  trends: [{ label: '2026-01-01', value: '46000000.00' }],
  periods: [
    {
      id: 'period',
      name: 'January',
      status: 'CLOSED',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    },
  ],
};
const fixture: Analytics = {
  generatedAt: '2026-02-01T12:00:00Z',
  snapshotDate: '2026-02-01',
  range: {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    compareStartDate: '2025-12-01',
    compareEndDate: '2025-12-31',
    grain: 'month',
  },
  departments: [{ id: 'dept', name: 'Engineering', parentId: null }],
  workforce: { records: 2, headcount: 2, hires: 1, updatedAt: '2026-01-31T12:00:00Z' },
  structure: [{ id: 'dept', kind: 'department', label: 'Engineering', value: 2 }],
  attendance: {
    schedules: 0,
    attendanceRate: null,
    absenteeismRate: null,
    leaveRate: null,
    overtimeRate: null,
  },
  lifecycle: { growth: null, turnover: null, retention: null, departures: null },
  capabilities: {
    financial: true,
    audit: true,
    historicalEmployment: false,
    recruitment: false,
    budget: false,
  },
  cost: {
    current: period,
    previous: { ...period, records: 0, gross: null },
    grossChangePercent: null,
    costPerEmployee: '23000000.00',
    journal: { records: 3, recognized: '46000000.00', liabilityMovement: '46000000.00' },
    anomalies: [],
    budget: null,
  },
};
const card = (name: string) =>
  within(screen.getByRole('heading', { name, level: 4 }).closest('article')!);
beforeEach(() => {
  setLocale('en');
  mock.mockReset();
  mock.mockResolvedValue(structuredClone(fixture));
});
afterEach(cleanup);

describe('executive dashboard', () => {
  it('shows source-backed KPIs, explicit missing values and formulas in both languages', async () => {
    render(<ExecutiveAnalytics profile={profile} />);
    expect(await screen.findByText('Current workforce snapshot:', { exact: false })).toBeVisible();
    expect(card('Headcount').getByText('2 people')).toBeVisible();
    fireEvent.click(screen.getByText('Data sources and KPI definitions').closest('summary')!);
    fireEvent.click(screen.getByText('Personnel cost details').closest('summary')!);
    expect(card('Employee Turnover Rate').getByText('Insufficient data')).toBeVisible();
    expect(card('Employer insurance').getByText('Insufficient data')).toBeVisible();
    expect(card('Gross payroll').getByText('46,000,000 VND')).toBeVisible();
    fireEvent.click(card('Average Salary').getByText('Details'));
    expect(card('Average Salary').getByText(/Gross \/ confirmed payslip count/)).toBeVisible();
    act(() => setLocale('vi'));
    expect(screen.getByRole('heading', { name: 'Điều hành & KPI nhân sự' })).toBeVisible();
    expect(card('Tổng quỹ lương Gross').getByText('46.000.000 VND')).toBeVisible();
    expect(Object.keys(executiveMessages.en).sort()).toEqual(
      Object.keys(executiveMessages.vi).sort(),
    );
  });

  it('keeps advanced data collapsed and does not draw a trend from a single period', async () => {
    render(<ExecutiveAnalytics profile={profile} />);
    await screen.findByRole('heading', { name: 'Headcount', level: 4 });
    expect(screen.getByText(executiveMessages.en.singlePeriod)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Average Salary', level: 4 })).not.toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Employee Turnover Rate', level: 4 }),
    ).not.toBeVisible();
    fireEvent.click(screen.getByText('Personnel cost details').closest('summary')!);
    expect(screen.getByRole('heading', { name: 'Average Salary', level: 4 })).toBeVisible();
  });

  it('applies date, comparison, department and branch filters only on submit', async () => {
    render(<ExecutiveAnalytics profile={profile} />);
    await screen.findByRole('heading', { name: 'Gross payroll', level: 4 });
    fireEvent.click(screen.getByText('Analysis scope').closest('summary')!);
    expect(screen.getByLabelText('From date')).toBeVisible();
    const before = mock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-03-31' } });
    fireEvent.change(screen.getByLabelText('Comparison from'), { target: { value: '2025-10-01' } });
    fireEvent.change(screen.getByLabelText('Comparison to'), { target: { value: '2025-12-31' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'dept' } });
    fireEvent.change(screen.getByLabelText('Branch / department subtree'), {
      target: { value: 'dept' },
    });
    fireEvent.change(screen.getByLabelText('Trend grouping'), { target: { value: 'quarter' } });
    expect(mock).toHaveBeenCalledTimes(before);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mock.mock.calls.at(-1)?.[0]).toContain('grain=quarter'));
    const query = new URL(mock.mock.calls.at(-1)![0], 'http://local').searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      compareStartDate: '2025-10-01',
      compareEndDate: '2025-12-31',
      departmentId: 'dept',
      branchId: 'dept',
    });
  });

  it('does not request executive data for employees or show financial data to managers', async () => {
    const { rerender } = render(
      <ExecutiveAnalytics
        profile={{ ...profile, organization: { ...profile.organization, role: 'EMPLOYEE' } }}
      />,
    );
    expect(mock).not.toHaveBeenCalled();
    rerender(
      <ExecutiveAnalytics
        profile={{ ...profile, organization: { ...profile.organization, role: 'MANAGER' } }}
      />,
    );
    // Defend against even an incorrectly shaped financial payload after a role change.
    await screen.findByText('Cost information is restricted to ADMIN and HR.');
    expect(screen.queryByRole('heading', { name: 'Gross payroll' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open audit log' })).not.toBeInTheDocument();
  });

  it('clears old tenant data immediately and ignores late responses', async () => {
    let finishOld!: (value: Analytics) => void;
    mock.mockImplementationOnce(
      () =>
        new Promise<Analytics>((resolve) => {
          finishOld = resolve;
        }),
    );
    const { rerender } = render(<ExecutiveAnalytics profile={profile} />);
    const other = {
      ...profile,
      organization: { ...profile.organization, id: 'org-b', name: 'Company B' },
    };
    mock.mockResolvedValueOnce({
      ...structuredClone(fixture),
      workforce: { ...fixture.workforce, headcount: 7 },
    });
    rerender(<ExecutiveAnalytics profile={other} />);
    expect(await cardWhenReady('Headcount', '7 people')).toBeVisible();
    await act(async () => finishOld(fixture));
    expect(card('Headcount').getByText('7 people')).toBeVisible();
    expect(mock.mock.calls.at(-1)![0]).toContain('/org-b/');
  });

  it('reports failures without zero metrics and retries the authorized request', async () => {
    mock.mockRejectedValueOnce(Error('network'));
    render(<ExecutiveAnalytics profile={profile} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load analytics.');
    expect(screen.queryByRole('heading', { name: 'Headcount', level: 4 })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await cardWhenReady('Headcount', '2 people')).toBeVisible();
  });

  it('explains an unavailable API endpoint instead of hiding the 404 behind a generic retry', async () => {
    mock.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND'));
    render(<ExecutiveAnalytics profile={profile} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The requested API endpoint or record was not found',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('restart backend if updated');
    act(() => setLocale('vi'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('The requested API endpoint');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByRole('heading', { name: 'Tổng quỹ lương Gross', level: 4 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads read-only audit on demand and supports exact filters and pagination', async () => {
    mock.mockImplementation(async (path) =>
      path.includes('/audit?')
        ? {
            items: [
              {
                id: 'event',
                action: 'PAYROLL_APPROVED',
                actor: 'actor',
                target: 'period',
                source: 'AUTH_HR_PAY',
                at: '2026-01-15T12:00:00Z',
              },
            ],
            total: 21,
            page: 1,
            limit: 20,
          }
        : fixture,
    );
    render(<ExecutiveAnalytics profile={profile} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open audit log' }));
    expect(await screen.findByText('PAYROLL_APPROVED')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Action (exact code)'), {
      target: { value: 'PAYROLL_APPROVED' },
    });
    const form = screen.getByLabelText('Action (exact code)').closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(mock.mock.calls.at(-1)![0]).toContain('action=PAYROLL_APPROVED'));
    await screen.findByText('PAYROLL_APPROVED');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mock.mock.calls.at(-1)![0]).toContain('page=2'));
    expect(screen.queryByRole('button', { name: /delete|edit/i })).not.toBeInTheDocument();
  });
});

async function cardWhenReady(name: string, value: string) {
  await screen.findByRole('heading', { name, level: 4 });
  return card(name).getByText(value);
}
