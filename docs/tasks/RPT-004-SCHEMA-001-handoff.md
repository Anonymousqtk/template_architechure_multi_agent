# RPT-004-SCHEMA-001

Local analytics schema repair, 2026-11-27.

## Cause and action

The configured localhost database had tables from migrations 020 and 023, but no tables from 018 or 019. Analytics failed with PostgreSQL `42P01`: `payroll_disbursements` did not exist. The generic UI reference to migration 023 did not identify the missing migration.

Applied existing 018 and 019 SQL to that local database in one transaction after a successful trial with rollback. No migration source, application source, user records or permissions were changed. The connection guard rejected nonlocal hosts and `NODE_ENV=production`. No deployment or backend restart was performed.

## Verification

- PASS: `npm --prefix backend run build`.
- PASS: trial application of 018/019 and analytics queries followed by rollback; committed application and repeated read-only verification.
- PASS: diagnostic route responses ADMIN/HR/MANAGER 200, EMPLOYEE 403, cross-tenant 403, ADMIN audit 200; MANAGER financial payload null.
- Diagnostics registered the actual routes in an in-memory Express application with a supplied identity and no-op audit writer. They verify SQL and route permission branches, not session authentication, audit persistence or the running browser application. The wrapper suppressed the route's transaction-setting statement because it used an already-open transaction.
- NOT VERIFIED: backend integration suite. `VITEST_FILTER=test/reports.test.ts npm --prefix backend test` stopped before tests because the disposable PostgreSQL cluster could not start (`pg_ctl: null`). No application test assertion failed.
- NOT VERIFIED: browser reload and live authenticated endpoint.

## Remaining schema drift

021/022 reporting indexes were absent. A trial of 018/019/021/022 failed at 021 with `42501: must be owner of table payroll_slips` and was fully rolled back before the successful 018/019 repair. Do not grant the runtime account extra privileges or rerun already-applied forward migrations blindly. A database owner must inspect remaining constraints/indexes and apply 021/022 through the normal reviewed process. No production database was touched.

Subagents used: none. No source security fix or full release approval is claimed.
