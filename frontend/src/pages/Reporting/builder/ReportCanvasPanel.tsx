import { useMemo, useState } from 'react';
import { SlideDialog } from '../../../components/common/SlideDialog';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import { reportBuilderGuideMessages } from '../reportBuilderGuideMessages';
import { ReportCharts } from './ReportCharts';
import type {
  ConditionalFormattingRule,
  ReportDefinition,
  ReportExecutionResult,
  ResultColumn,
  VisualizationType,
} from './reportBuilderTypes';
import { formatCellValue } from './useReportBuilderHistory';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  reportName: string;
  definition: ReportDefinition;
  result: ReportExecutionResult | null;
  loading: boolean;
  error: string | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onChangeVizType: (viz: VisualizationType) => void;
  onSortColumn: (fieldId: string) => void;
  onChangePage: (page: number) => void;
  onChangePageSize: (size: number) => void;
  onRetry: () => void;
  onRunReport: () => void;
  onDrilldown: (
    dimFilters: Array<{
      fieldId: string;
      value: unknown;
      granularity?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
    }>,
  ) => Promise<{
    columns: ResultColumn[];
    rows: Array<Record<string, unknown>>;
    totalRows: number;
  }>;
}

const CHART_VIZ_TYPES: VisualizationType[] = [
  'BAR',
  'COLUMN',
  'LINE',
  'AREA',
  'PIE',
  'DONUT',
  'STACKED_BAR',
  'COMBO',
  'HEATMAP',
  'KPI',
];

function evalConditionalClass(
  value: unknown,
  colKey: string,
  rules: ConditionalFormattingRule[],
): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  for (const r of rules) {
    if (r.targetFieldId !== colKey) continue;
    let match = false;
    if (r.operator === 'gt') match = num > r.threshold;
    else if (r.operator === 'gte') match = num >= r.threshold;
    else if (r.operator === 'lt') match = num < r.threshold;
    else if (r.operator === 'lte') match = num <= r.threshold;
    else if (r.operator === 'eq') match = num === r.threshold;
    if (match) return `rbs-cond-${r.tone}`;
  }
  return '';
}

