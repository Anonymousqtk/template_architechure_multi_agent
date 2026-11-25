export type EntityId =
  | 'employees'
  | 'departments'
  | 'positions'
  | 'contracts'
  | 'attendance'
  | 'leave_requests'
  | 'payroll_slips'
  | 'payroll_journal_lines';

export type FieldDataType = 'string' | 'number' | 'currency' | 'date' | 'boolean' | 'enum';
export type FieldFormat =
  | 'text'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'boolean';
export type DateGranularity = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export type AggregationFn =
  | 'SUM'
  | 'COUNT'
  | 'COUNT_DISTINCT'
  | 'AVG'
  | 'MIN'
  | 'MAX'
  | 'MEDIAN'
  | 'PERCENTAGE'
  | 'RUNNING_TOTAL'
  | 'RANK'
  | 'GROWTH_RATE';

export type VisualizationType =
  | 'TABLE'
  | 'PIVOT'
  | 'BAR'
  | 'COLUMN'
  | 'LINE'
  | 'AREA'
  | 'PIE'
  | 'DONUT'
  | 'STACKED_BAR'
  | 'COMBO'
  | 'HEATMAP'
  | 'KPI';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'relative_date'
  | 'is_null'
  | 'is_not_null';

export interface EntityMeta {
  id: EntityId;
  category: string;
  labelVi: string;
  labelEn: string;
  descriptionVi: string;
  descriptionEn: string;
  minRole: 'EMPLOYEE' | 'MANAGER' | 'HR' | 'ADMIN';
  relatedEntities: Array<{
    entity: EntityId;
    relationshipType: 'MANY_TO_ONE';
    joinDescriptionVi: string;
    joinDescriptionEn: string;
  }>;
}

export interface FieldMeta {
  id: string;
  entity: EntityId;
  categoryVi: string;
  categoryEn: string;
  labelVi: string;
  labelEn: string;
  descriptionVi: string;
  descriptionEn: string;
  dataType: FieldDataType;
  defaultFormat: FieldFormat;
  allowedAggregations: AggregationFn[];
  filterOperators: FilterOperator[];
  enumValues?: Array<{ value: string; labelVi: string; labelEn: string }>;
  groupable: boolean;
  sortable: boolean;
  minRole: 'EMPLOYEE' | 'MANAGER' | 'HR' | 'ADMIN';
}

export interface ColumnConfig {
  fieldId: string;
  label?: string;
  format?: FieldFormat;
  width?: number;
}

export interface DimensionConfig {
  fieldId: string;
  label?: string;
  granularity?: DateGranularity;
}

export interface ValueConfig {
  id: string;
  fieldId: string;
  aggregation: AggregationFn;
  label?: string;
  format?: FieldFormat;
}

export interface FilterRule {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value?: unknown;
  valueTo?: unknown;
}

export interface FilterGroup {
  id: string;
  combinator: 'AND' | 'OR';
  rules: FilterRule[];
  groups: FilterGroup[];
}

export interface SortConfig {
  fieldId: string;
  direction: 'ASC' | 'DESC';
}

export interface CalculatedFieldConfig {
  id: string;
  label: string;
  formula: string;
  format?: FieldFormat;
}

