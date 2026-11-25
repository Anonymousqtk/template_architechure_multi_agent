import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { managementScope } from './management-scope.js';
import { escapeLike } from './organization-structure.js';
import {
  evaluateFormulaAst,
  FormulaError,
  validateFormulaExpression,
  type FormulaNode,
  type FormulaValueType,
} from './report-builder-formula.js';
import {
  hasMinRole,
  REPORT_ENTITIES,
  REPORT_FIELD_MAP,
  type AggregationFn,
  type DateGranularity,
  type EntityId,
  type FilterOperator,
  type ReportFieldMeta,
} from './report-builder-metadata.js';
import { fail as rawFail, type Identity } from './types.js';

function fail(status: number, code: string): never {
  rawFail(status, code);
  throw new Error(code);
}

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

const ENTITY_IDS = [
  'employees',
  'departments',
  'positions',
  'contracts',
  'attendance',
  'leave_requests',
  'payroll_slips',
  'payroll_journal_lines',
] as const;

const AGGREGATIONS = [
  'SUM',
  'COUNT',
  'COUNT_DISTINCT',
  'AVG',
  'MIN',
  'MAX',
  'MEDIAN',
  'PERCENTAGE',
  'RUNNING_TOTAL',
  'RANK',
  'GROWTH_RATE',
] as const;

const FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
  'relative_date',
] as const;

const DATE_GRANULARITIES = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
const SAFE_SQL_IDENTIFIER = /^[a-zA-Z0-9_.-]+$/;

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export const FilterRuleSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  fieldId: z.string().min(1).max(100),
  operator: z.enum(FILTER_OPERATORS),
  value: z.unknown().optional(),
  valueTo: z.unknown().optional(),
});

export interface FilterGroupInput {
  id?: string;
  logic: 'AND' | 'OR';
  rules: Array<z.infer<typeof FilterRuleSchema>>;
  groups: FilterGroupInput[];
}

export const FilterGroupSchema: z.ZodType<FilterGroupInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64).optional(),
    logic: z.enum(['AND', 'OR']).default('AND'),
    rules: z.array(FilterRuleSchema).max(30).default([]),
    groups: z.array(FilterGroupSchema).max(10).default([]),
  }),
);

export const CalculatedFieldSchema = z.object({
  id: z.string().min(1).max(64).regex(SAFE_SQL_IDENTIFIER),
  label: z.string().trim().min(1).max(120),
  formula: z.string().trim().min(1).max(1000),
  format: z
    .enum(['text', 'number', 'currency', 'percent', 'date', 'datetime', 'boolean'])
    .optional(),
});

export const ConditionalFormatRuleSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  targetKey: z.string().min(1).max(100),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains']),
  value: z.union([z.string(), z.number()]),
  tone: z.enum(['success', 'warning', 'danger', 'info']),
});

export const ReportDefinitionSchema = z.object({
  primaryEntity: z.enum(ENTITY_IDS),
  relatedEntities: z.array(z.enum(ENTITY_IDS)).max(5).default([]),
  columns: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(100),
        label: z.string().trim().min(1).max(120).optional(),
        format: z
          .enum(['text', 'number', 'currency', 'percent', 'date', 'datetime', 'boolean'])
          .optional(),
        width: z.number().int().min(60).max(600).optional(),
      }),
    )
    .max(25)
    .default([]),
  rows: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(100),
        label: z.string().trim().min(1).max(120).optional(),
        granularity: z.enum(DATE_GRANULARITIES).optional(),
      }),
    )
    .max(5)
    .default([]),
  pivotColumns: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(100),
        label: z.string().trim().min(1).max(120).optional(),
        granularity: z.enum(DATE_GRANULARITIES).optional(),
      }),
    )
    .max(2)
    .default([]),
  values: z
    .array(
      z.object({
        id: z.string().min(1).max(64).regex(SAFE_SQL_IDENTIFIER),
        fieldId: z.string().min(1).max(100),
        aggregation: z.enum(AGGREGATIONS),
        label: z.string().trim().min(1).max(120).optional(),
        format: z
          .enum(['text', 'number', 'currency', 'percent', 'date', 'datetime', 'boolean'])
          .optional(),
      }),
    )
    .max(10)
    .default([]),
  groupBy: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(100),
        label: z.string().trim().min(1).max(120).optional(),
        granularity: z.enum(DATE_GRANULARITIES).optional(),
      }),
    )
    .max(5)
    .default([]),
  filters: FilterGroupSchema.default({ logic: 'AND', rules: [], groups: [] }),
  sortBy: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(100),
        direction: z.enum(['ASC', 'DESC']).default('ASC'),
      }),
    )
    .max(5)
    .default([]),
  calculatedFields: z.array(CalculatedFieldSchema).max(10).default([]),
  conditionalFormatting: z.array(ConditionalFormatRuleSchema).max(20).default([]),
  chartConfig: z
    .object({
      dimensionKey: z.string().optional(),
      metricKeys: z.array(z.string()).max(6).optional(),
      seriesKey: z.string().optional(),
      showLegend: z.boolean().optional(),
      showLabels: z.boolean().optional(),
      palette: z.enum(['indigo', 'emerald', 'sunset', 'ocean']).optional(),
    })
    .optional(),
  options: z
    .object({
      showTotals: z.boolean().default(true),
      showSubtotals: z.boolean().default(false),
      pageSize: z.number().int().min(1).max(500).default(50),
    })
    .default({ showTotals: true, showSubtotals: false, pageSize: 50 }),
});

export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;