export function ReportCanvasPanel({
  locale,
  msg,
  reportName,
  definition,
  result,
  loading,
  error,
  isFullscreen,
  onToggleFullscreen,
  onChangeVizType,
  onSortColumn,
  onChangePage,
  onChangePageSize,
  onRetry,
  onRunReport,
  onDrilldown,
}: Props) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [drillState, setDrillState] = useState<{
    open: boolean;
    loading: boolean;
    columns: ResultColumn[];
    rows: Array<Record<string, unknown>>;
    totalRows: number;
  }>({ open: false, loading: false, columns: [], rows: [], totalRows: 0 });

  const viz = definition.visualizationType;
  const isChartMode = viz !== 'TABLE' && viz !== 'PIVOT';

  const measureColumns = useMemo(
    () =>
      result
        ? result.columns.filter(
            (c) => c.isMeasure || c.dataType === 'number' || c.dataType === 'currency',
          )
        : [],
    [result],
  );

  const groupedBlocks = useMemo(() => {
    if (!result || result.mode !== 'GROUPED' || definition.groupBy.length < 2) return null;
    const primaryDim = result.columns[0];
    if (!primaryDim) return null;
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const r of result.rows) {
      const k = String(r[primaryDim.key] ?? '—');
      const list = groups.get(k) ?? [];
      list.push(r);
      groups.set(k, list);
    }
    return { primaryDim, entries: [...groups.entries()] };
  }, [result, definition.groupBy.length]);

  const startResize = (key: string, startX: number, initialWidth: number) => {
    const onMove = (e: MouseEvent) => {
      const next = Math.max(90, Math.min(460, initialWidth + (e.clientX - startX)));
      setColWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const triggerDrilldown = async (row: Record<string, unknown>) => {
    if (!result) return;
    const dimCols = result.columns.filter((c) => !c.isMeasure);
    const filters = dimCols.map((c) => {
      const dimDef = [...definition.rows, ...definition.groupBy, ...definition.pivotColumns].find(
        (d) =>
          (d.granularity ? `${d.fieldId}__${d.granularity}` : d.fieldId) === c.key ||
          d.fieldId === c.fieldId,
      );
      return {
        fieldId: c.fieldId,
        value: row[c.key],
        granularity: dimDef?.granularity,
      };
    });
    setDrillState({ open: true, loading: true, columns: [], rows: [], totalRows: 0 });
    try {
      const data = await onDrilldown(filters);
      setDrillState({
        open: true,
        loading: false,
        columns: data.columns,
        rows: data.rows,
        totalRows: data.totalRows,
      });
    } catch {
      setDrillState({ open: true, loading: false, columns: [], rows: [], totalRows: 0 });
    }
  };

  return (
    <section className="rbs-panel rbs-panel-center" aria-label={msg.studioTitle}>
      <div className="rbs-canvas-head">
        <div className="rbs-canvas-title-row">
          <div>
            <h2 className="rbs-canvas-title">{reportName || msg.studioTitle}</h2>
            <p className="rbs-canvas-sub">{msg.canvas.previewSubtitle}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            {result && (
              <>
                <span className="rbs-pill">
                  {`${msg.canvas.totalRows}: ${result.pagination.totalRows}`}
                </span>
                <span className="rbs-pill">{`${result.meta.executionMs}ms`}</span>
                {result.meta.cached && (
                  <span className="rbs-pill rbs-pill-brand">{msg.canvas.cachedBadge}</span>
                )}
              </>
            )}
            <button type="button" className="rbs-btn sm" onClick={onToggleFullscreen}>
              {isFullscreen ? msg.toolbar.exitFullscreen : msg.toolbar.fullscreen}
            </button>
          </div>
        </div>

        <div className="rbs-canvas-switcher-row">
          <div
            className="rbs-view-pills"
            role="tablist"
            aria-label={msg.config.sections.visualizationSettings}
          >
            <button
              type="button"
              role="tab"
              aria-selected={viz === 'TABLE'}
              className={`rbs-view-pill ${viz === 'TABLE' ? 'active' : ''}`}
              onClick={() => onChangeVizType('TABLE')}
            >
              {msg.canvas.tabTable}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viz === 'PIVOT'}
              className={`rbs-view-pill ${viz === 'PIVOT' ? 'active' : ''}`}
              onClick={() => onChangeVizType('PIVOT')}
            >
              {msg.canvas.tabPivot}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isChartMode}
              className={`rbs-view-pill ${isChartMode ? 'active' : ''}`}
              onClick={() => onChangeVizType(isChartMode ? viz : 'BAR')}
            >
              {msg.canvas.tabChart}
            </button>
          </div>

          {isChartMode && (
            <div style={{ minWidth: '210px' }}>
              <select
                aria-label={msg.canvas.chartTypeLabel}
                className="rbs-select"
                value={viz}
                onChange={(e) => onChangeVizType(e.target.value as VisualizationType)}
              >
                {CHART_VIZ_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {msg.canvas.views[ct]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="rbs-canvas-body">
        {!loading && !error && result && result.rows.length === 0 && (
          <p className="rbs-guide-note" role="status">
            {reportBuilderGuideMessages[locale].emptyResult}
          </p>
        )}
        {loading && <div className="rbs-status-box">{msg.toolbar.running}</div>}

        {!loading && error && (
          <div className="rbs-status-box" role="alert">
            <h3 style={{ color: '#b91c1c' }}>{msg.canvas.errorBannerTitle}</h3>
            <p style={{ color: '#64748b' }}>{error}</p>
            <button type="button" className="rbs-btn primary" onClick={onRetry}>
              {msg.canvas.retryBtn}
            </button>
          </div>
        )}

        {!loading && !error && !result && (
          <div className="rbs-status-box">
            <h3>{msg.canvas.emptyPromptTitle}</h3>
            <p style={{ color: '#64748b', maxWidth: 460, margin: '8px auto 16px' }}>
              {msg.canvas.emptyPromptBody}
            </p>
            <button type="button" className="rbs-btn primary" onClick={onRunReport}>
              {msg.toolbar.runReport}
            </button>
          </div>
        )}

        {!loading && !error && result && (
          <>
            {/* KPI Summary Strip above Table / Chart (mirrors SaaS Mockup) */}
            {viz !== 'KPI' && measureColumns.length > 0 && (
              <div className="rbs-kpi-grid">
                <div className="rbs-kpi-card">
                  <div className="rbs-kpi-label">{msg.canvas.totalRows}</div>
                  <div className="rbs-kpi-value">{result.pagination.totalRows}</div>
                </div>
                {measureColumns.slice(0, 3).map((m) => {
                  const totalVal =
                    result.totals && result.totals[m.key] !== undefined
                      ? result.totals[m.key]
                      : result.rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0);
                  return (
                    <div key={m.key} className="rbs-kpi-card">
                      <div className="rbs-kpi-label">{m.label}</div>
                      <div className="rbs-kpi-value">
                        {formatCellValue(totalVal, m.format, locale)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Hybrid Summary Bar Preview when in grouped TABLE mode */}
            {viz === 'TABLE' &&
              result.mode === 'GROUPED' &&
              result.rows.length > 0 &&
              result.rows.length <= 12 &&
              measureColumns.length > 0 && (
                <ReportCharts
                  locale={locale}
                  msg={msg}
                  vizType="BAR"
                  definition={definition}
                  result={result}
                />
              )}

            {viz === 'PIVOT' && result.pivot ? (
              (() => {
                const p = result.pivot!;
                const pMeasures = p.measures ?? p.measureKeys ?? [];
                const pRowDims = p.rowDimensions ?? [
                  {
                    key: result.columns[0]?.key ?? 'row',
                    label: result.columns.find((c) => !c.isMeasure)?.label ?? '—',
                  },
                ];
                const pRows = p.rows
                  ? p.rows
                  : (p.rowKeys ?? []).map((rk) => ({
                      dimensions: { [pRowDims[0].key]: rk.label },
                      cells: p.cells?.[rk.key] ?? {},
                      rowTotals: p.rowTotals?.[rk.key] ?? {},
                    }));
                const pColTotals = p.columnTotals ?? p.colTotals ?? {};
                return (
                  <div className="rbs-table-wrap">
                    <table className="rbs-table">
                      <thead>
                        <tr>
                          {pRowDims.map((rd) => (
                            <th key={rd.key}>{rd.label}</th>
                          ))}
                          {p.pivotKeys.map((pk) =>
                            pMeasures.map((mk) => (
                              <th key={`${pk}-${mk.id}`} className="rbs-num">
                                {`${pk} · ${mk.label}`}
                              </th>
                            )),
                          )}
                          {definition.showGrandTotal &&
                            pMeasures.map((mk) => (
                              <th key={`tot-${mk.id}`} className="rbs-num">
                                {`${msg.canvas.grandTotal} · ${mk.label}`}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pRows.map((pRow, rIdx) => (
                          <tr key={rIdx}>
                            {pRowDims.map((rd) => (
                              <td key={rd.key}>
                                <strong>{pRow.dimensions[rd.key] ?? '—'}</strong>
                              </td>
                            ))}
                            {p.pivotKeys.map((pk) =>
                              pMeasures.map((mk) => {
                                const val = pRow.cells?.[pk]?.[mk.id] ?? 0;
                                return (
                                  <td key={`${rIdx}-${pk}-${mk.id}`} className="rbs-num">
                                    {formatCellValue(val, mk.format, locale)}
                                  </td>
                                );
                              }),
                            )}
                            {definition.showGrandTotal &&
                              pMeasures.map((mk) => (
                                <td key={`${rIdx}-tot-${mk.id}`} className="rbs-num">
                                  <strong>
                                    {formatCellValue(
                                      pRow.rowTotals?.[mk.id] ?? 0,
                                      mk.format,
                                      locale,
                                    )}
                                  </strong>
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                      {definition.showGrandTotal && (
                        <tfoot>
                          <tr>
                            <td colSpan={pRowDims.length}>{msg.canvas.grandTotal}</td>
                            {p.pivotKeys.map((pk) =>
                              pMeasures.map((mk) => (
                                <td key={`coltot-${pk}-${mk.id}`} className="rbs-num">
                                  {formatCellValue(pColTotals[pk]?.[mk.id] ?? 0, mk.format, locale)}
                                </td>
                              )),
                            )}
                            {pMeasures.map((mk) => (
                              <td key={`grand-${mk.id}`} className="rbs-num">
                                {formatCellValue(p.grandTotals[mk.id] ?? 0, mk.format, locale)}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                );
              })()
            ) : isChartMode ? (
              <ReportCharts
                locale={locale}
                msg={msg}
                vizType={viz}
                definition={definition}
                result={result}
              />
            ) : (
              <div className="rbs-table-wrap">
                <table className="rbs-table">
                  <thead>
                    <tr>
                      {result.columns.map((col) => {
                        const sortMatch = definition.sortBy.find(
                          (s) => s.fieldId === col.fieldId || s.fieldId === col.key,
                        );
                        const w = colWidths[col.key] ?? col.width ?? 140;
                        return (
                          <th
                            key={col.key}
                            style={{ minWidth: `${w}px` }}
                            className={col.isMeasure ? 'rbs-num' : ''}
                          >
                            <div className="rbs-th-inner">
                              <button
                                type="button"
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  font: 'inherit',
                                  color: 'inherit',
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                                title={msg.canvas.sortColumn}
                                onClick={() => onSortColumn(col.key)}
                              >
                                {col.label}
                                {sortMatch ? (sortMatch.direction === 'ASC' ? ' ▲' : ' ▼') : ''}
                              </button>
                              <span
                                className="rbs-col-resizer"
                                title={msg.canvas.resizeColumn}
                                onMouseDown={(e) => startResize(col.key, e.clientX, w)}
                              />
                            </div>
                          </th>
                        );
                      })}
                      {result.mode === 'GROUPED' && <th>{msg.canvas.drilldownAction}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedBlocks && definition.showSubtotals
                      ? groupedBlocks.entries.map(([gVal, rows]) => {
                          const collapsed = Boolean(collapsedGroups[gVal]);
                          const sub = result.subtotals?.find(
                            (s) =>
                              String(s[groupedBlocks.primaryDim.key] ?? s.groupValue ?? '') ===
                              gVal,
                          );
                          const metricsObj = sub
                            ? ((sub.metrics ?? sub) as Record<string, unknown>)
                            : null;
                          return (
                            <>
                              <tr key={`grp-${gVal}`} className="rbs-subtotal-row">
                                <td colSpan={result.columns.length + 1}>
                                  <button
                                    type="button"
                                    className="rbs-btn sm"
                                    aria-expanded={!collapsed}
                                    onClick={() =>
                                      setCollapsedGroups((p) => ({ ...p, [gVal]: !p[gVal] }))
                                    }
                                  >
                                    {collapsed ? '+' : '−'}
                                  </button>
                                  <strong
                                    style={{ marginLeft: '8px' }}
                                  >{`${gVal} (${rows.length})`}</strong>
                                  {metricsObj && (
                                    <span style={{ marginLeft: '14px', fontWeight: 500 }}>
                                      {result.columns
                                        .filter(
                                          (c) => c.isMeasure && metricsObj[c.key] !== undefined,
                                        )
                                        .map(
                                          (c) =>
                                            `${c.label}: ${formatCellValue(metricsObj[c.key], c.format, locale)}`,
                                        )
                                        .join(' · ')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                              {!collapsed &&
                                rows.map((row, idx) => (
                                  <tr key={`${gVal}-${idx}`}>
                                    {result.columns.map((col) => {
                                      const toneCls = evalConditionalClass(
                                        row[col.key],
                                        col.key,
                                        definition.conditionalFormatting,
                                      );
                                      return (
                                        <td
                                          key={col.key}
                                          className={`${col.isMeasure ? 'rbs-num' : ''} ${toneCls}`}
                                        >
                                          {formatCellValue(row[col.key], col.format, locale)}
                                        </td>
                                      );
                                    })}
                                    <td>
                                      <button
                                        type="button"
                                        className="rbs-btn sm"
                                        onClick={() => triggerDrilldown(row)}
                                      >
                                        {msg.canvas.drilldownAction}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </>
                          );
                        })
                      : result.rows.map((row, idx) => (
                          <tr key={idx}>
                            {result.columns.map((col) => {
                              const toneCls = evalConditionalClass(
                                row[col.key],
                                col.key,
                                definition.conditionalFormatting,
                              );
                              return (
                                <td
                                  key={col.key}
                                  className={`${col.isMeasure ? 'rbs-num' : ''} ${toneCls}`}
                                >
                                  {formatCellValue(row[col.key], col.format, locale)}
                                </td>
                              );
                            })}
                            {result.mode === 'GROUPED' && (
                              <td>
                                <button
                                  type="button"
                                  className="rbs-btn sm"
                                  onClick={() => triggerDrilldown(row)}
                                >
                                  {msg.canvas.drilldownAction}
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                  </tbody>
                  {definition.showGrandTotal && result.totals && (
                    <tfoot>
                      <tr>
                        {result.columns.map((col, idx) => (
                          <td key={col.key} className={col.isMeasure ? 'rbs-num' : ''}>
                            {idx === 0
                              ? msg.canvas.grandTotal
                              : result.totals![col.key] !== undefined
                                ? formatCellValue(result.totals![col.key], col.format, locale)
                                : ''}
                          </td>
                        ))}
                        {result.mode === 'GROUPED' && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            <div className="rbs-pagination">
              <div>
                {msg.canvas.pageInfo
                  .replace('{page}', String(result.pagination.page))
                  .replace('{totalPages}', String(result.pagination.totalPages))
                  .replace('{total}', String(result.pagination.totalRows))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label htmlFor="rbs-page-size">{msg.canvas.pageSizeLabel}</label>
                <select
                  id="rbs-page-size"
                  className="rbs-select"
                  style={{ width: 'auto' }}
                  value={result.pagination.pageSize}
                  onChange={(e) => onChangePageSize(Number(e.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <button
                  type="button"
                  className="rbs-btn sm"
                  disabled={result.pagination.page <= 1}
                  onClick={() => onChangePage(result.pagination.page - 1)}
                >
                  {msg.canvas.prevPage}
                </button>
                <button
                  type="button"
                  className="rbs-btn sm"
                  disabled={result.pagination.page >= result.pagination.totalPages}
                  onClick={() => onChangePage(result.pagination.page + 1)}
                >
                  {msg.canvas.nextPage}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {drillState.open && (
        <SlideDialog
          label={msg.canvas.drilldownTitle}
          onClose={() => setDrillState((s) => ({ ...s, open: false }))}
        >
          {drillState.loading ? (
            <p>{msg.common.loading}</p>
          ) : drillState.rows.length === 0 ? (
            <p>{msg.canvas.drilldownEmpty}</p>
          ) : (
            <div className="rbs-table-wrap">
              <table className="rbs-table">
                <thead>
                  <tr>
                    {drillState.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drillState.rows.map((r, i) => (
                    <tr key={i}>
                      {drillState.columns.map((c) => (
                        <td key={c.key}>{formatCellValue(r[c.key], c.format, locale)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SlideDialog>
      )}
    </section>
  );
}
