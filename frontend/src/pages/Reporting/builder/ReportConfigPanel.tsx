import { useMemo, useState } from 'react';
import { SearchableSelect } from '../../../components/common/SearchableSelect';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import type {
  AggregationFn,
  ConditionalFormattingRule,
  DateGranularity,
  DropZoneName,
  FieldFormat,
  FieldMeta,
  FilterRule,
  ReportDefinition,
} from './reportBuilderTypes';
import { addFieldToZone, canDropFieldInZone } from './useReportBuilderHistory';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  definition: ReportDefinition;
  fieldMap: Map<string, FieldMeta>;
  availableFields: FieldMeta[];
  running: boolean;
  onChangeDefinition: (next: ReportDefinition) => void;
  onOpenFilterBuilder: () => void;
  onRunReport: () => void;
  onCloseDrawer?: () => void;
}

type SelectedItem =
  | { zone: 'columns'; index: number }
  | { zone: 'rows' | 'pivotColumns' | 'groupBy'; index: number }
  | { zone: 'values'; index: number }
  | { zone: 'sortBy'; index: number }
  | null;

const ALL_FORMATS: FieldFormat[] = [
  'text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'boolean',
];

function collectFlatRules(group: ReportDefinition['filters']): FilterRule[] {
  return [...group.rules, ...group.groups.flatMap((g) => collectFlatRules(g))];
}

function removeRuleById(
  group: ReportDefinition['filters'],
  ruleId: string,
): ReportDefinition['filters'] {
  return {
    ...group,
    rules: group.rules.filter((r) => r.id !== ruleId),
    groups: group.groups.map((g) => removeRuleById(g, ruleId)),
  };
}