function normalizeFilterGroupShape(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const logic = obj.logic === 'OR' || obj.combinator === 'OR' ? 'OR' : 'AND';
  const rules = Array.isArray(obj.rules) ? obj.rules : [];
  const groups = Array.isArray(obj.groups) ? obj.groups.map(normalizeFilterGroupShape) : [];
  return { ...obj, logic, rules, groups };
}

export function normalizeIncomingDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const rawConds = Array.isArray(obj.conditionalFormatting) ? obj.conditionalFormatting : [];
  const conditionalFormatting = rawConds.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const rule = c as Record<string, unknown>;
    return {
      ...rule,
      targetKey: rule.targetKey ?? rule.targetFieldId,
      value: rule.value ?? rule.threshold ?? 0,
    };
  });
  const rawOptions =
    obj.options && typeof obj.options === 'object' ? (obj.options as Record<string, unknown>) : {};
  return {
    ...obj,
    filters: obj.filters ? normalizeFilterGroupShape(obj.filters) : undefined,
    conditionalFormatting,
    options: {
      showTotals: rawOptions.showTotals ?? obj.showGrandTotal ?? true,
      showSubtotals: rawOptions.showSubtotals ?? obj.showSubtotals ?? false,
      pageSize: rawOptions.pageSize ?? obj.pageSize ?? 50,
    },
  };
}

export function parseReportDefinition(raw: unknown): ReportDefinition {
  return ReportDefinitionSchema.parse(normalizeIncomingDefinition(raw));
}

export interface ResultColumn {
  key: string;
  fieldId: string;
  label: string;
  dataType: FormulaValueType | 'currency';
  format: string;
  isMeasure: boolean;
  aggregation?: AggregationFn;
  width?: number;
}

export interface PivotResult {
  rowDimensions: Array<{ key: string; label: string }>;
  pivotColumnLabel: string;
  pivotKeys: string[];
  measures: Array<{ id: string; label: string; format: string }>;
  rows: Array<{
    dimensions: Record<string, string>;
    cells: Record<string, Record<string, number | null>>;
    rowTotals: Record<string, number | null>;
  }>;
  columnTotals: Record<string, Record<string, number | null>>;
  grandTotals: Record<string, number | null>;
}

export interface ReportExecutionResult {
  mode: 'FLAT' | 'GROUPED' | 'PIVOT';
  columns: ResultColumn[];
  rows: Array<Record<string, unknown>>;
  totals: Record<string, unknown> | null;
  subtotals: Array<Record<string, unknown>>;
  pivot?: PivotResult;
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  meta: {
    executionMs: number;
    cached: boolean;
    primaryEntity: EntityId;
    relatedEntities: EntityId[];
  };
}

interface CompiledFormula {
  id: string;
  label: string;
  format: string;
  resultType: FormulaValueType;
  ast: FormulaNode;
  referencedFields: string[];
}

// Short-lived permission-aware TTL cache (30s)
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 200;
const queryCache = new Map<string, { expiresAt: number; result: ReportExecutionResult }>();

export function clearReportBuilderCache(): void {
  queryCache.clear();
}

function resolveAvailableFieldsForDefinition(
  primaryEntity: EntityId,
  relatedEntities: EntityId[],
  role: string,
): Map<string, ReportFieldMeta> {
  const entityMeta = REPORT_ENTITIES[primaryEntity];
  if (!entityMeta || !hasMinRole(role, entityMeta.minRole)) {
    fail(403, 'FORBIDDEN');
  }

  const allowedTargetSet = new Set(
    entityMeta.allowedRelations
      .filter((rel) => hasMinRole(role, REPORT_ENTITIES[rel.targetEntity].minRole))
      .map((rel) => rel.targetEntity),
  );

  for (const rel of relatedEntities) {
    if (rel === primaryEntity) continue;
    if (!allowedTargetSet.has(rel)) {
      fail(400, 'INVALID_REPORT_RELATIONSHIP');
    }
  }

  const activeEntities = new Set<EntityId>([primaryEntity, ...relatedEntities]);
  const fields = new Map<string, ReportFieldMeta>();

  for (const field of REPORT_FIELD_MAP.values()) {
    if (activeEntities.has(field.entity) && hasMinRole(role, field.minRole)) {
      fields.set(field.id, field);
    }
  }
  return fields;
}

function buildFromAndJoins(
  primaryEntity: EntityId,
  relatedEntities: EntityId[],
  identity: Identity,
): { fromSql: string; hasEmployeeAlias: boolean } {
  const entityMeta = REPORT_ENTITIES[primaryEntity];
  const activeSet = new Set<EntityId>(relatedEntities);
  const joins: string[] = [];
  let hasEmployeeAlias = primaryEntity === 'employees';

  // Ensure employees table is joined before departments/positions or when scope requires it
  const needsEmployeeForRelated =
    primaryEntity !== 'employees' &&
    primaryEntity !== 'departments' &&
    primaryEntity !== 'positions' &&
    primaryEntity !== 'payroll_journal_lines' &&
    (activeSet.has('departments') ||
      activeSet.has('positions') ||
      Boolean(entityMeta.employeeScopeAlias && ['MANAGER', 'EMPLOYEE'].includes(identity.role)));

  if (needsEmployeeForRelated) {
    activeSet.add('employees');
  }

  // Deterministic join ordering following allowedRelations order
  for (const rel of entityMeta.allowedRelations) {
    if (activeSet.has(rel.targetEntity)) {
      joins.push(rel.joinSql);
      if (rel.targetEntity === 'employees') hasEmployeeAlias = true;
    }
  }

  return {
    fromSql: `${entityMeta.baseTableSql}${joins.length ? ' ' + joins.join(' ') : ''}`,
    hasEmployeeAlias,
  };
}

