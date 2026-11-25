import { useState } from 'react';
import { SearchableSelect } from '../../../components/common/SearchableSelect';
import { SlideDialog } from '../../../components/common/SlideDialog';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import type { FieldMeta, FilterGroup, FilterOperator, FilterRule } from './reportBuilderTypes';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  availableFields: FieldMeta[];
  rootGroup: FilterGroup;
  onApply: (next: FilterGroup) => void;
  onClose: () => void;
}

const RELATIVE_DATE_KEYS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
  'LAST_YEAR',
] as const;

export function AdvancedFilterBuilder({
  locale,
  msg,
  availableFields,
  rootGroup,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<FilterGroup>(structuredClone(rootGroup));
  const fieldOptions = availableFields.map((f) => ({
    value: f.id,
    label: locale === 'en' ? f.labelEn : f.labelVi,
  }));
  const fieldMap = new Map(availableFields.map((f) => [f.id, f]));

  const renderGroup = (
    group: FilterGroup,
    onChange: (updated: FilterGroup) => void,
    onRemove?: () => void,
    depth = 0,
  ) => {
    const addRule = () => {
      const first = availableFields[0];
      if (!first) return;
      const newRule: FilterRule = {
        id: `r_${Date.now().toString(36)}_${group.rules.length}`,
        fieldId: first.id,
        operator: first.filterOperators[0] ?? 'eq',
        value: '',
      };
      onChange({ ...group, rules: [...group.rules, newRule] });
    };

    const addSubGroup = () => {
      const newSub: FilterGroup = {
        id: `g_${Date.now().toString(36)}`,
        combinator: group.combinator === 'AND' ? 'OR' : 'AND',
        rules: [],
        groups: [],
      };
      onChange({ ...group, groups: [...group.groups, newSub] });
    };

    return (
      <div className="rbs-filter-group" style={{ marginLeft: depth > 0 ? '12px' : 0 }}>
        <div className="rbs-filter-header">
          <div style={{ minWidth: '220px' }}>
            <select
              className="rbs-select"
              value={group.combinator}
              onChange={(e) => onChange({ ...group, combinator: e.target.value as 'AND' | 'OR' })}
            >
              <option value="AND">{msg.filterBuilder.combinatorAnd}</option>
              <option value="OR">{msg.filterBuilder.combinatorOr}</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="rbs-btn" onClick={addRule}>
              {msg.filterBuilder.addRule}
            </button>
            {depth < 3 && (
              <button type="button" className="rbs-btn" onClick={addSubGroup}>
                {msg.filterBuilder.addGroup}
              </button>
            )}
            {onRemove && (
              <button type="button" className="rbs-btn" onClick={onRemove}>
                {msg.filterBuilder.removeGroup}
              </button>
            )}
          </div>
        </div>

        {group.rules.length === 0 && group.groups.length === 0 && (
          <div style={{ fontSize: '13px', color: '#64748b', padding: '4px 0' }}>
            {msg.filterBuilder.emptyFilterHint}
          </div>
        )}

        {group.rules.map((rule, idx) => {
          const meta = fieldMap.get(rule.fieldId) ?? availableFields[0];
          const operators = meta?.filterOperators ?? ['eq'];
          const op = rule.operator;

          const updateRule = (patch: Partial<FilterRule>) => {
            const next = [...group.rules];
            next[idx] = { ...rule, ...patch };
            onChange({ ...group, rules: next });
          };

          return (
            <div key={rule.id} className="rbs-filter-rule">
              <SearchableSelect
                value={rule.fieldId}
                options={fieldOptions}
                ariaLabel={msg.filterBuilder.selectField}
                searchPlaceholder={msg.explorer.searchFields}
                onChange={(newFieldId) => {
                  const newMeta = fieldMap.get(newFieldId);
                  updateRule({
                    fieldId: newFieldId,
                    operator: newMeta?.filterOperators[0] ?? 'eq',
                    value: '',
                    valueTo: undefined,
                  });
                }}
              />

              <select
                className="rbs-select"
                aria-label={msg.filterBuilder.selectOperator}
                value={op}
                onChange={(e) =>
                  updateRule({
                    operator: e.target.value as FilterOperator,
                    value: e.target.value === 'relative_date' ? 'THIS_MONTH' : rule.value,
                  })
                }
              >
                {operators.map((o) => (
                  <option key={o} value={o}>
                    {msg.filterBuilder.operators[o] ?? o}
                  </option>
                ))}
              </select>

              <div>
                {op === 'is_null' || op === 'is_not_null' ? (
                  <input
                    className="rbs-input"
                    disabled
                    value={msg.filterBuilder.operators[op]}
                    aria-label={msg.filterBuilder.valuePlaceholder}
                  />
                ) : op === 'relative_date' ? (
                  <select
                    className="rbs-select"
                    value={String(rule.value ?? 'THIS_MONTH')}
                    onChange={(e) => updateRule({ value: e.target.value })}
                  >
                    {RELATIVE_DATE_KEYS.map((rk) => (
                      <option key={rk} value={rk}>
                        {msg.filterBuilder.relativeDates[rk]}
                      </option>
                    ))}
                  </select>
                ) : op === 'between' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <input
                      type={
                        meta?.dataType === 'date'
                          ? 'date'
                          : meta?.dataType === 'number' || meta?.dataType === 'currency'
                            ? 'number'
                            : 'text'
                      }
                      className="rbs-input"
                      value={String(rule.value ?? '')}
                      placeholder={msg.filterBuilder.valuePlaceholder}
                      onChange={(e) => updateRule({ value: e.target.value })}
                    />
                    <input
                      type={
                        meta?.dataType === 'date'
                          ? 'date'
                          : meta?.dataType === 'number' || meta?.dataType === 'currency'
                            ? 'number'
                            : 'text'
                      }
                      className="rbs-input"
                      value={String(rule.valueTo ?? '')}
                      placeholder={msg.filterBuilder.valueToPlaceholder}
                      onChange={(e) => updateRule({ valueTo: e.target.value })}
                    />
                  </div>
                ) : meta?.dataType === 'boolean' ? (
                  <select
                    className="rbs-select"
                    value={String(rule.value ?? 'true')}
                    onChange={(e) => updateRule({ value: e.target.value === 'true' })}
                  >
                    <option value="true">{msg.common.yes}</option>
                    <option value="false">{msg.common.no}</option>
                  </select>
                ) : meta?.enumValues &&
                  meta.enumValues.length > 0 &&
                  (op === 'eq' || op === 'neq') ? (
                  <select
                    className="rbs-select"
                    value={String(rule.value ?? '')}
                    onChange={(e) => updateRule({ value: e.target.value })}
                  >
                    <option value="">{msg.filterBuilder.selectField}</option>
                    {meta.enumValues.map((ev) => (
                      <option key={ev.value} value={ev.value}>
                        {locale === 'en' ? ev.labelEn : ev.labelVi}
                      </option>
                    ))}
                  </select>
                ) : meta?.enumValues &&
                  meta.enumValues.length > 0 &&
                  (op === 'in' || op === 'not_in') ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {meta.enumValues.map((ev) => {
                      const arr = Array.isArray(rule.value) ? (rule.value as string[]) : [];
                      const checked = arr.includes(ev.value);
                      return (
                        <label key={ev.value} className="rbs-check-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nextArr = e.target.checked
                                ? [...arr, ev.value]
                                : arr.filter((x) => x !== ev.value);
                              updateRule({ value: nextArr });
                            }}
                          />
                          <span>{locale === 'en' ? ev.labelEn : ev.labelVi}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    type={
                      meta?.dataType === 'date'
                        ? 'date'
                        : meta?.dataType === 'number' || meta?.dataType === 'currency'
                          ? 'number'
                          : 'text'
                    }
                    className="rbs-input"
                    value={
                      Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? '')
                    }
                    placeholder={msg.filterBuilder.valuePlaceholder}
                    onChange={(e) =>
                      updateRule({
                        value:
                          op === 'in' || op === 'not_in'
                            ? e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </div>

              <button
                type="button"
                className="rbs-btn filter-del"
                aria-label={msg.filterBuilder.removeRule}
                onClick={() =>
                  onChange({
                    ...group,
                    rules: group.rules.filter((_, i) => i !== idx),
                  })
                }
              >
                ×
              </button>
            </div>
          );
        })}

        {group.groups.map((sub, gIdx) =>
          renderGroup(
            sub,
            (updatedSub) => {
              const copy = [...group.groups];
              copy[gIdx] = updatedSub;
              onChange({ ...group, groups: copy });
            },
            () =>
              onChange({
                ...group,
                groups: group.groups.filter((_, i) => i !== gIdx),
              }),
            depth + 1,
          ),
        )}
      </div>
    );
  };

  return (
    <SlideDialog
      label={msg.filterBuilder.title}
      onClose={onClose}
      action={
        <button type="button" className="primary" onClick={() => onApply(draft)}>
          {msg.common.apply}
        </button>
      }
    >
      <div className="rbs-shell" style={{ minHeight: 0, gap: '12px' }}>
        <h3 style={{ margin: 0 }}>{msg.filterBuilder.title}</h3>
        {renderGroup(draft, setDraft)}
      </div>
    </SlideDialog>
  );
}
