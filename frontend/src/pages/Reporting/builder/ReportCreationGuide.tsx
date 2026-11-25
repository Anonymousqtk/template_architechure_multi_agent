import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import { reportBuilderGuideMessages } from '../reportBuilderGuideMessages';
import { AdvancedFilterBuilder } from './AdvancedFilterBuilder';
import { FieldGuide, ReportOverview, countReportFilters, sourceGrain } from './ReportGuideInfo';
import {
  createEmptyReportDefinition,
  type AggregationFn,
  type EntityMeta,
  type FieldMeta,
  type ReportDefinition,
  type ReportExecutionResult,
} from './reportBuilderTypes';
import { formatCellValue } from './useReportBuilderHistory';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  entities: EntityMeta[];
  fields: FieldMeta[];
  result: ReportExecutionResult | null;
  resultDefinition: string | null;
  running: boolean;
  error: string | null;
  onPreview: (definition: ReportDefinition) => void;
  onComplete: (definition: ReportDefinition, name: string) => void;
  onCancel: () => void;
}

const simpleAggregations: AggregationFn[] = ['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX'];

export function ReportCreationGuide({
  locale,
  msg,
  entities,
  fields,
  result,
  resultDefinition,
  running,
  error,
  onPreview,
  onComplete,
  onCancel,
}: Props) {
  const t = reportBuilderGuideMessages[locale];
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'DETAIL' | 'SUMMARY'>('DETAIL');
  const [draft, setDraft] = useState(() => createEmptyReportDefinition(entities[0]?.id));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);
  const source = entities.find((e) => e.id === draft.primaryEntity);
  const available = fields.filter(
    (f) => f.entity === draft.primaryEntity || draft.relatedEntities.includes(f.entity),
  );
  const selected = available.filter((f) => selectedIds.includes(f.id));
  const label = (f: FieldMeta) => (locale === 'en' ? f.labelEn : f.labelVi);
  const definition: ReportDefinition =
    mode === 'DETAIL'
      ? {
          ...draft,
          columns: selected.map((f) => ({ fieldId: f.id })),
          rows: [],
          values: [],
          sortBy: [],
          visualizationType: 'TABLE',
        }
      : { ...draft, columns: [] };
  const stale = result && resultDefinition !== JSON.stringify(definition);
  const steps = [t.goal, t.source, t.content, t.scope, t.review];
  const aggs: Partial<Record<AggregationFn, string>> = {
    SUM: t.sum,
    COUNT: t.count,
    COUNT_DISTINCT: t.distinct,
    AVG: t.avg,
    MIN: t.min,
    MAX: t.max,
  };
  const calculationsFor = (f?: FieldMeta) =>
    simpleAggregations.filter((a) => f?.allowedAggregations.includes(a));
  const hasValidMetrics =
    draft.values.length > 0 &&
    draft.values.every((v) =>
      selected.some((f) => f.id === v.fieldId && calculationsFor(f).includes(v.aggregation)),
    );
  const canContinue =
    step === 1
      ? Boolean(source)
      : step === 2
        ? selected.length > 0
        : step === 3 && mode === 'SUMMARY'
          ? hasValidMetrics
          : true;
  const update = (next: Partial<ReportDefinition>) => setDraft((d) => ({ ...d, ...next }));
  const toggleField = (id: string) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
    update({
      values: draft.values.filter((v) => v.fieldId !== id),
      rows: draft.rows.filter((r) => r.fieldId !== id),
      visualizationType: 'TABLE',
      sortBy: [],
    });
  };
  const toggleRelated = (id: EntityMeta['id']) => {
    if (draft.relatedEntities.includes(id)) {
      const removed = new Set(fields.filter((f) => f.entity === id).map((f) => f.id));
      if (
        JSON.stringify(draft)
          .split('"')
          .some((part) => removed.has(part)) ||
        selectedIds.some((field) => removed.has(field))
      ) {
        window.alert(t.relatedInUse);
        return;
      }
    }
    update({
      relatedEntities: draft.relatedEntities.includes(id)
        ? draft.relatedEntities.filter((r) => r !== id)
        : [...draft.relatedEntities, id],
    });
  };
  const emptySelected = selected.length === 0;
  return (
    <div className="rbs-shell rbs-guide">
      <header className="rbs-guide-header">
        <button className="rbs-guide-back" type="button" onClick={onCancel}>
          <span aria-hidden="true">←</span>
          {t.cancel}
        </button>
        <div>
          <h2>{t.guideTitle}</h2>
          <p>{t.guideIntro}</p>
        </div>
      </header>
      <nav className="rbs-guide-navigation" aria-label={t.guideTitle}>
        <p className="rbs-guide-progress">
          {t.progress
            .replace('{current}', String(step + 1))
            .replace('{total}', String(steps.length))
            .replace('{step}', steps[step])}
        </p>
        <ol className="rbs-guide-steps">
          {steps.map((text, i) => (
            <li
              key={text}
              aria-current={step === i ? 'step' : undefined}
              data-state={i < step ? 'completed' : i === step ? 'current' : 'upcoming'}
              aria-label={`${i + 1}. ${text} · ${i < step ? t.completedStep : i === step ? t.currentStep : t.upcomingStep}`}
            >
              <span className="rbs-guide-step-marker" aria-hidden="true">
                {i < step ? '✓' : i + 1}
              </span>
              <span className="rbs-guide-step-label" aria-hidden="true">
                {i === 3 ? t.shortScope : text}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <section className="rbs-guide-card">
        <h3 ref={titleRef} tabIndex={-1}>
          {[t.goalQuestion, t.sourceQuestion, t.contentQuestion, t.scopeQuestion, t.review][step]}
        </h3>
        {step === 0 && (
          <>
            <p>{t.example}</p>
            <div className="rbs-guide-options">
              {(['DETAIL', 'SUMMARY'] as const).map((value) => (
                <button
                  key={value}
                  className="rbs-guide-choice"
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  <strong>{value === 'DETAIL' ? t.detail : t.summary}</strong>
                  <span>{value === 'DETAIL' ? t.detailHint : t.summaryHint}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            {!entities.length && <p role="status">{t.noSources}</p>}
            <div className="rbs-guide-options">
              {entities.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="rbs-guide-choice"
                  aria-pressed={draft.primaryEntity === e.id}
                  onClick={() => {
                    if (e.id === draft.primaryEntity) return;
                    if (
                      (selectedIds.length || countReportFilters(draft.filters)) &&
                      !window.confirm(t.resetSource)
                    )
                      return;
                    setDraft(createEmptyReportDefinition(e.id));
                    setSelectedIds([]);
                  }}
                >
                  <strong>{locale === 'en' ? e.labelEn : e.labelVi}</strong>
                  <span>{locale === 'en' ? e.descriptionEn : e.descriptionVi}</span>
                  <small>
                    {t.grainLabel}: {sourceGrain(e.id, locale)}
                  </small>
                </button>
              ))}
            </div>
            <h4>{t.related}</h4>
            <p>{t.relatedHint}</p>
            <div className="rbs-guide-related">
              {source?.relatedEntities.map((rel) => {
                const e = entities.find((item) => item.id === rel.entity);
                return (
                  e && (
                    <label key={rel.entity}>
                      <input
                        type="checkbox"
                        checked={draft.relatedEntities.includes(rel.entity)}
                        onChange={() => toggleRelated(rel.entity)}
                      />
                      <span>{locale === 'en' ? e.labelEn : e.labelVi}</span>
                    </label>
                  )
                );
              })}
            </div>
            <p className="rbs-guide-note">{t.unavailableJoin}</p>
          </>
        )}
        {step === 2 && (
          <>
            <input
              className="rbs-input"
              type="search"
              aria-label={t.search}
              placeholder={t.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p role="status">{t.selected.replace('{count}', String(selected.length))}</p>
            <div className="rbs-guide-fields">
              {available
                .filter((f) =>
                  `${label(f)} ${locale === 'en' ? f.descriptionEn : f.descriptionVi}`
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                )
                .map((f) => (
                  <div key={f.id} className="rbs-guide-field">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(f.id)}
                        onChange={() => toggleField(f.id)}
                      />
                      <strong>{label(f)}</strong>
                    </label>
                    <FieldGuide field={f} entities={entities} locale={locale} msg={msg} />
                  </div>
                ))}
            </div>
            {!available.some((f) =>
              `${label(f)} ${locale === 'en' ? f.descriptionEn : f.descriptionVi}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            ) && <p>{t.noFields}</p>}
            {emptySelected && <p>{t.selectFields}</p>}
          </>
        )}
        {step === 3 && (
          <>
            <p>{t.scopeHint}</p>
            <button type="button" className="rbs-btn" onClick={() => setFilterOpen(true)}>
              {t.filters}
            </button>
            <p>
              {countReportFilters(draft.filters)
                ? t.filterCount.replace('{count}', String(countReportFilters(draft.filters)))
                : t.noFilters}
            </p>
            {mode === 'SUMMARY' && (
              <>
                <label className="rbs-guide-control">
                  {t.group}
                  <select
                    className="rbs-select"
                    value={draft.rows[0]?.fieldId ?? ''}
                    onChange={(e) =>
                      update({
                        rows: e.target.value
                          ? [
                              {
                                fieldId: e.target.value,
                                ...(available.find((f) => f.id === e.target.value)?.dataType ===
                                'date'
                                  ? { granularity: 'MONTH' as const }
                                  : {}),
                              },
                            ]
                          : [],
                        visualizationType: 'TABLE',
                        sortBy: [],
                      })
                    }
                  >
                    <option value="">{t.allTogether}</option>
                    {selected
                      .filter((f) => f.groupable)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {label(f)}
                        </option>
                      ))}
                  </select>
                </label>
                {draft.rows[0] &&
                  available.find((f) => f.id === draft.rows[0].fieldId)?.dataType === 'date' && (
                    <label className="rbs-guide-control">
                      {msg.config.granularityLabel}
                      <select
                        className="rbs-select"
                        value={draft.rows[0].granularity ?? 'MONTH'}
                        onChange={(e) =>
                          update({
                            rows: [
                              {
                                ...draft.rows[0],
                                granularity: e.target.value as NonNullable<
                                  ReportDefinition['rows'][number]['granularity']
                                >,
                              },
                            ],
                          })
                        }
                      >
                        {(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const).map((key) => (
                          <option key={key} value={key}>
                            {msg.config.granularities[key]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                <div className="rbs-guide-metrics">
                  {draft.values.map((v) => (
                    <div key={v.id} className="rbs-guide-metric">
                      <label>
                        {t.measure}
                        <select
                          className="rbs-select"
                          value={v.fieldId}
                          onChange={(e) =>
                            update({
                              values: draft.values.map((item) =>
                                item.id === v.id
                                  ? {
                                      ...v,
                                      fieldId: e.target.value,
                                      aggregation:
                                        calculationsFor(
                                          selected.find((f) => f.id === e.target.value),
                                        )[0] ?? 'COUNT',
                                    }
                                  : item,
                              ),
                            })
                          }
                        >
                          {selected
                            .filter((f) => calculationsFor(f).length)
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {label(f)}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        {t.aggregation}
                        <select
                          className="rbs-select"
                          value={v.aggregation}
                          onChange={(e) =>
                            update({
                              values: draft.values.map((item) =>
                                item.id === v.id
                                  ? { ...v, aggregation: e.target.value as AggregationFn }
                                  : item,
                              ),
                            })
                          }
                        >
                          {calculationsFor(selected.find((f) => f.id === v.fieldId)).map((a) => (
                            <option key={a} value={a}>
                              {aggs[a]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="rbs-btn"
                        type="button"
                        onClick={() =>
                          update({ values: draft.values.filter((item) => item.id !== v.id) })
                        }
                      >
                        {t.removeMeasure}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="rbs-btn"
                  disabled={!selected.some((f) => calculationsFor(f).length)}
                  onClick={() => {
                    const f = selected.find((item) => calculationsFor(item).length);
                    if (f)
                      update({
                        values: [
                          ...draft.values,
                          {
                            id: crypto.randomUUID(),
                            fieldId: f.id,
                            aggregation: calculationsFor(f)[0],
                          },
                        ],
                      });
                  }}
                >
                  {t.addMeasure}
                </button>
                {!hasValidMetrics && <p>{t.needMeasure}</p>}
                <p className="rbs-guide-note">{t.countWarning}</p>
                <label className="rbs-guide-control">
                  {t.visualization}
                  <select
                    className="rbs-select"
                    value={draft.visualizationType}
                    onChange={(e) =>
                      update({
                        visualizationType: e.target.value as ReportDefinition['visualizationType'],
                        sortBy:
                          e.target.value === 'LINE' && draft.rows[0]
                            ? [{ fieldId: draft.rows[0].fieldId, direction: 'ASC' }]
                            : [],
                      })
                    }
                  >
                    <option value="TABLE">{t.table}</option>
                    <option value="BAR" disabled={!draft.rows.length || !hasValidMetrics}>
                      {t.bar}
                    </option>
                    <option
                      value="LINE"
                      disabled={
                        !draft.rows.length ||
                        !hasValidMetrics ||
                        available.find((f) => f.id === draft.rows[0].fieldId)?.dataType !== 'date'
                      }
                    >
                      {t.line}
                    </option>
                  </select>
                </label>
                <p>{t.chartHint}</p>
              </>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <label className="rbs-guide-control">
              {t.name}
              <input
                className="rbs-input"
                maxLength={200}
                value={name}
                placeholder={t.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {!name.trim() && <p>{t.needName}</p>}
            <ReportOverview
              definition={definition}
              entities={entities}
              fields={fields}
              locale={locale}
              msg={msg}
            />
            <p>{t.previewHint}</p>
            <button
              type="button"
              className="rbs-btn"
              disabled={running}
              onClick={() => onPreview(definition)}
            >
              {running ? msg.toolbar.running : t.preview}
            </button>
            {error && (
              <p role="alert" className="rbs-guide-note">
                {error}
              </p>
            )}
            {stale && (
              <p role="status" className="rbs-guide-note">
                {t.stale}
              </p>
            )}
            {result && (
              <>
                <p>{t.previewRows}</p>
                <div className="rbs-guide-preview">
                  <table>
                    <thead>
                      <tr>
                        {result.columns.map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          {result.columns.map((c) => (
                            <td key={c.key}>{formatCellValue(row[c.key], c.format, locale)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!result.rows.length && <p>{t.emptyResult}</p>}
              </>
            )}
            <p>{t.finishHint}</p>
          </>
        )}
      </section>
      <details className="rbs-guide-glossary">
        <summary>{t.glossary}</summary>
        <p>{t.glossaryBody}</p>
      </details>
      <footer className="rbs-guide-footer">
        <button
          type="button"
          className="rbs-btn"
          disabled={step === 0}
          onClick={() => setStep((s) => s - 1)}
        >
          {t.back}
        </button>
        {step < 4 ? (
          <button
            type="button"
            className="rbs-btn primary"
            disabled={!canContinue}
            onClick={() => setStep((s) => s + 1)}
          >
            {t.next}
          </button>
        ) : (
          <button
            type="button"
            className="rbs-btn primary"
            disabled={
              !name.trim() || running || (mode === 'SUMMARY' ? !hasValidMetrics : emptySelected)
            }
            onClick={() => onComplete(definition, name.trim())}
          >
            {t.finish}
          </button>
        )}
      </footer>
      {filterOpen && (
        <AdvancedFilterBuilder
          simple
          locale={locale}
          msg={msg}
          availableFields={available}
          rootGroup={draft.filters}
          onApply={(filters) => {
            update({ filters });
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}