async function buildEntityScopeClause(
  db: Db,
  primaryEntity: EntityId,
  hasEmployeeAlias: boolean,
  identity: Identity,
  startParamIndex: number,
): Promise<{ clause: string; params: unknown[]; nextIndex: number }> {
  if (['ADMIN', 'HR'].includes(identity.role)) {
    return { clause: '1=1', params: [], nextIndex: startParamIndex };
  }

  const entityMeta = REPORT_ENTITIES[primaryEntity];

  if (entityMeta.employeeScopeAlias && hasEmployeeAlias) {
    if (identity.role === 'EMPLOYEE') {
      return {
        clause: `e.user_id = $${startParamIndex}`,
        params: [identity.userId],
        nextIndex: startParamIndex + 1,
      };
    }

    const scope = await managementScope(db, identity);
    if (!scope) {
      return {
        clause: `e.user_id = $${startParamIndex}`,
        params: [identity.userId],
        nextIndex: startParamIndex + 1,
      };
    }

    return {
      clause: `(e.department_id = ANY($${startParamIndex}::uuid[]) OR e.user_id = ANY($${startParamIndex + 1}::uuid[]) OR e.manager_user_id = $${startParamIndex + 2} OR e.user_id = $${startParamIndex + 2})`,
      params: [scope.departments, scope.users, identity.userId],
      nextIndex: startParamIndex + 3,
    };
  }

  // Scoped manager for departments / positions
  if (
    identity.role === 'MANAGER' &&
    (primaryEntity === 'departments' || primaryEntity === 'positions')
  ) {
    const scope = await managementScope(db, identity);
    if (!scope || !scope.departments.length) {
      return { clause: '1=0', params: [], nextIndex: startParamIndex };
    }
    const deptCol = primaryEntity === 'departments' ? 'd.id' : 'pos.department_id';
    return {
      clause: `${deptCol} = ANY($${startParamIndex}::uuid[])`,
      params: [scope.departments],
      nextIndex: startParamIndex + 1,
    };
  }

  return { clause: '1=1', params: [], nextIndex: startParamIndex };
}

function resolveRelativeDateBounds(preset: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const fmt = (date: Date) => date.toISOString().slice(0, 10);

  switch (preset) {
    case 'TODAY': {
      const s = fmt(new Date(Date.UTC(y, m, d)));
      return { from: s, to: s };
    }
    case 'YESTERDAY': {
      const s = fmt(new Date(Date.UTC(y, m, d - 1)));
      return { from: s, to: s };
    }
    case 'LAST_7_DAYS':
      return {
        from: fmt(new Date(Date.UTC(y, m, d - 6))),
        to: fmt(new Date(Date.UTC(y, m, d))),
      };
    case 'LAST_30_DAYS':
      return {
        from: fmt(new Date(Date.UTC(y, m, d - 29))),
        to: fmt(new Date(Date.UTC(y, m, d))),
      };
    case 'THIS_MONTH':
      return {
        from: fmt(new Date(Date.UTC(y, m, 1))),
        to: fmt(new Date(Date.UTC(y, m + 1, 0))),
      };
    case 'LAST_MONTH':
      return {
        from: fmt(new Date(Date.UTC(y, m - 1, 1))),
        to: fmt(new Date(Date.UTC(y, m, 0))),
      };
    case 'THIS_QUARTER': {
      const qStart = Math.floor(m / 3) * 3;
      return {
        from: fmt(new Date(Date.UTC(y, qStart, 1))),
        to: fmt(new Date(Date.UTC(y, qStart + 3, 0))),
      };
    }
    case 'THIS_YEAR':
      return {
        from: fmt(new Date(Date.UTC(y, 0, 1))),
        to: fmt(new Date(Date.UTC(y, 11, 31))),
      };
    case 'LAST_YEAR':
      return {
        from: fmt(new Date(Date.UTC(y - 1, 0, 1))),
        to: fmt(new Date(Date.UTC(y - 1, 11, 31))),
      };
    default:
      fail(400, 'INVALID_RELATIVE_DATE');
  }
}

