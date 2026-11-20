# ATT-002 — department attendance

Implemented and running locally. Departments default to SHIFT; Admin/HR can select OFFICE and configure working weekdays, timezone and same-day start/end hours in Attendance → Chấm công theo phòng ban. Employees assigned to an office department check in/out without individual shift assignments. Explicit days off and existing schedules take precedence.

Changed paths: `.agent-task.json`, `backend/src/attendance.ts`, `backend/test/employees.test.ts`, `frontend/src/Attendance.tsx`, `frontend/src/Attendance.test.tsx`, `frontend/src/api.ts`, `database/migrations/011_department_attendance.sql`, `contracts/api.md`, this report.

## Evidence

- `npm test` in backend: PASS, 120 tests, 1 browser test skipped by existing configuration. Runs all migrations on an isolated PostgreSQL cluster, upgrade/constraint checks and Vitest coverage. First attempt failed an incorrect assertion expecting 403 for an out-of-scope employee; changed it to the existing 404 concealment contract. Second attempt passed.
- `npm run build`, `npm run lint` in both applications: PASS. TypeScript is checked during builds.
- `npm test -- --run src/Attendance.test.tsx` in frontend: PASS, 4 tests. An initial run exposed a newly inserted Vietnamese label damaged by the PowerShell stdin encoding; corrected it and reran successfully.
- Python 3.15 executable: `-m unittest discover -s tests`: PASS, 21 tests. `python`/`python3` aliases are unavailable in this environment, so the installed interpreter was used directly.
- `scripts/policy_check.py`: PASS with local PR comparison using merge-base with `origin/main` and HEAD. Its `validate` function also passed for modified and untracked working-tree paths. This is not remote CI or human approval.
- Migration 011 applied to guarded local `127.0.0.1:56423/managerhr` after a successful custom-format `pg_dump` backup in the user's temporary directory. Counts preserved: 3 users, 1 employee, 0 punches. There were no departments to configure automatically.
- Delegation count: 0; implementation and checks handled in the main session.

## Security and operational review

Existing session/MFA, same-origin CSRF, per-organization mutation serialization, recent reauthentication for Admin/HR policy changes and scoped employee access are reused. Punches accept no client timestamp; office punch is self-only and validates the date in department timezone. Correction materialization requires scoped employee access and self/Admin/HR authorization, then retains existing independent review rules. Strict validation checks hours, timezone and weekdays. No auth/RBAC bypass or bootstrap was introduced. This is a source-level review with regression evidence, not a new SAST result.

Recorded office schedules, raw punches and approved corrections are retained. Policy changes snapshot elapsed office days before changing configuration. Office days without a stored snapshot follow the current employee department assignment; replaying historical transfers from employment history is outside this change. Office hours cannot span midnight; use SHIFT for overnight work. Recorded minutes include the in/out interval, without automatic lunch deduction or an office overtime threshold.

No production deployment, production migration, merge or active scan was performed. Human review and authoritative CI remain required before merge/release. The skipped browser test and actual device/browser validation remain outstanding.