export interface ConditionalFormattingRule {
  id: string;
  targetFieldId: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  threshold: number;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

export interface VisualizationOptions {
  showLegend?: boolean;
  showDataLabels?: boolean;
  palette?: 'default' | 'emerald' | 'violet' | 'warm';
  smoothLine?: boolean;
  kpiTitle?: string;
  kpiPrefix?: string;
  kpiSuffix?: string;
}

export interface ReportDefinition {
  primaryEntity: EntityId;
  relatedEntities: EntityId[];
  columns: ColumnConfig[];
  rows: DimensionConfig[];
  pivotColumns: DimensionConfig[];
  values: ValueConfig[];
  groupBy: DimensionConfig[];
  filters: FilterGroup;
  sortBy: SortConfig[];
  calculatedFields: CalculatedFieldConfig[];
  conditionalFormatting: ConditionalFormattingRule[];
  visualizationType: VisualizationType;
  visualizationOptions: VisualizationOptions;
  showSubtotals: boolean;
  showGrandTotal: boolean;
  pageSize: number;
}

export interface ResultColumn {
  key: string;
  fieldId: string;
  label: string;
  dataType: string;
  format: FieldFormat;
  isMeasure: boolean;
  aggregation?: AggregationFn;
  width?: number;
}

export interface ReportExecutionResult {
  mode: 'FLAT' | 'TABULAR' | 'GROUPED' | 'PIVOT';
  columns: ResultColumn[];
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number> | null;
  subtotals?: Array<Record<string, unknown>>;
  pivot?: {
    rowDimensions?: Array<{ key: string; label: string }>;
    pivotKeys: string[];
    measures?: Array<{ id: string; label: string; format: FieldFormat }>;
    rows?: Array<{
      dimensions: Record<string, string>;
      cells: Record<string, Record<string, number | null>>;
      rowTotals: Record<string, number | null>;
    }>;
    columnTotals?: Record<string, Record<string, number | null>>;
    rowKeys?: Array<{ key: string; label: string }>;
    measureKeys?: Array<{ id: string; label: string; format: FieldFormat }>;
    cells?: Record<string, Record<string, Record<string, number>>>;
    rowTotals?: Record<string, Record<string, number>>;
    colTotals?: Record<string, Record<string, number>>;
    grandTotals: Record<string, number | null>;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  meta: {
    executionMs: number;
    cached: boolean;
    rowLimitReached: boolean;
  };
}

export interface PrebuiltTemplate {
  code: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  category: string;
  visualizationType: VisualizationType;
  definition: Partial<ReportDefinition> & { primaryEntity: EntityId };
}

export interface CustomReportRecord {
  id: string;
  name: string;
  description: string | null;
  primaryEntity: EntityId;
  relatedEntities: EntityId[];
  definition: ReportDefinition;
  visualizationType: VisualizationType;
  visibility: 'PRIVATE' | 'SHARED' | 'ORG_TEMPLATE';
  sharedRoles: Array<'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'>;
  sharedUserIds: string[];
  isTemplate: boolean;
  templateCode: string | null;
  version: number;
  createdBy: string;
  createdByName?: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  lastViewedAt: string | null;
}

export interface ExportJobState {
  id: string;
  format: 'CSV' | 'EXCEL' | 'PDF';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  rowCount: number;
  fileName: string | null;
  errorCode: string | null;
}

export type DropZoneName = 'columns' | 'rows' | 'pivotColumns' | 'values' | 'groupBy' | 'sortBy';

export function createEmptyReportDefinition(
  primaryEntity: EntityId = 'employees',
): ReportDefinition {
  return {
    primaryEntity,
    relatedEntities: [],
    columns: [],
    rows: [],
    pivotColumns: [],
    values: [],
    groupBy: [],
    filters: { id: 'root', combinator: 'AND', rules: [], groups: [] },
    sortBy: [],
    calculatedFields: [],
    conditionalFormatting: [],
    visualizationType: 'TABLE',
    visualizationOptions: {
      showLegend: true,
      showDataLabels: false,
      palette: 'default',
      smoothLine: false,
    },
    showSubtotals: true,
    showGrandTotal: true,
    pageSize: 25,
  };
}

export function normalizeDefinition(
  partial: Partial<ReportDefinition> & {
    primaryEntity: EntityId;
    options?: { showTotals?: boolean; showSubtotals?: boolean; pageSize?: number };
    filters?: Partial<FilterGroup> & { logic?: 'AND' | 'OR' };
  },
): ReportDefinition {
  const base = createEmptyReportDefinition(partial.primaryEntity);
  const rawFilters = partial.filters;
  const normalizedFilters: FilterGroup = rawFilters
    ? {
        id: rawFilters.id ?? 'root',
        combinator: rawFilters.combinator ?? rawFilters.logic ?? 'AND',
        rules: rawFilters.rules ?? [],
        groups: rawFilters.groups ?? [],
      }
    : base.filters;
  return {
    ...base,
    ...partial,
    relatedEntities: partial.relatedEntities ?? [],
    columns: partial.columns ?? [],
    rows: partial.rows ?? [],
    pivotColumns: partial.pivotColumns ?? [],
    values: partial.values ?? [],
    groupBy: partial.groupBy ?? [],
    filters: normalizedFilters,
    sortBy: partial.sortBy ?? [],
    calculatedFields: partial.calculatedFields ?? [],
    conditionalFormatting: partial.conditionalFormatting ?? [],
    visualizationType: partial.visualizationType ?? 'TABLE',
    visualizationOptions: {
      ...base.visualizationOptions,
      ...(partial.visualizationOptions ?? {}),
    },
    showSubtotals: partial.showSubtotals ?? partial.options?.showSubtotals ?? base.showSubtotals,
    showGrandTotal: partial.showGrandTotal ?? partial.options?.showTotals ?? base.showGrandTotal,
    pageSize: partial.pageSize ?? partial.options?.pageSize ?? base.pageSize,
  };
}