function compileFilterGroup(
  group: FilterGroupInput,
  availableFields: Map<string, ReportFieldMeta>,
  params: unknown[],
  depth = 0,
  ruleCount = { count: 0 },
): string {
  if (depth > 5) fail(400, 'FILTER_DEPTH_EXCEEDED');

  const clauses: string[] = [];

  for (const rule of group.rules) {
    ruleCount.count += 1;
    if (ruleCount.count > 30) fail(400, 'FILTER_RULE_LIMIT_EXCEEDED');

    const field = availableFields.get(rule.fieldId);
    if (!field) fail(403, 'UNAUTHORIZED_REPORT_FIELD');
    if (!field.filterOperators.includes(rule.operator as FilterOperator)) {
      fail(400, 'INVALID_FILTER_OPERATOR');
    }

    const expr = field.sqlExpr;

    switch (rule.operator) {
      case 'is_null':
        clauses.push(`(${expr} IS NULL)`);
        break;
      case 'is_not_null':
        clauses.push(`(${expr} IS NOT NULL)`);
        break;
      case 'eq':
        params.push(rule.value);
        clauses.push(`(${expr} = $${params.length})`);
        break;
      case 'neq':
        params.push(rule.value);
        clauses.push(`(${expr} IS DISTINCT FROM $${params.length})`);
        break;
      case 'contains': {
        const escaped = escapeLike(String(rule.value ?? ''));
        params.push(`%${escaped}%`);
        clauses.push(`(${expr}::text ILIKE $${params.length} ESCAPE '\\')`);
        break;
      }
      case 'not_contains': {
        const escaped = escapeLike(String(rule.value ?? ''));
        params.push(`%${escaped}%`);
        clauses.push(`(${expr}::text NOT ILIKE $${params.length} ESCAPE '\\')`);
        break;
      }
      case 'starts_with': {
        const escaped = escapeLike(String(rule.value ?? ''));
        params.push(`${escaped}%`);
        clauses.push(`(${expr}::text ILIKE $${params.length} ESCAPE '\\')`);
        break;
      }
      case 'gt':
        params.push(rule.value);
        clauses.push(`(${expr} > $${params.length})`);
        break;
      case 'gte':
        params.push(rule.value);
        clauses.push(`(${expr} >= $${params.length})`);
        break;
      case 'lt':
        params.push(rule.value);
        clauses.push(`(${expr} < $${params.length})`);
        break;
      case 'lte':
        params.push(rule.value);
        clauses.push(`(${expr} <= $${params.length})`);
        break;
      case 'between':
        params.push(rule.value, rule.valueTo);
        clauses.push(`(${expr} BETWEEN $${params.length - 1} AND $${params.length})`);
        break;
      case 'in': {
        const arr = Array.isArray(rule.value)
          ? rule.value.map(String)
          : String(rule.value ?? '')
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);
        if (!arr.length) fail(400, 'EMPTY_FILTER_LIST');
        params.push(arr);
        clauses.push(`(${expr}::text = ANY($${params.length}::text[]))`);
        break;
      }
      case 'not_in': {
        const arr = Array.isArray(rule.value)
          ? rule.value.map(String)
          : String(rule.value ?? '')
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);
        if (!arr.length) fail(400, 'EMPTY_FILTER_LIST');
        params.push(arr);
        clauses.push(`(${expr}::text <> ALL($${params.length}::text[]))`);
        break;
      }
      case 'relative_date': {
        const bounds = resolveRelativeDateBounds(String(rule.value ?? ''));
        params.push(bounds.from, bounds.to);
        clauses.push(
          `((${expr})::date BETWEEN $${params.length - 1}::date AND $${params.length}::date)`,
        );
        break;
      }
    }
  }

  for (const subGroup of group.groups) {
    const subSql = compileFilterGroup(subGroup, availableFields, params, depth + 1, ruleCount);
    if (subSql) clauses.push(`(${subSql})`);
  }

  if (!clauses.length) return '';
  return clauses.join(group.logic === 'OR' ? ' OR ' : ' AND ');
}

function dimensionSqlExpr(field: ReportFieldMeta, granularity?: DateGranularity): string {
  if (field.dataType !== 'date' || !granularity) {
    return field.sqlExpr;
  }
  switch (granularity) {
    case 'DAY':
      return `to_char((${field.sqlExpr})::date, 'YYYY-MM-DD')`;
    case 'WEEK':
      return `to_char(date_trunc('week', (${field.sqlExpr})::timestamp), 'IYYY-"W"IW')`;
    case 'MONTH':
      return `to_char(date_trunc('month', (${field.sqlExpr})::timestamp), 'YYYY-MM')`;
    case 'QUARTER':
      return `to_char(date_trunc('quarter', (${field.sqlExpr})::timestamp), 'YYYY-"Q"Q')`;
    case 'YEAR':
      return `to_char(date_trunc('year', (${field.sqlExpr})::timestamp), 'YYYY')`;
  }
}

function aggregationSqlExpr(field: ReportFieldMeta, agg: AggregationFn): string {
  const isNumeric = field.dataType === 'number' || field.dataType === 'currency';
  switch (agg) {
    case 'SUM':
    case 'PERCENTAGE':
    case 'RUNNING_TOTAL':
    case 'RANK':
    case 'GROWTH_RATE':
      return isNumeric
        ? `COALESCE(SUM(${field.sqlExpr}), 0)::double precision`
        : `COUNT(${field.sqlExpr})::double precision`;
    case 'AVG':
      return `COALESCE(AVG(${field.sqlExpr}), 0)::double precision`;
    case 'MIN':
      return `MIN(${field.sqlExpr})`;
    case 'MAX':
      return `MAX(${field.sqlExpr})`;
    case 'MEDIAN':
      return `COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (${field.sqlExpr})::double precision), 0)::double precision`;
    case 'COUNT':
      return `COUNT(${field.sqlExpr})::double precision`;
    case 'COUNT_DISTINCT':
      return `COUNT(DISTINCT ${field.sqlExpr})::double precision`;
  }
}

function validateAndCompileFormulas(
  definition: ReportDefinition,
  availableFields: Map<string, ReportFieldMeta>,
): CompiledFormula[] {
  const fieldTypeMap = new Map<string, FormulaValueType>();
  for (const field of availableFields.values()) {
    const mapped: FormulaValueType =
      field.dataType === 'currency' || field.dataType === 'number'
        ? 'number'
        : field.dataType === 'date'
          ? 'date'
          : field.dataType === 'boolean'
            ? 'boolean'
            : 'string';
    fieldTypeMap.set(field.id, mapped);
  }
  for (const val of definition.values) {
    fieldTypeMap.set(val.id, 'number');
  }

  return definition.calculatedFields.map((cf) => {
    try {
      const validated = validateFormulaExpression(cf.formula, fieldTypeMap);
      return {
        id: cf.id,
        label: cf.label,
        format: cf.format ?? (validated.resultType === 'number' ? 'number' : validated.resultType),
        resultType: validated.resultType,
        ast: validated.ast,
        referencedFields: validated.referencedFields,
      };
    } catch (err) {
      if (err instanceof FormulaError) {
        fail(400, err.code);
      }
      throw err;
    }
  });
}

