# RPT-002: Dynamic Custom Report Builder & Analytics Studio

## 1. Architecture Overview

The **Report Builder Studio** extends ManagerHR's reporting module (`ReportingCenter`) with a no-code self-service Business Intelligence workspace backed by a semantic metadata registry, parameterized SQL query generator, safe calculated-field AST engine, library/versioning persistence, and synchronous/asynchronous exports.

```
[Data Explorer (M:1 Entities + Calculated Fields)]
        │  Drag & Drop / Accessible Quick-Add (+)
        ▼
[Report Definition AST (Columns, Rows, Pivot, Values, GroupBy, Nested Filters, SortBy)]
        │
        ├── POST /reports/builder/validate-formula ──► Tokenizer + AST Parser + Type Checker
        ├── POST /reports/builder/execute ───────────► RBAC/Scope Enforcement + Parameterized SQL
        │                                              + Post-Aggregations + Pivot Cross-Tab + 30s Cache
        ├── POST /reports/builder/drilldown ─────────► Authorized Detail Records Modal
        ├── CRUD /reports/builder/library ───────────► Versioning + Sharing + Favorites
        └── POST /reports/builder/export(-jobs) ─────► Formula-Safe CSV / XLSX / PDF
```

## 2. Database Schema (`database/migrations/023_custom_report_builder.sql`)

Additive, transactional migration preserving all existing tables:

- `custom_reports`: Stores structured `definition` JSONB, `primary_entity`, `related_entities`, `visualization_type` (`TABLE`, `PIVOT`, `BAR`, `COLUMN`, `LINE`, `AREA`, `PIE`, `DONUT`, `STACKED_BAR`, `COMBO`, `HEATMAP`, `KPI`), `visibility` (`PRIVATE`, `SHARED`, `ORG_TEMPLATE`), `shared_roles`, `shared_user_ids`, `is_template`, and current `version`.
- `custom_report_versions`: Immutable snapshot history per save/update (`UNIQUE (report_id, version)`).
- `custom_report_user_prefs`: Per-user favorites (`is_favorite`) and recent usage timestamps (`last_viewed_at`).
- `custom_report_export_jobs`: Tracks asynchronous background exports for CSV, Excel (`.xlsx`), and PDF with snapshot definition, status, row count, and generated binary output.
- `idx_employees_org_status_hire`: Supporting analytics index on `employees`.

## 3. Semantic Layer & Join Safety (`backend/src/report-builder-metadata.ts`)

Only vetted entities and safe `MANY_TO_ONE` join paths are exposed:

- **Primary & Related Entities**: `employees`, `departments`, `positions`, `contracts`, `attendance`, `leave_requests`, `payroll_slips`, `payroll_journal_lines`.
- **Anti-Cartesian / Anti-Fanout Guarantee**: Only `MANY_TO_ONE` joins are permitted from primary entities to lookup entities (e.g., `payroll_slips` -> `employees` -> `departments` / `positions`), eliminating `1:N` row duplication and inflated `SUM` / `COUNT` totals.
- **Role Allowlists**: Both entity and individual field metadata carry `minRole` (`EMPLOYEE`, `MANAGER`, `HR`, `ADMIN`), filtering out sensitive payroll/tax/identity fields for unauthorized roles on both metadata retrieval and execution.

## 4. Safe Calculated Field Engine (`backend/src/report-builder-formula.ts`)

Custom metrics are parsed by a dedicated recursive-descent lexer/parser into an AST without `eval`, `Function`, SQL interpolation, or external code execution:

- **Supported Operators**: `+`, `-`, `*`, `/`, `%`, `=`, `!=`, `<`, `<=`, `>`, `>=`, `AND`, `OR`, `NOT`.
- **Supported Functions**: `IF`, `COALESCE`, `ROUND`, `ABS`, `CEIL`, `FLOOR`, `MIN`, `MAX`, `SAFE_DIV`, `CONCAT`, `UPPER`, `LOWER`, `LEN`, `DAYS_BETWEEN`, `YEAR`, `MONTH`.
- **Safety Guards**: Bounded expression length (`500` chars), token limit (`120`), AST recursion depth limit, authorized `[field_id]` allowlist check, static type compatibility checking, and null-safe division protection (`/` and `SAFE_DIV` never throw or produce `Infinity`).

## 5. Query Engine, Aggregations & Security (`backend/src/report-builder-engine.ts`)

- **Isolation & Scope**: Always enforces `organization_id = $1` plus `managementScope()` restrictions (`EMPLOYEE` own records only; `MANAGER` supervised department/direct reports only; `HR`/`ADMIN` org-wide).
- **Read Safety**: Executes inside `BEGIN READ ONLY` with `SET LOCAL statement_timeout = '10000'`.
- **Aggregations**: `SUM`, `COUNT`, `COUNT_DISTINCT`, `AVG`, `MIN`, `MAX`, `MEDIAN` (`PERCENTILE_CONT(0.5)`), plus deterministic post-aggregations (`PERCENTAGE`, `RUNNING_TOTAL`, `RANK`, `GROWTH_RATE`).
- **Date Bucketing**: Supports `DAY`, `WEEK`, `MONTH`, `QUARTER`, and `YEAR` grouping.
- **Caching**: 30-second permission-aware in-memory cache keyed by `orgId:role:scopeSignature:definitionHash`.
- **Nested Filters**: Recursive `AND` / `OR` groups supporting text, numeric, date (including `relative_date` presets), boolean, enum multi-select (`in` / `not_in`), and null checks.

## 6. Exports & Formula Injection Defense (`backend/src/report-builder-export.ts`)

- Generates locale-aware UTF-8 BOM `.csv`, native OOXML `.xlsx` workbooks, and multi-page `.pdf` reports respecting all selected dimensions, aggregations, pivot matrices, totals, and sorting.
- All text cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` are neutralized with a leading apostrophe (`'`) before CSV/XLSX serialization to prevent spreadsheet formula injection.
- Every export logs an audit event (`report_export_audit_logs` + `audit()`).

## 7. Frontend Studio (`frontend/src/pages/Reporting/builder/`)

- **Library (`CustomReportsLibrary.tsx`)**: Tabs for My Reports, Shared Reports, Templates (including prebuilt HR/Attendance/Leave/Payroll/Labor Cost templates), Favorites, and Recent Reports.
- **Three-Panel Studio (`ReportBuilderStudio.tsx`)**:
  - **Left (`DataExplorerPanel.tsx`)**: Primary source `SearchableSelect`, M:1 join toggles, field search, categorized collapsible groups with type badges and tooltips, drag-and-drop items + accessible `+` quick-add, and Calculated Fields manager.
  - **Center (`ReportCanvasPanel.tsx` + `ReportCharts.tsx`)**: View switcher (Table, Pivot Matrix, Bar, Column, Line, Area, Pie, Donut, Stacked Bar, Combo, Heatmap, KPI Cards), fullscreen mode, column resize, sticky headers, sorting, pagination, expandable multi-level subtotals, grand totals, conditional formatting highlights, and record drill-down dialog.
  - **Right (`ReportConfigPanel.tsx`)**: Drop zones for Display Columns, Rows, Pivot Columns, Values, Group By, Filters, and Sort By with keyboard reorder/duplicate/remove controls and collapsible Field, Visualization, Conditional Formatting, and Advanced sections.
  - **Modals**: `CalculatedFieldModal.tsx`, `AdvancedFilterBuilder.tsx`, `ShareReportModal.tsx`.
- **Internationalization (`reportBuilderMessages.ts`)**: Complete `vi` and `en` coverage compatible with `scripts-i18n-check.mjs`.
