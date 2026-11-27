# RPT-004 — Executive analytics

The `/app` dashboard now includes executive workforce, attendance, payroll, recorded cost and read-only audit analytics. Account/session widgets remain available below it. English and Vietnamese messages are defined together in `frontend/src/pages/Dashboard/executiveMessages.ts`.

## API and access

- `GET /api/organizations/:organizationId/reports/executive`: ADMIN/HR receive workforce and financial aggregates; MANAGER receives only workforce/attendance within the existing Reporting Engine employee scope. EMPLOYEE is denied.
- Query: `startDate`, `endDate` (required ISO calendar dates); `departmentId` (exact current assignment); `branchId` (department and recursive descendants); `grain=month|quarter|year`; optional paired `compareStartDate`, `compareEndDate`.
- Each range is at most 366 inclusive days. The comparison must end before the current range starts. Without comparison dates, use the immediately preceding range with the same number of days. Explicit dates support calendar month/quarter/year comparisons of unequal length.
- Organizations/units are separate tenants. Use the existing **Select unit** link and membership-checked unit-selection flow; changing the organization ID in an analytics URL never grants access. Branches are internal department subtrees, per migration 006.
- `GET .../executive/audit`: ADMIN only. Requires `startDate`, `endDate`; supports exact `actorId`, `action`, `target`, `page` and `limit` (maximum 100). Audit calendar boundaries use Asia/Bangkok.
- Responses use `Cache-Control: no-store`. Queries use a repeatable-read, read-only transaction. Access is logged after the read; an audit-write failure prevents returning the result. Old tenant/role/filter results are hidden before the next request resolves.

No mutation or deletion endpoint is introduced for audit logs. This is an API control, not a claim that existing database credentials cannot mutate audit tables.

## KPI definitions and data availability

| KPI                        | Formula / grain                                                      | Source and availability                                                                                 |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Headcount                  | Count ACTIVE/ON_LEAVE employees hired by the snapshot date; people   | EMP / RPT-EMP-01, **current snapshot**, not historical period-end headcount                             |
| New hires                  | Count `hire_date` within range; people                               | EMP, includes people who subsequently left                                                              |
| Departures                 | Count employment departures within range; people                     | Unavailable: employees have no dated status history; contract termination is not employment termination |
| Headcount Growth           | `(closing − opening) / opening × 100`; %                             | Formula implemented/tested; runtime unavailable without historical employment snapshots                 |
| Turnover                   | `departures / ((opening + closing) / 2) × 100`; %                    | Formula implemented/tested; runtime unavailable without dated departures/headcounts                     |
| Retention                  | Opening cohort still employed at closing / opening cohort × 100; %   | Formula implemented/tested; runtime unavailable without cohort history                                  |
| Attendance                 | Ended work schedules with check-in / ended work schedules × 100; %   | Shared authoritative ATT ledger; excludes OFF and unfinished schedules                                  |
| Absenteeism                | MISSING schedules without check-in / ended work schedules × 100; %   | ATT ledger missing-record proxy, **not proof of actual absence**                                        |
| Leave                      | LEAVE schedules / ended work schedules × 100; %                      | ATT ledger and approved leave coverage                                                                  |
| Overtime                   | Overtime minutes / recorded minutes × 100; %                         | Same ATT ledger rules; only schedules with an overtime rule and complete recorded duration              |
| Average Salary             | Gross / confirmed payslip count; VND per employee-period             | PAY / RPT-PAY-01; not an average employee salary across arbitrary multi-month ranges                    |
| Cost per Employee          | Recorded EXPENSE / distinct confirmed payroll recipients; VND/person | Recorded journal expenses and PAY; recognition dates and payroll period dates can differ                |
| Payroll Cost by Department | Sum recorded Gross by current employee department; VND               | PAY / RPT-PAY-01; exact source amounts, without estimated employer charges                              |

The attendance ledger SQL was extracted without changing its logic and is reused by the original employee ledger and executive aggregation. It includes approved corrections, approved leave and virtual office schedules. Office projections follow current department configuration; attendance KPIs are provisional, not locked historical attendance totals. Missing punches/rules can leave coverage incomplete.

Ratios with missing inputs or non-positive denominators return `null`. Empty roster queries may legitimately return count 0; missing monetary/attendance source rows remain `null`. Source timestamps are shown separately from the query timestamp. Query timestamps do not establish source completeness.

## Recorded financial sources

- Payroll: only CONFIRMED/PAID slips in APPROVED/CLOSED periods **fully contained** within the range. No proration, payroll/tax/insurance recalculation or inferred wage components.
- Base, allowance, bonus and overtime amounts come directly from recorded payslip columns. Department breakdowns use current employee assignments because slips do not store historical department snapshots.
- Insurance: confirmed/adjusted monthly contribution amounts for full months in the range. Employer and employee amounts are separate. Non-VND profiles are excluded from VND sums and explicitly flagged; amounts are not converted or estimated.
- Recognized cost: net debit on EXPENSE journal lines by journal date, including posted reversals and reversed originals. Liability movement: net credit on LIABILITY lines. It is **not an outstanding liability balance**.
- Actual payments: COMPLETED disbursements by payment date. Payroll net payable, liability movement and payments are independent metrics with different date bases; the dashboard does not subtract them into an invented reconciliation balance.
- Payroll comparison uses the same organization/branch/department scope on both ranges. Money aggregates remain PostgreSQL numeric strings. Per-person division and monetary percentage change use integer cents with rounding, avoiding floating-point sums.
- Trends group recorded payroll by month, quarter or year. Existing Reporting Engine charts are reused; expandable tables retain all rows beyond the chart's existing 24-row visual limit.

Existing `cost-allocation` and statutory insurance reports contain estimated contribution calculations. Their estimated company-cost totals are not treated as recorded expenses here. That upstream behavior remains unchanged; gross payroll is the common comparable measure.

## Audit and alerts

Audit combines tenant-scoped headers from `auth_audit_events`, `compliance_audit_logs` and `report_export_audit_logs`. It exposes event/action, actor ID, target ID/code, source and timestamp, never raw salary/personal metadata. It includes existing HR/account/payroll approval events and new `EXECUTIVE_ANALYTICS_VIEWED` / `EXECUTIVE_AUDIT_VIEWED` access events. Audit browsing is paginated and lazy-loaded.

Alerts aggregate existing OPEN/ACKNOWLEDGED compliance anomalies created within the range, respecting selected employee scope. No alert thresholds or KPI targets are invented. The security-event source has no resolution workflow, so unresolved security incidents cannot be inferred from login/audit events.

## Explicit gaps and release gates

- No `GEMINI.md` exists in this checkout.
- Historical employment status/cohort data, recruitment data and budget data are absent. Their dependent KPIs/variance remain unavailable instead of showing zero.
- No migration, dependency installation, model change, subagent, production deployment or active security scan is part of this task.
- Tests are in `backend/test/reports.test.ts` (formulas, monetary aggregation, source nullability, comparison, recursive filtering, ATT parity, RBAC, tenant isolation, read-only/redacted audit and time boundaries) and `frontend/src/pages/Dashboard/ExecutiveAnalytics.test.tsx` (localization, filters, missing-data states, access gates, stale responses, failures and audit pagination).
- Run existing attendance regressions in `backend/test/employees.test.ts` after the ledger SQL extraction. Existing reporting regressions remain in `backend/test/reports.test.ts`.
- Local validation results are reported with the task handoff. CI remains authoritative for merge; SAST/Sonar, full release CI and real-browser layout verification are separate gates. High-risk merge/release requires explicit human approval.