function applyPostAggregations(
  rows: Array<Record<string, unknown>>,
  definition: ReportDefinition,
): void {
  for (const measure of definition.values) {
    if (measure.aggregation === 'PERCENTAGE') {
      const total = rows.reduce((acc, r) => acc + (Number(r[measure.id]) || 0), 0);
      for (const row of rows) {
        const val = Number(row[measure.id]) || 0;
        row[measure.id] = total === 0 ? 0 : Math.round((val / total) * 10000) / 100;
      }
    } else if (measure.aggregation === 'RUNNING_TOTAL') {
      let running = 0;
      for (const row of rows) {
        running += Number(row[measure.id]) || 0;
        row[measure.id] = Math.round(running * 100) / 100;
      }
    } else if (measure.aggregation === 'RANK') {
      const sorted = [...rows]
        .map((r, idx) => ({ idx, val: Number(r[measure.id]) || 0 }))
        .sort((a, b) => b.val - a.val);
      let currentRank = 1;
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i].val < sorted[i - 1].val) currentRank = i + 1;
        rows[sorted[i].idx][measure.id] = currentRank;
      }
    } else if (measure.aggregation === 'GROWTH_RATE') {
      let prev: number | null = null;
      for (const row of rows) {
        const cur = Number(row[measure.id]) || 0;
        if (prev === null || prev === 0) {
          row[measure.id] = 0;
        } else {
          row[measure.id] = Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100;
        }
        prev = cur;
      }
    }
  }
}