export function ReportConfigPanel({
  locale,
  msg,
  definition,
  fieldMap,
  availableFields,
  running,
  onChangeDefinition,
  onOpenFilterBuilder,
  onRunReport,
  onCloseDrawer,
}: Props) {
  const [tab, setTab] = useState<'FIELDS' | 'CUSTOMIZE'>('FIELDS');
  const [overZone, setOverZone] = useState<DropZoneName | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [inlinePickerZone, setInlinePickerZone] = useState<DropZoneName | null>(null);

  const getFieldLabel = (fieldId: string, override?: string) => {
    if (override) return override;
    const meta = fieldMap.get(fieldId);
    if (!meta) return fieldId;
    return locale === 'en' ? meta.labelEn : meta.labelVi;
  };

  const handleDrop = (zone: DropZoneName, fieldId: string) => {
    setOverZone(null);
    const field = fieldMap.get(fieldId);
    if (!field) return;
    if (!canDropFieldInZone(field, zone)) {
      setDropError(msg.config.incompatibleField);
      return;
    }
    setDropError(null);
    const updated = addFieldToZone(definition, field, zone);
    if (updated) onChangeDefinition(updated);
  };

  const handleInlineAdd = (zone: DropZoneName, fieldId: string) => {
    const field = fieldMap.get(fieldId);
    if (!field) return;
    const updated = addFieldToZone(definition, field, zone);
    if (updated) onChangeDefinition(updated);
    setInlinePickerZone(null);
  };

  const moveItem = <T,>(arr: T[], idx: number, dir: -1 | 1): T[] => {
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return arr;
    const copy = [...arr];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    return copy;
  };

  const removeFromZone = (zone: DropZoneName, idx: number) => {
    if (selected?.zone === zone && selected.index === idx) setSelected(null);
    onChangeDefinition({
      ...definition,
      [zone]: (definition[zone] as unknown[]).filter((_, i) => i !== idx),
    });
  };

  const moveInZone = (zone: DropZoneName, idx: number, dir: -1 | 1) => {
    onChangeDefinition({
      ...definition,
      [zone]: moveItem(definition[zone] as unknown[], idx, dir),
    });
  };

  const duplicateValue = (idx: number) => {
    const src = definition.values[idx];
    if (!src) return;
    const clone = { ...src, id: `m_${src.fieldId}_${Date.now().toString(36)}` };
    onChangeDefinition({
      ...definition,
      values: [...definition.values.slice(0, idx + 1), clone, ...definition.values.slice(idx + 1)],
    });
  };

  const flatFilters = useMemo(() => collectFlatRules(definition.filters), [definition.filters]);

  const measureFieldsForRules = useMemo(() => {
    const items: Array<{ id: string; label: string }> = definition.values.map((v) => ({
      id: v.id,
      label: `${getFieldLabel(v.fieldId, v.label)} (${v.aggregation})`,
    }));
    for (const c of definition.calculatedFields) {
      items.push({ id: c.id, label: c.label });
    }
    return items;
  }, [definition.values, definition.calculatedFields, locale, fieldMap]);

  const addConditionalRule = () => {
    const firstTarget = measureFieldsForRules[0]?.id ?? definition.columns[0]?.fieldId;
    if (!firstTarget) return;
    const rule: ConditionalFormattingRule = {
      id: `cf_${Date.now().toString(36)}`,
      targetFieldId: firstTarget,
      operator: 'gte',
      threshold: 0,
      tone: 'success',
    };
    onChangeDefinition({
      ...definition,
      conditionalFormatting: [...definition.conditionalFormatting, rule],
    });
  };

  const compatibleOptionsFor = (zone: DropZoneName) =>
    availableFields
      .filter((f) => canDropFieldInZone(f, zone))
      .map((f) => ({
        value: f.id,
        label: locale === 'en' ? f.labelEn : f.labelVi,
      }));

  const selectedMeta = useMemo(() => {
    if (!selected) return null;
    if (selected.zone === 'columns') {
      const c = definition.columns[selected.index];
      if (!c) return null;
      return { type: 'column' as const, item: c, meta: fieldMap.get(c.fieldId) };
    }
    if (selected.zone === 'values') {
      const v = definition.values[selected.index];
      if (!v) return null;
      return { type: 'value' as const, item: v, meta: fieldMap.get(v.fieldId) };
    }
    if (selected.zone === 'sortBy') {
      const s = definition.sortBy[selected.index];
      if (!s) return null;
      return { type: 'sort' as const, item: s, meta: fieldMap.get(s.fieldId) };
    }
    const d = definition[selected.zone][selected.index];
    if (!d) return null;
    return { type: 'dimension' as const, item: d, meta: fieldMap.get(d.fieldId) };
  }, [selected, definition, fieldMap]);

  const renderInlineAdder = (zone: DropZoneName) =>
    inlinePickerZone === zone ? (
      <div className="rbs-inline-picker">
        <SearchableSelect
          value=""
          placeholder={msg.config.addFieldInline}
          options={compatibleOptionsFor(zone)}
          searchPlaceholder={msg.explorer.searchFields}
          onChange={(val) => val && handleInlineAdd(zone, val)}
        />
      </div>
    ) : (
      <button
        type="button"
        className="rbs-add-inline-btn"
        onClick={() => setInlinePickerZone(zone)}
      >
        {msg.config.addFieldInline}
      </button>
    );

  const renderDimensionZone = (zone: 'rows' | 'pivotColumns' | 'groupBy') => {
    const items = definition[zone];
    return (
      <div className="rbs-zone-wrapper">
        <div className="rbs-zone-caption">
          <span>{msg.config.zones[zone]}</span>
          <span>{items.length}</span>
        </div>
        <div
          className={`rbs-dropzone ${overZone === zone ? 'is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOverZone(zone);
          }}
          onDragLeave={() => setOverZone(null)}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(zone, e.dataTransfer.getData('text/plain'));
          }}
        >
          {items.map((item, idx) => (
            <div
              key={`${item.fieldId}-${idx}`}
              className={`rbs-chip ${selected?.zone === zone && selected.index === idx ? 'selected' : ''}`}
              onClick={() => {
                setSelected({ zone, index: idx });
                setTab('CUSTOMIZE');
              }}
            >
              <span className="rbs-chip-label">
                {getFieldLabel(item.fieldId, item.label)}
                {item.granularity ? ` · ${msg.config.granularities[item.granularity]}` : ''}
              </span>
              <span className="rbs-chip-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rbs-chip-btn"
                  aria-label={msg.config.moveUp}
                  onClick={() => moveInZone(zone, idx, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rbs-chip-btn"
                  aria-label={msg.config.moveDown}
                  onClick={() => moveInZone(zone, idx, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rbs-chip-btn"
                  aria-label={msg.config.removeField}
                  onClick={() => removeFromZone(zone, idx)}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
          {renderInlineAdder(zone)}
        </div>
      </div>
    );
  };

  return (
    <aside className="rbs-panel rbs-panel-right" aria-label={msg.config.title}>
      <div className="rbs-panel-header">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div>
            <h2>{msg.config.title}</h2>
            <p className="rbs-panel-subtitle">{msg.config.subtitle}</p>
          </div>
          {onCloseDrawer && (
            <button
              type="button"
              className="rbs-btn sm icon-only rbs-drawer-close"
              aria-label={msg.responsive.closePanel}
              onClick={onCloseDrawer}
            >
              ×
            </button>
          )}
        </div>
        <div
          className="rbs-seg-tabs"
          style={{
            marginTop: '10px',
            width: '100%',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
          }}
        >
          <button
            type="button"
            className={`rbs-seg-btn ${tab === 'FIELDS' ? 'active' : ''}`}
            onClick={() => setTab('FIELDS')}
          >
            {msg.config.tabFields}
          </button>
          <button
            type="button"
            className={`rbs-seg-btn ${tab === 'CUSTOMIZE' ? 'active' : ''}`}
            onClick={() => setTab('CUSTOMIZE')}
          >
            {msg.config.tabCustomize}
          </button>
        </div>
      </div>

      <div className="rbs-panel-scroll">
        {dropError && (
          <div className="rbs-pill danger" role="alert">
            {dropError}
          </div>
        )}

        {tab === 'FIELDS' ? (
          <>
            {/* Columns Zone */}
            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.zones.columns}</span>
                <span>{definition.columns.length}</span>
              </div>
              <div
                className={`rbs-dropzone ${overZone === 'columns' ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverZone('columns');
                }}
                onDragLeave={() => setOverZone(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop('columns', e.dataTransfer.getData('text/plain'));
                }}
              >
                {definition.columns.map((c, idx) => (
                  <div
                    key={`${c.fieldId}-${idx}`}
                    className={`rbs-chip ${selected?.zone === 'columns' && selected.index === idx ? 'selected' : ''}`}
                    onClick={() => {
                      setSelected({ zone: 'columns', index: idx });
                      setTab('CUSTOMIZE');
                    }}
                  >
                    <span className="rbs-chip-label">{getFieldLabel(c.fieldId, c.label)}</span>
                    <span className="rbs-chip-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.config.moveUp}
                        onClick={() => moveInZone('columns', idx, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.config.moveDown}
                        onClick={() => moveInZone('columns', idx, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.config.removeField}
                        onClick={() => removeFromZone('columns', idx)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
                {renderInlineAdder('columns')}
              </div>
            </div>

            {renderDimensionZone('rows')}
            {renderDimensionZone('groupBy')}
            {renderDimensionZone('pivotColumns')}

            {/* Values / Measures Zone */}
            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.zones.values}</span>
                <span>{definition.values.length}</span>
              </div>
              <div
                className={`rbs-dropzone ${overZone === 'values' ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverZone('values');
                }}
                onDragLeave={() => setOverZone(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop('values', e.dataTransfer.getData('text/plain'));
                }}
              >
                {definition.values.map((v, idx) => (
                  <div
                    key={v.id}
                    className={`rbs-chip ${selected?.zone === 'values' && selected.index === idx ? 'selected' : ''}`}
                    onClick={() => {
                      setSelected({ zone: 'values', index: idx });
                      setTab('CUSTOMIZE');
                    }}
                  >
                    <span className="rbs-chip-label">
                      {`${v.aggregation} · ${getFieldLabel(v.fieldId, v.label)}`}
                    </span>
                    <span className="rbs-chip-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.config.duplicateValue}
                        title={msg.config.duplicateValue}
                        onClick={() => duplicateValue(idx)}
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.config.removeField}
                        onClick={() => removeFromZone('values', idx)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
                {renderInlineAdder('values')}
              </div>
            </div>

            {/* Filters Zone */}
            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.zones.filters}</span>
                <span>{flatFilters.length}</span>
              </div>
              <div className="rbs-dropzone">
                {flatFilters.map((r) => {
                  const valText = Array.isArray(r.value)
                    ? r.value.join(', ')
                    : r.value !== undefined && r.value !== ''
                      ? String(r.value)
                      : (msg.filterBuilder.operators[r.operator] ?? r.operator);
                  return (
                    <div key={r.id} className="rbs-chip" onClick={onOpenFilterBuilder}>
                      <span className="rbs-chip-label">
                        {`${getFieldLabel(r.fieldId)} · ${valText}`}
                      </span>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.filterBuilder.removeRule}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChangeDefinition({
                            ...definition,
                            filters: removeRuleById(definition.filters, r.id),
                          });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <button type="button" className="rbs-add-inline-btn" onClick={onOpenFilterBuilder}>
                  {msg.filterBuilder.title}
                </button>
              </div>
            </div>

            {/* Sort By Zone */}
            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.zones.sortBy}</span>
                <span>{definition.sortBy.length}</span>
              </div>
              <div
                className={`rbs-dropzone ${overZone === 'sortBy' ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverZone('sortBy');
                }}
                onDragLeave={() => setOverZone(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop('sortBy', e.dataTransfer.getData('text/plain'));
                }}
              >
                {definition.sortBy.map((s, idx) => (
                  <div key={`${s.fieldId}-${idx}`} className="rbs-chip">
                    <span className="rbs-chip-label">{`${getFieldLabel(s.fieldId)} (${s.direction})`}</span>
                    <span className="rbs-chip-actions">
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        onClick={() => {
                          const copy = [...definition.sortBy];
                          copy[idx] = { ...s, direction: s.direction === 'ASC' ? 'DESC' : 'ASC' };
                          onChangeDefinition({ ...definition, sortBy: copy });
                        }}
                      >
                        {s.direction === 'ASC' ? '↑' : '↓'}
                      </button>
                      <button
                        type="button"
                        className="rbs-chip-btn"
                        aria-label={msg.config.removeField}
                        onClick={() => removeFromZone('sortBy', idx)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
                {renderInlineAdder('sortBy')}
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {selected && selectedMeta && (
              <div className="rbs-zone-wrapper">
                <div className="rbs-zone-caption">
                  <span>{msg.config.sections.fieldSettings}</span>
                </div>
                <div className="rbs-dropzone" style={{ borderStyle: 'solid', background: '#fff' }}>
                  {selectedMeta.type !== 'sort' && (
                    <div>
                      <label className="rbs-label">{msg.config.renameLabel}</label>
                      <input
                        className="rbs-input"
                        value={selectedMeta.item.label ?? ''}
                        placeholder={msg.config.defaultLabel}
                        onChange={(e) => {
                          const val = e.target.value || undefined;
                          const zone = selected.zone;
                          const arr = [
                            ...(definition[zone] as unknown as Array<Record<string, unknown>>),
                          ];
                          arr[selected.index] = { ...arr[selected.index], label: val };
                          onChangeDefinition({ ...definition, [zone]: arr });
                        }}
                      />
                    </div>
                  )}

                  {selectedMeta.type === 'value' && selectedMeta.meta && (
                    <div>
                      <label className="rbs-label">{msg.config.aggregationLabel}</label>
                      <select
                        className="rbs-select"
                        value={selectedMeta.item.aggregation}
                        onChange={(e) => {
                          const arr = [...definition.values];
                          arr[selected.index] = {
                            ...arr[selected.index],
                            aggregation: e.target.value as AggregationFn,
                          };
                          onChangeDefinition({ ...definition, values: arr });
                        }}
                      >
                        {selectedMeta.meta.allowedAggregations.map((agg) => (
                          <option key={agg} value={agg}>
                            {msg.aggregations[agg] ?? agg}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {selectedMeta.type === 'dimension' && selectedMeta.meta?.dataType === 'date' && (
                    <div>
                      <label className="rbs-label">{msg.config.granularityLabel}</label>
                      <select
                        className="rbs-select"
                        value={selectedMeta.item.granularity ?? 'NONE'}
                        onChange={(e) => {
                          const zone = selected.zone as 'rows' | 'pivotColumns' | 'groupBy';
                          const arr = [...definition[zone]];
                          arr[selected.index] = {
                            ...arr[selected.index],
                            granularity:
                              e.target.value === 'NONE'
                                ? undefined
                                : (e.target.value as DateGranularity),
                          };
                          onChangeDefinition({ ...definition, [zone]: arr });
                        }}
                      >
                        {(['NONE', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const).map((g) => (
                          <option key={g} value={g}>
                            {msg.config.granularities[g]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(selectedMeta.type === 'column' || selectedMeta.type === 'value') && (
                    <div>
                      <label className="rbs-label">{msg.config.formatLabel}</label>
                      <select
                        className="rbs-select"
                        value={selectedMeta.item.format ?? ''}
                        onChange={(e) => {
                          const zone = selected.zone as 'columns' | 'values';
                          const arr = [
                            ...(definition[zone] as unknown as Array<Record<string, unknown>>),
                          ];
                          arr[selected.index] = {
                            ...arr[selected.index],
                            format: e.target.value ? (e.target.value as FieldFormat) : undefined,
                          };
                          onChangeDefinition({ ...definition, [zone]: arr });
                        }}
                      >
                        <option value="">{msg.config.defaultLabel}</option>
                        {ALL_FORMATS.map((fmt) => (
                          <option key={fmt} value={fmt}>
                            {msg.config.formats[fmt]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.sections.visualizationSettings}</span>
              </div>
              <div className="rbs-dropzone" style={{ borderStyle: 'solid', background: '#fff' }}>
                <label className="rbs-check-row">
                  <input
                    type="checkbox"
                    checked={definition.visualizationOptions.showLegend !== false}
                    onChange={(e) =>
                      onChangeDefinition({
                        ...definition,
                        visualizationOptions: {
                          ...definition.visualizationOptions,
                          showLegend: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>{msg.config.chartOptions.showLegend}</span>
                </label>
                <label className="rbs-check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(definition.visualizationOptions.showDataLabels)}
                    onChange={(e) =>
                      onChangeDefinition({
                        ...definition,
                        visualizationOptions: {
                          ...definition.visualizationOptions,
                          showDataLabels: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>{msg.config.chartOptions.showDataLabels}</span>
                </label>
                <div>
                  <label className="rbs-label">{msg.config.chartOptions.paletteLabel}</label>
                  <select
                    className="rbs-select"
                    value={definition.visualizationOptions.palette ?? 'default'}
                    onChange={(e) =>
                      onChangeDefinition({
                        ...definition,
                        visualizationOptions: {
                          ...definition.visualizationOptions,
                          palette: e.target.value as 'default' | 'emerald' | 'violet' | 'warm',
                        },
                      })
                    }
                  >
                    <option value="default">{msg.config.chartOptions.colorDefault}</option>
                    <option value="emerald">{msg.config.chartOptions.colorEmerald}</option>
                    <option value="violet">{msg.config.chartOptions.colorViolet}</option>
                    <option value="warm">{msg.config.chartOptions.colorWarm}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.sections.formattingRules}</span>
              </div>
              <div className="rbs-dropzone" style={{ borderStyle: 'solid', background: '#fff' }}>
                {definition.conditionalFormatting.map((rule, idx) => (
                  <div
                    key={rule.id}
                    style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                  >
                    <select
                      className="rbs-select"
                      value={rule.targetFieldId}
                      onChange={(e) => {
                        const next = [...definition.conditionalFormatting];
                        next[idx] = { ...rule, targetFieldId: e.target.value };
                        onChangeDefinition({ ...definition, conditionalFormatting: next });
                      }}
                    >
                      {measureFieldsForRules.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '64px 1fr 1fr 36px',
                        gap: '6px',
                      }}
                    >
                      <select
                        className="rbs-select"
                        value={rule.operator}
                        onChange={(e) => {
                          const next = [...definition.conditionalFormatting];
                          next[idx] = {
                            ...rule,
                            operator: e.target.value as ConditionalFormattingRule['operator'],
                          };
                          onChangeDefinition({ ...definition, conditionalFormatting: next });
                        }}
                      >
                        <option value="gte">{'≥'}</option>
                        <option value="gt">{'>'}</option>
                        <option value="lte">{'≤'}</option>
                        <option value="lt">{'<'}</option>
                        <option value="eq">{'='}</option>
                      </select>
                      <input
                        type="number"
                        className="rbs-input"
                        value={rule.threshold}
                        onChange={(e) => {
                          const next = [...definition.conditionalFormatting];
                          next[idx] = { ...rule, threshold: Number(e.target.value) };
                          onChangeDefinition({ ...definition, conditionalFormatting: next });
                        }}
                      />
                      <select
                        className="rbs-select"
                        value={rule.tone}
                        onChange={(e) => {
                          const next = [...definition.conditionalFormatting];
                          next[idx] = {
                            ...rule,
                            tone: e.target.value as ConditionalFormattingRule['tone'],
                          };
                          onChangeDefinition({ ...definition, conditionalFormatting: next });
                        }}
                      >
                        <option value="success">{msg.config.toneLabels.success}</option>
                        <option value="warning">{msg.config.toneLabels.warning}</option>
                        <option value="danger">{msg.config.toneLabels.danger}</option>
                        <option value="info">{msg.config.toneLabels.info}</option>
                      </select>
                      <button
                        type="button"
                        className="rbs-btn filter-del"
                        style={{ width: '36px' }}
                        aria-label={msg.config.removeField}
                        onClick={() =>
                          onChangeDefinition({
                            ...definition,
                            conditionalFormatting: definition.conditionalFormatting.filter(
                              (_, i) => i !== idx,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" className="rbs-add-inline-btn" onClick={addConditionalRule}>
                  {`+ ${msg.config.addRule}`}
                </button>
              </div>
            </div>

            <div className="rbs-zone-wrapper">
              <div className="rbs-zone-caption">
                <span>{msg.config.sections.advancedOptions}</span>
              </div>
              <div className="rbs-dropzone" style={{ borderStyle: 'solid', background: '#fff' }}>
                <label className="rbs-check-row">
                  <input
                    type="checkbox"
                    checked={definition.showSubtotals}
                    onChange={(e) =>
                      onChangeDefinition({ ...definition, showSubtotals: e.target.checked })
                    }
                  />
                  <span>{msg.config.showSubtotals}</span>
                </label>
                <label className="rbs-check-row">
                  <input
                    type="checkbox"
                    checked={definition.showGrandTotal}
                    onChange={(e) =>
                      onChangeDefinition({ ...definition, showGrandTotal: e.target.checked })
                    }
                  />
                  <span>{msg.config.showGrandTotal}</span>
                </label>
                <div>
                  <label className="rbs-label">{msg.config.rowLimitLabel}</label>
                  <select
                    className="rbs-select"
                    value={definition.pageSize}
                    onChange={(e) =>
                      onChangeDefinition({ ...definition, pageSize: Number(e.target.value) })
                    }
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rbs-panel-footer rbs-desktop-panel-footer">
        <button
          type="button"
          className="rbs-btn primary full-cta"
          disabled={running}
          onClick={onRunReport}
        >
          {running ? msg.toolbar.running : msg.toolbar.runReport}
        </button>
      </div>
    </aside>
  );
}
