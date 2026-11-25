import { describe, expect, it } from 'vitest';
import {
  evaluateFormulaAst,
  FormulaError,
  validateFormulaExpression,
  type FormulaValueType,
} from '../src/report-builder-formula.js';
import { getAuthorizedMetadata } from '../src/report-builder-metadata.js';
import { renderReportExport, sanitizeSpreadsheetText } from '../src/report-builder-export.js';
import { ReportDefinitionSchema } from '../src/report-builder-engine.js';

describe('RPT-002 Formula Parser & Evaluator', () => {
  const fieldTypes = new Map<string, FormulaValueType>([
    ['slip.gross_pay', 'number'],
    ['slip.total_deductions', 'number'],
    ['slip.net_pay', 'number'],
    ['emp.status', 'string'],
    ['emp.hire_date', 'date'],
  ]);

  it('parses and evaluates arithmetic, conditional IF, and SAFE_DIV accurately', () => {
    const validated = validateFormulaExpression(
      'IF([slip.gross_pay] > 0, ROUND(SAFE_DIV([slip.net_pay], [slip.gross_pay], 0) * 100, 2), 0)',
      fieldTypes,
    );
    expect(validated.valid).toBe(true);
    expect(validated.resultType).toBe('number');
    expect(validated.referencedFields).toEqual(['slip.gross_pay', 'slip.net_pay']);

    const val = evaluateFormulaAst(validated.ast, {
      'slip.gross_pay': 20_000_000,
      'slip.net_pay': 17_500_000,
    });
    expect(val).toBe(87.5);

    const zeroDenom = evaluateFormulaAst(validated.ast, {
      'slip.gross_pay': 0,
      'slip.net_pay': 0,
    });
    expect(zeroDenom).toBe(0);
  });

  it('prevents division by zero on raw "/" operator and returns null', () => {
    const validated = validateFormulaExpression('[slip.net_pay] / [slip.gross_pay]', fieldTypes);
    expect(
      evaluateFormulaAst(validated.ast, { 'slip.net_pay': 100, 'slip.gross_pay': 0 }),
    ).toBeNull();
  });

  it('rejects unauthorized fields, unknown functions, and arbitrary code', () => {
    expect(() => validateFormulaExpression('[slip.secret_token] + 1', fieldTypes)).toThrow(
      FormulaError,
    );
    expect(() => validateFormulaExpression('EVAL("process.exit(1)")', fieldTypes)).toThrow(
      FormulaError,
    );
    expect(() => validateFormulaExpression('SELECT(1)', fieldTypes)).toThrow(FormulaError);
  });
});

describe('RPT-002 Semantic Metadata Authorization', () => {
  it('excludes payroll and sensitive personal fields for EMPLOYEE role', () => {
    const empMeta = getAuthorizedMetadata('EMPLOYEE', 'en');
    const entityIds = empMeta.entities.map((e) => e.id);
    expect(entityIds).toContain('employees');
    expect(entityIds).toContain('attendance');
    expect(entityIds).not.toContain('payroll_slips');
    expect(entityIds).not.toContain('payroll_journal_lines');

    const fieldIds = empMeta.fields.map((f) => f.id);
    expect(fieldIds).toContain('emp.full_name');
    expect(fieldIds).not.toContain('emp.personal_email');
    expect(fieldIds).not.toContain('slip.net_pay');
  });

  it('grants HR full access to payroll, accounting, and templates', () => {
    const hrMeta = getAuthorizedMetadata('HR', 'vi');
    expect(hrMeta.entities.map((e) => e.id)).toContain('payroll_slips');
    expect(hrMeta.entities.map((e) => e.id)).toContain('payroll_journal_lines');
    expect(hrMeta.fields.map((f) => f.id)).toContain('slip.net_pay');
    expect(hrMeta.templates.length).toBeGreaterThanOrEqual(5);
  });

  it('validates nested filter groups and definition limits', () => {
    const def = ReportDefinitionSchema.parse({
      primaryEntity: 'employees',
      relatedEntities: ['departments'],
      columns: [{ fieldId: 'emp.code' }, { fieldId: 'emp.full_name' }],
      filters: {
        logic: 'AND',
        rules: [{ fieldId: 'emp.status', operator: 'eq', value: 'ACTIVE' }],
        groups: [
          {
            logic: 'OR',
            rules: [{ fieldId: 'dept.code', operator: 'eq', value: 'ENG' }],
            groups: [],
          },
        ],
      },
    });
    expect(def.primaryEntity).toBe('employees');
    expect(def.filters.groups).toHaveLength(1);
  });
});

describe('RPT-002 Export Engine & Formula Injection Protection', () => {
  it('neutralizes CSV and Excel formula injection payloads', () => {
    expect(sanitizeSpreadsheetText('=CMD|"/C calc"!A0')).toBe('\'=CMD|"/C calc"!A0');
    expect(sanitizeSpreadsheetText('+1+1')).toBe("'+1+1");
    expect(sanitizeSpreadsheetText('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(sanitizeSpreadsheetText('Normal Text')).toBe('Normal Text');
  });

  it('generates valid CSV, XLSX (ZIP), and PDF buffers from execution results', () => {
    const sampleResult = {
      mode: 'GROUPED' as const,
      columns: [
        {
          key: 'dept.name',
          fieldId: 'dept.name',
          label: 'Phòng ban',
          dataType: 'string' as const,
          format: 'text',
          isMeasure: false,
        },
        {
          key: 'v1',
          fieldId: 'slip.net_pay',
          label: 'Thực lĩnh Net',
          dataType: 'currency' as const,
          format: 'currency',
          isMeasure: true,
          aggregation: 'SUM' as const,
        },
      ],
      rows: [
        { 'dept.name': '=EVIL()', v1: 25000000 },
        { 'dept.name': 'Kinh doanh', v1: 18000000 },
      ],
      totals: { v1: 43000000 },
      subtotals: [],
      pagination: { page: 1, pageSize: 50, totalRows: 2, totalPages: 1 },
      meta: {
        executionMs: 12,
        cached: false,
        primaryEntity: 'payroll_slips' as const,
        relatedEntities: ['departments' as const],
      },
    };

    const csv = renderReportExport('Bao cao luong', 'CSV', sampleResult, 'vi');
    expect(csv.contentType).toContain('text/csv');
    expect(csv.buffer.toString('utf8')).toContain("'=EVIL()");

    const xlsx = renderReportExport('Bao cao luong', 'EXCEL', sampleResult, 'vi');
    expect(xlsx.contentType).toContain('spreadsheetml.sheet');
    expect(xlsx.buffer.subarray(0, 2).toString('utf8')).toBe('PK');

    const pdf = renderReportExport('Bao cao luong', 'PDF', sampleResult, 'en');
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 8).toString('utf8')).toBe('%PDF-1.4');
  });
});