export async function executeCustomReport(
  pool: Pool,
  identity: Identity,
  rawDefinition: unknown,
  options: {
    locale: 'vi' | 'en';
    page?: number;
    pageSize?: number;
    bypassCache?: boolean;
    exportAll?: boolean;
  },
): Promise<ReportExecutionResult> {
  const startedAt = Date.now();
  const definition = parseReportDefinition(rawDefinition);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.exportAll
    ? 10_000
    : Math.min(500, Math.max(1, options.pageSize ?? definition.options.pageSize));

  const cacheKey = createHash('sha256')
    .update(
      JSON.stringify({
        orgId: identity.orgId,
        userId: identity.userId,
        role: identity.role,
        locale: options.locale,
        page,
        pageSize,
        exportAll: Boolean(options.exportAll),
        definition,
      }),
    )
    .digest('hex');

  if (!options.bypassCache) {
    const cached = queryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.result,
        meta: { ...cached.result.meta, cached: true },
      };
    }
  }

  const availableFields = resolveAvailableFieldsForDefinition(
    definition.primaryEntity,
    definition.relatedEntities,
    identity.role,
  );
  const compiledFormulas = validateAndCompileFormulas(definition, availableFields);

  const { fromSql, hasEmployeeAlias } = buildFromAndJoins(
    definition.primaryEntity,
    definition.relatedEntities,
    identity,
  );

  const entityMeta = REPORT_ENTITIES[definition.primaryEntity];
  const params: unknown[] = [identity.orgId];
  const scope = await buildEntityScopeClause(
    pool,
    definition.primaryEntity,
    hasEmployeeAlias,
    identity,
    params.length + 1,
  );
  params.push(...scope.params);

  const filterSql = compileFilterGroup(definition.filters, availableFields, params);
  const whereSql = `${entityMeta.orgColumnSql} = $1 AND (${scope.clause})${filterSql ? ` AND (${filterSql})` : ''}`;

  const groupDims =
    definition.groupBy.length > 0
      ? definition.groupBy
      : [...definition.rows, ...definition.pivotColumns];

  const isPivot = definition.pivotColumns.length > 0 && definition.values.length > 0;
  const isGrouped = isPivot || groupDims.length > 0 || definition.values.length > 0;

  let result: ReportExecutionResult;

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10000'");

    if (!isGrouped) {
      // ---- FLAT TABLE QUERY ----
      const selectedCols: Array<{
        fieldId: string;
        label?: string;
        format?: 'text' | 'number' | 'currency' | 'percent' | 'date' | 'datetime' | 'boolean';
        width?: number;
      }> =
        definition.columns.length > 0
          ? definition.columns
          : [...availableFields.values()].slice(0, 6).map((f) => ({ fieldId: f.id }));

      const formulaExtraFields = new Set<string>();
      for (const cf of compiledFormulas) {
        for (const fId of cf.referencedFields) {
          if (!selectedCols.some((c) => c.fieldId === fId)) {
            formulaExtraFields.add(fId);
          }
        }
      }

      const selectParts: string[] = [`${entityMeta.primaryKeySql} AS "__row_id"`];
      const resultColumns: ResultColumn[] = [];

      for (const col of selectedCols) {
        const meta = availableFields.get(col.fieldId);
        if (!meta) fail(403, 'UNAUTHORIZED_REPORT_FIELD');
        const alias = col.fieldId;
        selectParts.push(`${meta.sqlExpr} AS "${alias}"`);
        resultColumns.push({
          key: alias,
          fieldId: col.fieldId,
          label: col.label ?? (options.locale === 'en' ? meta.labelEn : meta.labelVi),
          dataType:
            meta.dataType === 'currency'
              ? 'currency'
              : meta.dataType === 'number'
                ? 'number'
                : meta.dataType === 'date'
                  ? 'date'
                  : meta.dataType === 'boolean'
                    ? 'boolean'
                    : 'string',
          format: col.format ?? meta.defaultFormat,
          isMeasure: false,
          width: col.width,
        });
      }

      for (const extraId of formulaExtraFields) {
        const meta = availableFields.get(extraId);
        if (!meta) fail(403, 'UNAUTHORIZED_REPORT_FIELD');
        selectParts.push(`${meta.sqlExpr} AS "${extraId}"`);
      }

      for (const cf of compiledFormulas) {
        resultColumns.push({
          key: cf.id,
          fieldId: cf.id,
          label: cf.label,
          dataType: cf.resultType,
          format: cf.format,
          isMeasure: cf.resultType === 'number',
        });
      }

      const orderClauses: string[] = [];
      for (const sort of definition.sortBy) {
        const meta = availableFields.get(sort.fieldId);
        if (meta && meta.sortable) {
          orderClauses.push(
            `${meta.sqlExpr} ${sort.direction === 'DESC' ? 'DESC' : 'ASC'} NULLS LAST`,
          );
        }
      }
      if (!orderClauses.length) {
        orderClauses.push(`${entityMeta.primaryKeySql} ASC`);
      }

      const countRes = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM ${fromSql} WHERE ${whereSql}`,
        params,
      );
      const totalRows = parseInt(countRes.rows[0]?.total ?? '0', 10);

      const offset = (page - 1) * pageSize;
      const dataParams = [...params, pageSize, offset];
      const rowsRes = await client.query<Record<string, unknown>>(
        `SELECT ${selectParts.join(', ')}
         FROM ${fromSql}
         WHERE ${whereSql}
         ORDER BY ${orderClauses.join(', ')}
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      );

      const rows = rowsRes.rows.map((raw) => {
        const row: Record<string, unknown> = { ...raw };
        for (const cf of compiledFormulas) {
          row[cf.id] = evaluateFormulaAst(cf.ast, row);
        }
        return row;
      });

      // Compute totals for numeric columns if enabled
      let totals: Record<string, unknown> | null = null;
      if (definition.options.showTotals && rows.length > 0) {
        totals = {};
        for (const col of resultColumns) {
          if (col.dataType === 'number' || col.dataType === 'currency') {
            const meta = availableFields.get(col.fieldId);
            if (!meta || meta.isAdditive !== false) {
              const sum = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
              totals[col.key] = Math.round(sum * 100) / 100;
            }
          }
        }
      }

      result = {
        mode: 'FLAT',
        columns: resultColumns,
        rows,
        totals,
        subtotals: [],
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
        },
        meta: {
          executionMs: Date.now() - startedAt,
          cached: false,
          primaryEntity: definition.primaryEntity,
          relatedEntities: definition.relatedEntities,
        },
      };
    } else {
      // ---- GROUPED / PIVOT QUERY ----
      // Deduplicate dimensions while preserving order
      const seenDimKeys = new Set<string>();
      const effectiveDims: Array<{
        key: string;
        fieldId: string;
        label: string;
        granularity?: DateGranularity;
        sqlExpr: string;
        meta: ReportFieldMeta;
      }> = [];

      const rawDims = isPivot ? [...definition.rows, ...definition.pivotColumns] : groupDims;

      for (const dim of rawDims) {
        const meta = availableFields.get(dim.fieldId);
        if (!meta) fail(403, 'UNAUTHORIZED_REPORT_FIELD');
        if (!meta.groupable) fail(400, 'FIELD_NOT_GROUPABLE');
        const key = dim.granularity ? `${dim.fieldId}__${dim.granularity}` : dim.fieldId;
        if (seenDimKeys.has(key)) continue;
        seenDimKeys.add(key);
        effectiveDims.push({
          key,
          fieldId: dim.fieldId,
          label: dim.label ?? (options.locale === 'en' ? meta.labelEn : meta.labelVi),
          granularity: dim.granularity,
          sqlExpr: dimensionSqlExpr(meta, dim.granularity),
          meta,
        });
      }

      const selectParts: string[] = [];
      const groupByParts: string[] = [];
      const resultColumns: ResultColumn[] = [];
      const aliasToSql = new Map<string, string>();

      for (const dim of effectiveDims) {
        selectParts.push(`${dim.sqlExpr} AS "${dim.key}"`);
        groupByParts.push(dim.sqlExpr);
        aliasToSql.set(dim.key, dim.sqlExpr);
        aliasToSql.set(dim.fieldId, dim.sqlExpr);
        resultColumns.push({
          key: dim.key,
          fieldId: dim.fieldId,
          label: dim.label,
          dataType: dim.granularity ? 'string' : dim.meta.dataType === 'date' ? 'date' : 'string',
          format: dim.granularity ? 'text' : dim.meta.defaultFormat,
          isMeasure: false,
        });
      }

      // Default measure if user grouped without picking values
      const measures =
        definition.values.length > 0
          ? definition.values
          : [
              {
                id: 'count_records',
                fieldId: availableFields.keys().next().value!,
                aggregation: 'COUNT' as const,
                label: options.locale === 'en' ? 'Record count' : 'Số lượng',
              },
            ];

      for (const m of measures) {
        const meta = availableFields.get(m.fieldId);
        if (!meta) fail(403, 'UNAUTHORIZED_REPORT_FIELD');
        if (!meta.allowedAggregations.includes(m.aggregation)) {
          fail(400, 'INVALID_AGGREGATION_FOR_FIELD');
        }
        const aggExpr = aggregationSqlExpr(meta, m.aggregation);
        selectParts.push(`${aggExpr} AS ${quoteSqlIdentifier(m.id)}`);
        aliasToSql.set(m.id, aggExpr);

        const isPercent = m.aggregation === 'PERCENTAGE' || m.aggregation === 'GROWTH_RATE';
        const defaultLabel = `${options.locale === 'en' ? meta.labelEn : meta.labelVi} (${m.aggregation})`;
        resultColumns.push({
          key: m.id,
          fieldId: m.fieldId,
          label: m.label ?? defaultLabel,
          dataType: isPercent
            ? 'number'
            : meta.dataType === 'currency' &&
                m.aggregation !== 'COUNT' &&
                m.aggregation !== 'COUNT_DISTINCT' &&
                m.aggregation !== 'RANK'
              ? 'currency'
              : 'number',
          format:
            m.format ??
            (isPercent
              ? 'percent'
              : meta.dataType === 'currency' &&
                  m.aggregation !== 'COUNT' &&
                  m.aggregation !== 'COUNT_DISTINCT' &&
                  m.aggregation !== 'RANK'
                ? 'currency'
                : 'number'),
          isMeasure: true,
          aggregation: m.aggregation,
        });
      }

      for (const cf of compiledFormulas) {
        resultColumns.push({
          key: cf.id,
          fieldId: cf.id,
          label: cf.label,
          dataType: cf.resultType,
          format: cf.format,
          isMeasure: cf.resultType === 'number',
        });
      }

      const orderClauses: string[] = [];
      for (const sort of definition.sortBy) {
        const sql = aliasToSql.get(sort.fieldId);
        if (sql) {
          orderClauses.push(`${sql} ${sort.direction === 'DESC' ? 'DESC' : 'ASC'} NULLS LAST`);
        }
      }
      if (!orderClauses.length && groupByParts.length > 0) {
        orderClauses.push(...groupByParts.map((g) => `${g} ASC NULLS LAST`));
      }

      const groupBySql = groupByParts.length ? `GROUP BY ${groupByParts.join(', ')}` : '';
      const orderSql = orderClauses.length ? `ORDER BY ${orderClauses.join(', ')}` : '';

      const groupedSql = `SELECT ${selectParts.join(', ')} FROM ${fromSql} WHERE ${whereSql} ${groupBySql} ${orderSql} LIMIT 2000`;
      const groupedRes = await client.query<Record<string, unknown>>(groupedSql, params);

      const allRows = groupedRes.rows.map((raw) => {
        const row: Record<string, unknown> = { ...raw };
        for (const cf of compiledFormulas) {
          row[cf.id] = evaluateFormulaAst(cf.ast, row);
        }
        return row;
      });

      applyPostAggregations(allRows, definition);

      // Compute grand totals
      let totals: Record<string, unknown> | null = null;
      if (definition.options.showTotals && allRows.length > 0) {
        totals = {};
        for (const col of resultColumns) {
          if (col.isMeasure) {
            if (col.aggregation === 'PERCENTAGE') {
              totals[col.key] = 100;
            } else if (col.aggregation === 'AVG' || col.aggregation === 'MEDIAN') {
              const avg =
                allRows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0) / allRows.length;
              totals[col.key] = Math.round(avg * 100) / 100;
            } else if (col.aggregation === 'MIN') {
              totals[col.key] = Math.min(...allRows.map((r) => Number(r[col.key]) || 0));
            } else if (col.aggregation === 'MAX') {
              totals[col.key] = Math.max(...allRows.map((r) => Number(r[col.key]) || 0));
            } else if (col.aggregation === 'RANK' || col.aggregation === 'GROWTH_RATE') {
              totals[col.key] = null;
            } else {
              const sum = allRows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
              totals[col.key] = Math.round(sum * 100) / 100;
            }
          }
        }
      }

      // Compute subtotals if multi-level row dimensions + showSubtotals
      const subtotals: Array<Record<string, unknown>> = [];
      if (definition.options.showSubtotals && effectiveDims.length >= 2 && allRows.length > 0) {
        const primaryDimKey = effectiveDims[0].key;
        const groups = new Map<string, Array<Record<string, unknown>>>();
        for (const r of allRows) {
          const k = String(r[primaryDimKey] ?? '—');
          const arr = groups.get(k) ?? [];
          arr.push(r);
          groups.set(k, arr);
        }
        for (const [groupVal, groupRows] of groups.entries()) {
          const sub: Record<string, unknown> = { [primaryDimKey]: groupVal, __isSubtotal: true };
          for (const col of resultColumns) {
            if (col.isMeasure) {
              const sum = groupRows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
              sub[col.key] =
                col.aggregation === 'AVG'
                  ? Math.round((sum / groupRows.length) * 100) / 100
                  : Math.round(sum * 100) / 100;
            }
          }
          subtotals.push(sub);
        }
      }

      // Build pivot structure if pivotColumns are configured
      let pivot: PivotResult | undefined;
      if (isPivot) {
        const rowDims = definition.rows.map((r) => {
          const key = r.granularity ? `${r.fieldId}__${r.granularity}` : r.fieldId;
          const meta = availableFields.get(r.fieldId)!;
          return {
            key,
            label: r.label ?? (options.locale === 'en' ? meta.labelEn : meta.labelVi),
          };
        });
        const pivotDimSpec = definition.pivotColumns[0];
        const pivotKeyField = pivotDimSpec.granularity
          ? `${pivotDimSpec.fieldId}__${pivotDimSpec.granularity}`
          : pivotDimSpec.fieldId;
        const pivotMeta = availableFields.get(pivotDimSpec.fieldId)!;

        const pivotKeysSet = new Set<string>();
        const rowMap = new Map<
          string,
          {
            dimensions: Record<string, string>;
            cells: Record<string, Record<string, number | null>>;
            rowTotals: Record<string, number | null>;
          }
        >();
        const columnTotals: Record<string, Record<string, number | null>> = {};
        const grandTotals: Record<string, number | null> = {};

        const measureSpecs = resultColumns
          .filter((c) => c.isMeasure)
          .map((c) => ({ id: c.key, label: c.label, format: c.format }));

        for (const r of allRows) {
          const pVal =
            definition.pivotColumns.length === 1
              ? String(r[pivotKeyField] ?? '—')
              : definition.pivotColumns
                  .map((pc) => {
                    const k = pc.granularity ? `${pc.fieldId}__${pc.granularity}` : pc.fieldId;
                    return String(r[k] ?? '—');
                  })
                  .join(' / ');
          pivotKeysSet.add(pVal);

          const dimValues: Record<string, string> = {};
          const rowKey =
            rowDims.length > 0
              ? rowDims.map((d) => `${d.key}=${String(r[d.key] ?? '—')}`).join('|')
              : '__all__';
          for (const d of rowDims) {
            dimValues[d.key] = String(r[d.key] ?? '—');
          }

          let entry = rowMap.get(rowKey);
          if (!entry) {
            entry = { dimensions: dimValues, cells: {}, rowTotals: {} };
            rowMap.set(rowKey, entry);
          }

          if (!entry.cells[pVal]) entry.cells[pVal] = {};
          if (!columnTotals[pVal]) columnTotals[pVal] = {};

          for (const m of measureSpecs) {
            const num = Number(r[m.id]) || 0;
            entry.cells[pVal][m.id] =
              Math.round(((entry.cells[pVal][m.id] ?? 0) + num) * 100) / 100;
            entry.rowTotals[m.id] = Math.round(((entry.rowTotals[m.id] ?? 0) + num) * 100) / 100;
            columnTotals[pVal][m.id] =
              Math.round(((columnTotals[pVal][m.id] ?? 0) + num) * 100) / 100;
            grandTotals[m.id] = Math.round(((grandTotals[m.id] ?? 0) + num) * 100) / 100;
          }
        }

        pivot = {
          rowDimensions: rowDims,
          pivotColumnLabel:
            pivotDimSpec.label ?? (options.locale === 'en' ? pivotMeta.labelEn : pivotMeta.labelVi),
          pivotKeys: [...pivotKeysSet].slice(0, 40),
          measures: measureSpecs,
          rows: [...rowMap.values()],
          columnTotals,
          grandTotals,
        };
      }

      const totalRows = allRows.length;
      const offset = (page - 1) * pageSize;
      const pagedRows = options.exportAll ? allRows : allRows.slice(offset, offset + pageSize);

      result = {
        mode: isPivot ? 'PIVOT' : 'GROUPED',
        columns: resultColumns,
        rows: pagedRows,
        totals,
        subtotals,
        pivot,
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
        },
        meta: {
          executionMs: Date.now() - startedAt,
          cached: false,
          primaryEntity: definition.primaryEntity,
          relatedEntities: definition.relatedEntities,
        },
      };
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (queryCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = queryCache.keys().next().value;
    if (firstKey) queryCache.delete(firstKey);
  }
  queryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });

  return result;
}

