import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import { reportBuilderGuideMessages } from '../reportBuilderGuideMessages';
import type {
  EntityId,
  EntityMeta,
  FieldMeta,
  FilterGroup,
  ReportDefinition,
} from './reportBuilderTypes';

export function sourceGrain(entity: EntityId, locale: Locale) {
  const t = reportBuilderGuideMessages[locale];
  const grains: Record<EntityId, string> = {
    employees: t.grainEmployees,
    departments: t.grainDepartments,
    positions: t.grainPositions,
    contracts: t.grainContracts,
    attendance: t.grainAttendance,
    leave_requests: t.grainLeave,
    payroll_slips: t.grainPayroll,
    payroll_journal_lines: t.grainJournal,
  };
  return grains[entity];
}

export function countReportFilters(group: FilterGroup): number {
  return (
    group.rules.length + group.groups.reduce((sum, child) => sum + countReportFilters(child), 0)
  );
}

export function FieldGuide({
  field,
  entities,
  locale,
  msg,
}: {
  field: FieldMeta;
  entities: EntityMeta[];
  locale: Locale;
  msg: ReportBuilderMessages;
}) {
  const t = reportBuilderGuideMessages[locale];
  const entity = entities.find((e) => e.id === field.entity);
  const label = locale === 'en' ? field.labelEn : field.labelVi;
  const formats = {
    text: t.text,
    number: t.number,
    currency: t.currency,
    percent: t.percent,
    date: t.date,
    datetime: t.datetime,
    boolean: t.boolean,
  };
  return (
    <details className="rbs-field-guide">
      <summary>{t.fieldInfo.replace('{field}', label)}</summary>
      <dl>
        <dt>{t.meaning}</dt>
        <dd>{(locale === 'en' ? field.descriptionEn : field.descriptionVi) || t.missingMeaning}</dd>
        <dt>{t.origin}</dt>
        <dd>{entity ? (locale === 'en' ? entity.labelEn : entity.labelVi) : field.entity}</dd>
        <dt>{t.format}</dt>
        <dd>{formats[field.defaultFormat]}</dd>
        <dt>{t.calculations}</dt>
        <dd>
          {field.allowedAggregations.map((a) => msg.aggregations[a] ?? a).join(', ') ||
            t.noCalculations}
        </dd>
      </dl>
    </details>
  );
}

export function ReportOverview({
  definition,
  entities,
  fields,
  locale,
  msg,
  expanded = true,
}: {
  definition: ReportDefinition;
  entities: EntityMeta[];
  fields: FieldMeta[];
  locale: Locale;
  msg: ReportBuilderMessages;
  expanded?: boolean;
}) {
  const t = reportBuilderGuideMessages[locale];
  const source = entities.find((e) => e.id === definition.primaryEntity);
  const fieldLabel = (id: string) => {
    const f = fields.find((item) => item.id === id);
    return f
      ? locale === 'en'
        ? f.labelEn
        : f.labelVi
      : (definition.calculatedFields.find((c) => c.id === id)?.label ?? id);
  };
  const groups = [...definition.rows, ...definition.groupBy, ...definition.pivotColumns].filter(
    (g, index, all) =>
      all.findIndex((item) => item.fieldId === g.fieldId && item.granularity === g.granularity) ===
      index,
  );
  const filterValue = (fieldId: string, value: unknown, operator: string): string => {
    if (operator === 'relative_date')
      return msg.filterBuilder.relativeDates[String(value)] ?? String(value);
    if (typeof value === 'boolean') return value ? msg.common.yes : msg.common.no;
    const meta = fields.find((f) => f.id === fieldId);
    const format = (item: unknown) => {
      const option = meta?.enumValues?.find((entry) => entry.value === String(item));
      return option ? (locale === 'en' ? option.labelEn : option.labelVi) : String(item);
    };
    return Array.isArray(value) ? value.map(format).join(', ') : format(value);
  };
  const describeFilters = (group: FilterGroup): string =>
    [
      ...group.rules.map(
        (r) =>
          `${fieldLabel(r.fieldId)} ${msg.filterBuilder.operators[r.operator] ?? r.operator}${r.value === undefined ? '' : ` ${filterValue(r.fieldId, r.value, r.operator)}`}${r.valueTo === undefined ? '' : ` – ${filterValue(r.fieldId, r.valueTo, r.operator)}`}`,
      ),
      ...group.groups.map((g) => `(${describeFilters(g)})`),
    ].join(
      ` ${group.combinator === 'AND' ? msg.filterBuilder.combinatorAnd : msg.filterBuilder.combinatorOr} `,
    );
  return (
    <details className="rbs-report-overview" open={expanded}>
      <summary>{t.overview}</summary>
      <p>
        {definition.values.length
          ? groups.length
            ? t.groupedSummary
            : t.totalSummary
          : t.detailSummary}
      </p>
      <dl>
        <dt>{t.source}</dt>
        <dd>
          {source ? (locale === 'en' ? source.labelEn : source.labelVi) : definition.primaryEntity}
        </dd>
        <dt>{t.grainLabel}</dt>
        <dd>{sourceGrain(definition.primaryEntity, locale)}</dd>
        {definition.relatedEntities.length > 0 && (
          <>
            <dt>{t.related}</dt>
            <dd>
              {definition.relatedEntities
                .map((id) => {
                  const e = entities.find((item) => item.id === id);
                  return e ? (locale === 'en' ? e.labelEn : e.labelVi) : id;
                })
                .join(', ')}
            </dd>
          </>
        )}
        {definition.columns.length > 0 && (
          <>
            <dt>{t.columns}</dt>
            <dd>{definition.columns.map((c) => c.label || fieldLabel(c.fieldId)).join(', ')}</dd>
          </>
        )}
        {groups.length > 0 && (
          <>
            <dt>{t.groups}</dt>
            <dd>
              {groups
                .map(
                  (g) =>
                    `${g.label || fieldLabel(g.fieldId)}${g.granularity ? ` (${msg.config.granularities[g.granularity]})` : ''}`,
                )
                .join(', ')}
            </dd>
          </>
        )}
        {definition.values.length > 0 && (
          <>
            <dt>{t.metrics}</dt>
            <dd>
              {definition.values
                .map(
                  (v) =>
                    `${v.label || fieldLabel(v.fieldId)} · ${msg.aggregations[v.aggregation] ?? v.aggregation}`,
                )
                .join('; ')}
            </dd>
          </>
        )}
        <dt>{t.scope}</dt>
        <dd>
          {countReportFilters(definition.filters)
            ? describeFilters(definition.filters)
            : t.noFilters}
        </dd>
      </dl>
      {definition.relatedEntities.includes('departments') &&
        ['employees', 'contracts', 'attendance', 'leave_requests', 'payroll_slips'].includes(
          definition.primaryEntity,
        ) && <p className="rbs-guide-note">{t.departmentNote}</p>}
    </details>
  );
}
