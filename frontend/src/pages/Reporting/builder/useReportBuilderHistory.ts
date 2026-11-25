import { useCallback, useState } from 'react';
import type { Locale } from '../../../i18n';
import type {
  DropZoneName,
  FieldFormat,
  FieldMeta,
  ReportDefinition,
  ValueConfig,
} from './reportBuilderTypes';

interface HistoryState {
  past: ReportDefinition[];
  present: ReportDefinition;
  future: ReportDefinition[];
}

const MAX_HISTORY = 40;

export function useReportBuilderHistory(initial: ReportDefinition) {
  const [state, setState] = useState<HistoryState>({
    past: [],
    present: initial,
    future: [],
  });

  const setDefinition = useCallback(
    (updater: ReportDefinition | ((prev: ReportDefinition) => ReportDefinition), record = true) => {
      setState((prev) => {
        const next = typeof updater === 'function' ? updater(prev.present) : updater;
        if (JSON.stringify(next) === JSON.stringify(prev.present)) return prev;
        if (!record) {
          return { ...prev, present: next };
        }
        return {
          past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.present],
          present: next,
          future: [],
        };
      });
    },
    [],
  );

  const resetHistory = useCallback((next: ReportDefinition) => {
    setState({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future].slice(0, MAX_HISTORY),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      return {
        past: [...prev.past, prev.present].slice(-MAX_HISTORY),
        present: next,
        future: prev.future.slice(1),
      };
    });
  }, []);

  return {
    definition: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    setDefinition,
    resetHistory,
    undo,
    redo,
  };
}

export function canDropFieldInZone(field: FieldMeta, zone: DropZoneName): boolean {
  switch (zone) {
    case 'columns':
      return true;
    case 'rows':
    case 'pivotColumns':
    case 'groupBy':
      return field.groupable;
    case 'values':
      return field.allowedAggregations.length > 0;
    case 'sortBy':
      return field.sortable;
  }
}

export function addFieldToZone(
  def: ReportDefinition,
  field: FieldMeta,
  zone: DropZoneName,
): ReportDefinition | null {
  if (!canDropFieldInZone(field, zone)) return null;

  switch (zone) {
    case 'columns': {
      if (def.columns.some((c) => c.fieldId === field.id)) return def;
      return { ...def, columns: [...def.columns, { fieldId: field.id }] };
    }
    case 'rows': {
      if (def.rows.some((r) => r.fieldId === field.id)) return def;
      return {
        ...def,
        rows: [
          ...def.rows,
          { fieldId: field.id, granularity: field.dataType === 'date' ? 'MONTH' : undefined },
        ],
      };
    }
    case 'pivotColumns': {
      if (def.pivotColumns.some((p) => p.fieldId === field.id)) return def;
      return {
        ...def,
        pivotColumns: [
          ...def.pivotColumns,
          { fieldId: field.id, granularity: field.dataType === 'date' ? 'MONTH' : undefined },
        ],
        visualizationType: def.visualizationType === 'TABLE' ? 'PIVOT' : def.visualizationType,
      };
    }
    case 'groupBy': {
      if (def.groupBy.some((g) => g.fieldId === field.id)) return def;
      return {
        ...def,
        groupBy: [
          ...def.groupBy,
          { fieldId: field.id, granularity: field.dataType === 'date' ? 'MONTH' : undefined },
        ],
      };
    }
    case 'values': {
      const defaultAgg = field.allowedAggregations.includes('SUM')
        ? 'SUM'
        : (field.allowedAggregations[0] ?? 'COUNT');
      const newMeasure: ValueConfig = {
        id: `m_${field.id}_${Date.now().toString(36)}_${def.values.length + 1}`,
        fieldId: field.id,
        aggregation: defaultAgg,
      };
      return { ...def, values: [...def.values, newMeasure] };
    }
    case 'sortBy': {
      if (def.sortBy.some((s) => s.fieldId === field.id)) return def;
      return { ...def, sortBy: [...def.sortBy, { fieldId: field.id, direction: 'ASC' }] };
    }
  }
}

export function formatCellValue(
  value: unknown,
  format: FieldFormat | undefined,
  locale: Locale,
): string {
  if (value === null || value === undefined || value === '') return '—';

  if (format === 'boolean') {
    const truthy = value === true || value === 'true' || value === 'Có' || value === 'Yes';
    return truthy ? (locale === 'en' ? 'Yes' : 'Có') : locale === 'en' ? 'No' : 'Không';
  }

  if (format === 'currency') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(n);
  }

  if (format === 'percent') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return `${new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
      maximumFractionDigits: 2,
    }).format(n)}%`;
  }

  if (format === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
      maximumFractionDigits: 2,
    }).format(n);
  }

  if (format === 'date' || format === 'datetime') {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(format === 'datetime' ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(d);
    }
  }

  return String(value);
}