export async function executeCustomReportDrilldown(
  pool: Pool,
  identity: Identity,
  rawDefinition: unknown,
  dimensionFilters: Array<{ fieldId: string; value: unknown; granularity?: DateGranularity }>,
  options: { locale: 'vi' | 'en'; page?: number; pageSize?: number },
): Promise<{
  columns: ResultColumn[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
}> {
  const definition = parseReportDefinition(rawDefinition);
  const availableFields = resolveAvailableFieldsForDefinition(
    definition.primaryEntity,
    definition.relatedEntities,
    identity.role,
  );
  const { fromSql, hasEmployeeAlias } = buildFromAndJoins(
    definition.primaryEntity,
    definition.relatedEntities,
    identity,
  );
  const entityMeta = REPORT_ENTITIES[definition.primaryEntity];

  const params: unknown[] = [identity.orgId];
  const scope = await buildEntityScopeClause(
    pool,
    definition.primaryEntity,
    hasEmployeeAlias,
    identity,
    params.length + 1,
  );
  params.push(...scope.params);

  const filterSql = compileFilterGroup(definition.filters, availableFields, params);
  const drillClauses: string[] = [];

  for (const df of dimensionFilters) {
    const meta = availableFields.get(df.fieldId);
    if (!meta) fail(403, 'UNAUTHORIZED_REPORT_FIELD');
    const expr = dimensionSqlExpr(meta, df.granularity);
    if (df.value === null || df.value === undefined || df.value === '—') {
      drillClauses.push(`(${expr} IS NULL OR ${expr}::text = '—')`);
    } else {
      params.push(String(df.value));
      drillClauses.push(`(${expr}::text = $${params.length})`);
    }
  }

  const whereSql = `${entityMeta.orgColumnSql} = $1 AND (${scope.clause})${filterSql ? ` AND (${filterSql})` : ''}${drillClauses.length ? ` AND ${drillClauses.join(' AND ')}` : ''}`;

  const cols = [...availableFields.values()].slice(0, 8);
  const selectParts = [`${entityMeta.primaryKeySql} AS "__row_id"`].concat(
    cols.map((c) => `${c.sqlExpr} AS "${c.id}"`),
  );

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM ${fromSql} WHERE ${whereSql}`,
    params,
  );
  const totalRows = parseInt(countRes.rows[0]?.total ?? '0', 10);

  const dataParams = [...params, pageSize, offset];
  const rowsRes = await pool.query<Record<string, unknown>>(
    `SELECT ${selectParts.join(', ')}
     FROM ${fromSql}
     WHERE ${whereSql}
     ORDER BY ${entityMeta.primaryKeySql} ASC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );

  return {
    columns: cols.map((c) => ({
      key: c.id,
      fieldId: c.id,
      label: options.locale === 'en' ? c.labelEn : c.labelVi,
      dataType:
        c.dataType === 'currency'
          ? 'currency'
          : c.dataType === 'number'
            ? 'number'
            : c.dataType === 'date'
              ? 'date'
              : c.dataType === 'boolean'
                ? 'boolean'
                : 'string',
      format: c.defaultFormat,
      isMeasure: false,
    })),
    rows: rowsRes.rows,
    totalRows,
  };
}
