import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CustomReportsLibrary } from './CustomReportsLibrary';
import { reportBuilderMessages } from '../reportBuilderMessages';
import {
  createEmptyReportDefinition,
  type CustomReportRecord,
  type EntityMeta,
  type PrebuiltTemplate,
} from './reportBuilderTypes';

const source: EntityMeta = {
  id: 'employees',
  category: 'HR',
  labelVi: 'Hồ sơ nhân viên',
  labelEn: 'Employee profiles',
  descriptionVi: '',
  descriptionEn: '',
  minRole: 'HR',
  relatedEntities: [],
};
const template: PrebuiltTemplate = {
  code: 'headcount',
  nameVi: 'Thống kê nhân sự theo phòng ban và trạng thái',
  nameEn: 'Headcount by department and employment status',
  descriptionVi: 'Tổng hợp số lượng nhân viên theo phòng ban.',
  descriptionEn: 'Summarize employees by department.',
  category: 'employees',
  visualizationType: 'PIVOT',
  definition: createEmptyReportDefinition('employees'),
};
const ownReport: CustomReportRecord = {
  id: 'mine',
  name: 'My headcount report',
  description: 'Saved report',
  primaryEntity: 'employees',
  relatedEntities: [],
  definition: createEmptyReportDefinition('employees'),
  visualizationType: 'TABLE',
  visibility: 'PRIVATE',
  sharedRoles: [],
  sharedUserIds: [],
  isTemplate: false,
  templateCode: null,
  version: 1,
  createdBy: 'me',
  createdAt: '',
  updatedAt: '',
  lastRunAt: null,
  isFavorite: false,
  lastViewedAt: null,
};
function setup() {
  const onUseTemplate = vi.fn(),
    onOpenReport = vi.fn(),
    onDuplicateReport = vi.fn(),
    onDeleteReport = vi.fn(),
    onToggleFavorite = vi.fn(),
    onShareReport = vi.fn();
  render(
    <CustomReportsLibrary
      locale="en"
      msg={reportBuilderMessages.en}
      currentUserId="me"
      entities={[source]}
      reports={[
        ownReport,
        {
          ...ownReport,
          id: 'shared',
          name: 'Shared headcount report',
          createdBy: 'someone',
          visibility: 'SHARED',
        },
      ]}
      templates={[template]}
      loading={false}
      onCreateBlank={vi.fn()}
      onCreateGuided={vi.fn()}
      onUseTemplate={onUseTemplate}
      onOpenReport={onOpenReport}
      onDuplicateReport={onDuplicateReport}
      onDeleteReport={onDeleteReport}
      onToggleFavorite={onToggleFavorite}
      onShareReport={onShareReport}
    />,
  );
  return {
    onUseTemplate,
    onOpenReport,
    onDuplicateReport,
    onDeleteReport,
    onToggleFavorite,
    onShareReport,
  };
}
afterEach(cleanup);

it('describes the template type below the title without branded pills or duplicate source identifiers', () => {
  const { onUseTemplate } = setup();
  fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
  const card = screen.getByRole('heading', { name: template.nameEn }).closest('article')!;
  expect(within(card).getByText('Employee profiles')).toBeVisible();
  expect(within(card).getByText('Report type')).toBeVisible();
  expect(
    within(card).getByText(reportBuilderMessages.en.canvas.views.PIVOT).closest('dl'),
  ).not.toBeNull();
  expect(card.querySelector('.rbs-pill')).toBeNull();
  expect(within(card).queryByText('employees')).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Use Template' }));
  expect(onUseTemplate).toHaveBeenCalledWith(template);
});

it('preserves saved report actions while applying the same card structure', () => {
  const callbacks = setup();
  const card = screen.getByRole('heading', { name: ownReport.name }).closest('article')!;
  const ui = within(card);
  fireEvent.click(ui.getByRole('button', { name: reportBuilderMessages.en.library.openBtn }));
  fireEvent.click(ui.getByRole('button', { name: reportBuilderMessages.en.library.duplicateBtn }));
  fireEvent.click(ui.getByRole('button', { name: reportBuilderMessages.en.library.shareBtn }));
  fireEvent.click(ui.getByRole('button', { name: reportBuilderMessages.en.library.deleteBtn }));
  fireEvent.click(ui.getByRole('button', { name: reportBuilderMessages.en.library.favoriteAdd }));
  for (const key of [
    'onOpenReport',
    'onDuplicateReport',
    'onShareReport',
    'onDeleteReport',
    'onToggleFavorite',
  ] as const)
    expect(callbacks[key]).toHaveBeenCalledWith(ownReport);
});

it('keeps owner-only actions out of shared report cards', () => {
  setup();
  fireEvent.click(
    screen.getByRole('tab', { name: reportBuilderMessages.en.library.sharedReports }),
  );
  const card = screen.getByRole('heading', { name: 'Shared headcount report' }).closest('article')!;
  expect(
    within(card).queryByRole('button', { name: reportBuilderMessages.en.library.deleteBtn }),
  ).not.toBeInTheDocument();
  expect(
    within(card).queryByRole('button', { name: reportBuilderMessages.en.library.shareBtn }),
  ).not.toBeInTheDocument();
});
