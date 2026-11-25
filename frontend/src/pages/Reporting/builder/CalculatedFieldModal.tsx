import { useState } from 'react';
import { SlideDialog } from '../../../components/common/SlideDialog';
import type { Locale } from '../../../i18n';
import type { ReportBuilderMessages } from '../reportBuilderMessages';
import type { CalculatedFieldConfig, FieldFormat, FieldMeta } from './reportBuilderTypes';

interface Props {
  locale: Locale;
  msg: ReportBuilderMessages;
  availableFields: FieldMeta[];
  measureIds: string[];
  initial?: CalculatedFieldConfig;
  onValidate: (formula: string) => Promise<{
    valid: boolean;
    resultType?: string;
    errorMessage?: string;
  }>;
  onSave: (field: CalculatedFieldConfig) => void;
  onClose: () => void;
}

const FORMULA_FUNCTIONS = [
  'IF(cond, a, b)',
  'SAFE_DIV(num, den, 0)',
  'ROUND(x, 2)',
  'COALESCE(a, b)',
  'ABS(x)',
  'MIN(a, b)',
  'MAX(a, b)',
  'CONCAT(a, b)',
  'DAYS_BETWEEN(d1, d2)',
  'YEAR(date)',
  'MONTH(date)',
];

export function CalculatedFieldModal({
  locale,
  msg,
  availableFields,
  initial,
  onValidate,
  onSave,
  onClose,
}: Props) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [formula, setFormula] = useState(initial?.formula ?? '');
  const [format, setFormat] = useState<FieldFormat>(initial?.format ?? 'number');
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    resultType?: string;
    errorMessage?: string;
  } | null>(null);

  const insertToken = (snippet: string) => {
    setFormula((prev) => (prev ? `${prev} ${snippet}` : snippet));
    setValidation(null);
  };

  const handleCheck = async () => {
    setValidating(true);
    try {
      const res = await onValidate(formula);
      setValidation(res);
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!label.trim() || !formula.trim()) return;
    setValidating(true);
    try {
      const res = await onValidate(formula);
      setValidation(res);
      if (!res.valid) return;
      onSave({
        id: initial?.id ?? `calc_${Date.now().toString(36)}`,
        label: label.trim(),
        formula: formula.trim(),
        format,
      });
    } finally {
      setValidating(false);
    }
  };

  return (
    <SlideDialog
      label={msg.formulaModal.title}
      onClose={onClose}
      action={
        <button
          type="button"
          className="primary"
          disabled={validating || !label.trim() || !formula.trim()}
          onClick={handleSave}
        >
          {msg.formulaModal.saveBtn}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <h3>{msg.formulaModal.title}</h3>
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted, #64748b)' }}>
          {msg.formulaModal.securityNote}
        </p>

        <div>
          <label className="rbs-label" htmlFor="rbs-calc-name">
            {msg.formulaModal.nameLabel}
          </label>
          <input
            id="rbs-calc-name"
            className="rbs-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={msg.formulaModal.namePlaceholder}
          />
        </div>

        <div>
          <label className="rbs-label" htmlFor="rbs-calc-format">
            {msg.formulaModal.formatLabel}
          </label>
          <select
            id="rbs-calc-format"
            className="rbs-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as FieldFormat)}
          >
            {(['number', 'currency', 'percent', 'text', 'boolean'] as const).map((fmt) => (
              <option key={fmt} value={fmt}>
                {msg.config.formats[fmt]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rbs-label" htmlFor="rbs-calc-expr">
            {msg.formulaModal.expressionLabel}
          </label>
          <textarea
            id="rbs-calc-expr"
            rows={4}
            className="rbs-input"
            style={{ height: 'auto', padding: '0.6rem', fontFamily: 'ui-monospace, monospace' }}
            value={formula}
            onChange={(e) => {
              setFormula(e.target.value);
              setValidation(null);
            }}
            placeholder={msg.formulaModal.expressionPlaceholder}
          />
        </div>

        <div>
          <div className="rbs-label">{msg.formulaModal.insertField}</div>
          <div className="rbs-token-chips" style={{ maxHeight: '110px', overflowY: 'auto' }}>
            {availableFields.slice(0, 24).map((f) => (
              <button
                key={f.id}
                type="button"
                className="rbs-token-chip"
                onClick={() => insertToken(`[${f.id}]`)}
                title={locale === 'en' ? f.labelEn : f.labelVi}
              >
                {`[${f.id}]`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="rbs-label">{msg.formulaModal.insertFunction}</div>
          <div className="rbs-token-chips">
            {FORMULA_FUNCTIONS.map((fn) => (
              <button
                key={fn}
                type="button"
                className="rbs-token-chip"
                onClick={() => insertToken(fn)}
              >
                {fn}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="rbs-btn"
            disabled={validating || !formula.trim()}
            onClick={handleCheck}
          >
            {msg.formulaModal.validateBtn}
          </button>
          {validation?.valid && (
            <span className="rbs-pill success">
              {`${msg.formulaModal.validBadge} (${msg.formulaModal.inferredType}: ${validation.resultType ?? 'unknown'})`}
            </span>
          )}
          {validation && !validation.valid && (
            <span className="rbs-pill danger">{validation.errorMessage}</span>
          )}
        </div>
      </div>
    </SlideDialog>
  );
}
