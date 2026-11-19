# ORG-001-FIX-UI

## Data loading investigation

The users list in `backend/src/users.ts` reads `memberships.department_id`,
`memberships.position_id`, `departments` and `positions`. These are introduced by
migration 005. A database still at AUTH-004 can therefore authenticate successfully
but fail both the users screen and dashboard counters. This is a source-level
failure scenario, not a confirmed diagnosis of the operator's running database.

On the affected database, an authorized operator can run this read-only check:

```sql
SELECT to_regclass('public.departments') AS departments,
       to_regclass('public.positions') AS positions;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'memberships'
  AND column_name IN ('department_id', 'position_id');
```

If tables or columns are missing, review migration 005, verify the target database
and backup, and apply through the approved migration process before restarting
the matching backend build. Do not automatically migrate on a user request.
If the schema is present, inspect the actual failing HTTP response and database
availability; do not assume this scenario explains every internal error.

Schema errors now return HTTP 503 / SERVICE_NOT_READY; recognized database and
connection outages return SERVICE_UNAVAILABLE. Unexpected failures remain 500.
Responses contain no SQL, connection strings or raw provider messages. Existing
authentication, tenant scoping and authorization handlers are preserved.

## UI decisions

- Serve Roboto locally with its OFL license and `font-display: swap`; this works
  with the existing self-only stylesheet policy, without external font requests.
- Show the page title and organization context; consistent card boundaries,
  tabular numerals, keyboard focus and reduced-motion support improve scanning.
- List affected datasets in expandable error details; preserve successful
  datasets and retry only failed requests. Never replace unavailable counts with zero.
- Keep the alert and retry action usable on narrow screens.

Roboto source: https://github.com/google/fonts/tree/main/ofl/roboto
Font loading reference: https://developers.google.com/fonts/docs/css2

## Follow-up: configured development database

Read-only checks against the database in `backend/.env` confirmed both ORG tables
and all five new columns were missing. The configured host was 127.0.0.1 with
NODE_ENV not production and APP_ORIGIN http://localhost:3000.

Migration 005 was first executed with ROLLBACK on this database, then applied
transactionally with 3-second lock and 20-second statement timeouts. In-transaction
fingerprints verified preservation of every existing users row, memberships row
(excluding the new nullable columns), and organization row (excluding new columns)
before commit. The migration committed successfully; read-only department,
position and chart schema queries subsequently passed.

All three organization screens now offer retry actions. Department/position load
errors no longer also show a misleading empty-list message or zero total.
Eight organization UI tests passed, including recovery after failures on each screen.

The local root page returned HTTP 200; the unauthenticated profile endpoint returned
401. Authenticated browser rendering and final release security review remain
unverified. No production migration or deployment was performed.

## Chart response contract repair

The chart had a separate rendering bug after schema repair: the backend returns
`departmentTree`, top-level totals and a nested `manager` object; the frontend
incorrectly expected `tree`, `stats`, flat manager fields and per-node `positions`.
Reading `stats.totalDepartments` caused a runtime exception even for a successful
HTTP response. The frontend types and rendering now follow the existing backend
response, including manager information, without changing the endpoint.

The organization UI fixture now uses the actual wire structure and is checked
against `OrgChartData`. Regression tests cover populated and empty responses,
manager rendering and expand/collapse. Earlier mocked UI tests used the same
incorrect response assumptions as the frontend, so they missed this mismatch.
