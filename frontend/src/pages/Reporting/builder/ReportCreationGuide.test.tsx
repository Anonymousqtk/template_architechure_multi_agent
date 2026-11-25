import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { reportBuilderMessages } from '../reportBuilderMessages';
import { reportBuilderGuideMessages as guideMessages } from '../reportBuilderGuideMessages';
import { ReportCreationGuide } from './ReportCreationGuide';
import type { EntityMeta, FieldMeta, ReportDefinition } from './reportBuilderTypes';

const entities: EntityMeta[] = [
  {
    id: 'payroll_slips',
    category: 'PAY',
    labelVi: 'Phiếu lương',
    labelEn: 'Payslips',
    descriptionVi: 'Lương theo kỳ',
    descriptionEn: 'Pay by period',
    minRole: 'HR',
    relatedEntities: [
      {
        entity: 'departments',
        relationshipType: 'MANY_TO_ONE',
        joinDescriptionVi: 'Phòng ban',
        joinDescriptionEn: 'Department',
      },
    ],
  },
  {
    id: 'departments',
    category: 'ORG',
    labelVi: 'Phòng ban',
    labelEn: 'Departments',
    descriptionVi: 'Danh mục phòng ban',
    descriptionEn: 'Department directory',
    minRole: 'HR',
    relatedEntities: [],
  },
];
function field(
  id: string,
  entity: FieldMeta['entity'],
  labelEn: string,
  extra: Partial<FieldMeta> = {},
): FieldMeta {
  return {
    id,
    entity,
    labelVi: labelEn,
    labelEn,
    descriptionVi: 'Mô tả',
    descriptionEn: `${labelEn} business definition`,
    categoryVi: 'Thông tin',
    categoryEn: 'Information',
    dataType: 'string',
    defaultFormat: 'text',
    allowedAggregations: ['COUNT', 'COUNT_DISTINCT'],
    filterOperators: ['eq', 'contains'],
    groupable: true,
    sortable: true,
    minRole: 'HR',
    ...extra,
  };
}
const fields = [
  field('period', 'payroll_slips', 'Period', {
    dataType: 'date',
    defaultFormat: 'date',
    filterOperators: ['eq', 'between', 'relative_date'],
  }),
  field('net', 'payroll_slips', 'Net pay', {
    dataType: 'currency',
    defaultFormat: 'currency',
    allowedAggregations: ['SUM', 'AVG', 'MIN', 'MAX'],
    groupable: false,
  }),
  field('employee_code', 'payroll_slips', 'Employee code'),
  field('department', 'departments', 'Department name'),
];
const t = guideMessages.en;
function setup() {
  const onComplete = vi.fn(),
    onPreview = vi.fn();
  render(
    <ReportCreationGuide
      locale="en"
      msg={reportBuilderMessages.en}
      entities={entities}
      fields={fields}
      result={null}
      resultDefinition={null}
      running={false}
      error={null}
      onPreview={onPreview}
      onComplete={onComplete}
      onCancel={vi.fn()}
    />,
  );
  const next = () => fireEvent.click(screen.getByRole('button', { name: t.next }));
  return { onComplete, onPreview, next };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('guided report creation', () => {
  it('shows all five named steps and updates accessible progress when moving forward and back', () => {
    const { next } = setup();
    const nav = screen.getByRole('navigation', { name: t.guideTitle });
    const steps = within(nav).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveAccessibleName(`1. ${t.goal} · ${t.currentStep}`);
    expect(steps[4]).toHaveAccessibleName(`5. ${t.review} · ${t.upcomingStep}`);
    expect(screen.getByText('Step 1 of 5 · Purpose')).toBeVisible();
    next();
    expect(steps[0]).toHaveAccessibleName(`1. ${t.goal} · ${t.completedStep}`);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Step 2 of 5 · Data')).toBeVisible();
    expect(screen.queryByText(t.example)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.back }));
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveAccessibleName(`2. ${t.source} · ${t.upcomingStep}`);
  });

  it('explains grain and field meaning, preserves related detail fields and filters on handoff', () => {
    const { next, onComplete, onPreview } = setup();
    next();
    expect(screen.getByText(/one payslip in one period/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Departments' }));
    next();
    expect(screen.getByRole('button', { name: t.next })).toBeDisabled();
    fireEvent.click(screen.getByText(t.fieldInfo.replace('{field}', 'Net pay')));
    expect(screen.getByText('Net pay business definition')).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net pay' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Department name' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: t.filters }));
    fireEvent.click(
      screen.getByRole('button', { name: reportBuilderMessages.en.filterBuilder.addRule }),
    );
    fireEvent.change(
      screen.getByLabelText(reportBuilderMessages.en.filterBuilder.valuePlaceholder),
      { target: { value: '2026-11-01' } },
    );
    fireEvent.click(screen.getByRole('button', { name: reportBuilderMessages.en.common.apply }));
    expect(screen.getByText('1 filter conditions')).toBeVisible();
    next();
    expect(screen.getByText(t.departmentNote)).toBeVisible();
    expect(screen.getByRole('button', { name: t.finish })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Pay detail' } });
    fireEvent.click(screen.getByRole('button', { name: t.preview }));
    const preview = onPreview.mock.calls[0][0] as ReportDefinition;
    expect(preview.columns.map((c) => c.fieldId)).toEqual(['net', 'department']);
    expect(preview.filters.rules[0].value).toBe('2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: t.finish }));
    expect(onComplete).toHaveBeenCalledWith(preview, 'Pay detail');
  });

  it('builds a grouped payroll summary and exposes only supported calculations', () => {
    const { next, onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.summary) }));
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Departments' }));
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net pay' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Department name' }));
    next();
    expect(screen.getByRole('button', { name: t.next })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: t.addMeasure }));
    expect(
      within(screen.getByLabelText(t.aggregation)).queryByRole('option', { name: t.count }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t.group), { target: { value: 'department' } });
    fireEvent.change(screen.getByLabelText(t.visualization), { target: { value: 'BAR' } });
    next();
    fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Net pay by department' } });
    fireEvent.click(screen.getByRole('button', { name: t.finish }));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryEntity: 'payroll_slips',
        relatedEntities: ['departments'],
        columns: [],
        rows: [{ fieldId: 'department' }],
        values: [expect.objectContaining({ fieldId: 'net', aggregation: 'SUM' })],
        visualizationType: 'BAR',
      }),
      'Net pay by department',
    );
  });

  it('supports distinct employee counts without offering unsupported time charts', () => {
    const { next, onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.summary) }));
    next();
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Employee code' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: t.addMeasure }));
    fireEvent.change(screen.getByLabelText(t.aggregation), { target: { value: 'COUNT_DISTINCT' } });
    expect(screen.getByRole('option', { name: t.line })).toBeDisabled();
    expect(screen.getByText(t.countWarning)).toBeVisible();
    next();
    fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'People' } });
    fireEvent.click(screen.getByRole('button', { name: t.finish }));
    expect(onComplete.mock.calls[0][0].values[0].aggregation).toBe('COUNT_DISTINCT');
  });

  it('preserves choices when a source reset is canceled and clears them only on confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { next } = setup();
    next();
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net pay' }));
    fireEvent.click(screen.getByRole('button', { name: t.back }));
    fireEvent.click(screen.getByRole('button', { name: /Departments Department directory/ }));
    expect(confirm).toHaveBeenCalledWith(t.resetSource);
    next();
    expect(screen.getByRole('checkbox', { name: 'Net pay' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: t.back }));
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Departments Department directory/ }));
    next();
    expect(screen.queryByRole('checkbox', { name: 'Net pay' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.next })).toBeDisabled();
  });

  it('does not expose fields from disconnected sources and keeps search selections', () => {
    const { next } = setup();
    next();
    next();
    expect(screen.queryByRole('checkbox', { name: 'Department name' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net pay' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'not-a-field' } });
    expect(screen.getByText(t.noFields)).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'Net pay' })).toBeChecked();
  });

  it('keeps a related source connected while selected fields depend on it', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { next } = setup();
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Departments' }));
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Department name' }));
    fireEvent.click(screen.getByRole('button', { name: t.back }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Departments' }));
    expect(alert).toHaveBeenCalledWith(t.relatedInUse);
    expect(screen.getByRole('checkbox', { name: 'Departments' })).toBeChecked();
  });

  it('creates a chronological time chart with the selected date granularity', () => {
    const { next, onComplete } = setup();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.summary) }));
    next();
    next();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Period' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net pay' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: t.addMeasure }));
    fireEvent.change(screen.getByLabelText(t.group), { target: { value: 'period' } });
    fireEvent.change(screen.getByLabelText(reportBuilderMessages.en.config.granularityLabel), {
      target: { value: 'QUARTER' },
    });
    fireEvent.change(screen.getByLabelText(t.visualization), { target: { value: 'LINE' } });
    next();
    fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Quarterly pay' } });
    fireEvent.click(screen.getByRole('button', { name: t.finish }));
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      rows: [{ fieldId: 'period', granularity: 'QUARTER' }],
      sortBy: [{ fieldId: 'period', direction: 'ASC' }],
      visualizationType: 'LINE',
    });
  });

  it('explains unavailable sources and prevents continuing with an invalid source', () => {
    render(
      <ReportCreationGuide
        locale="en"
        msg={reportBuilderMessages.en}
        entities={[]}
        fields={[]}
        result={null}
        resultDefinition={null}
        running={false}
        error={null}
        onPreview={vi.fn()}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t.next }));
    expect(screen.getByText(t.noSources)).toBeVisible();
    expect(screen.getByRole('button', { name: t.next })).toBeDisabled();
  });

  it('provides matching, nonempty Vietnamese and English keys and placeholders', () => {
    expect(Object.keys(guideMessages.vi).sort()).toEqual(Object.keys(t).sort());
    for (const key of Object.keys(t) as Array<keyof typeof t>) {
      expect(t[key].trim()).not.toBe('');
      expect(guideMessages.vi[key].trim()).not.toBe('');
      expect(t[key].match(/\{\w+\}/g)).toEqual(guideMessages.vi[key].match(/\{\w+\}/g));
    }
  });
});
