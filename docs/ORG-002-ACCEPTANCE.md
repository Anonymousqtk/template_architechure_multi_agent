# ORG-002 — Hierarchy and management scope

Status: DEVELOPMENT COMPLETE — final hosted CI and human merge approval are separate.

## Baseline classification

| Area | ORG-001 baseline | ORG-002 treatment |
| --- | --- | --- |
| Tenant organization, departments, positions | VERIFIED by prior ORG integration suite | Reuse tables and routes |
| API self-parent/cycle checks, dependency deletion guards | VERIFIED | Preserve; add database enforcement |
| Direct reporting and role distinction | VERIFIED | Reuse manager assignment; extend read scope to descendants |
| Chart response integration, empty/retry/collapse | VERIFIED by 10 UI tests before ORG-002 | Preserve response and component |
| Manager department/position/chart scope | MISSING; reads were tenant-wide | Shared recursive scope with list/detail checks |
| Indirect Manager user scope | MISSING; only direct reports were visible | Recursive reporting plus assigned department members |
| Organization parent relationship | DEFECTIVE; allowed linking separate tenant records | Reject non-null tenant parents; branches use existing departments |
| Database tenant consistency for department/position references | DEFECTIVE; UUID-only foreign keys accepted cross-tenant links | Composite foreign keys in migration 006 |
| Database indirect cycles | MISSING | Validate legacy data and add cycle triggers |
| Inactive handling and position moves | EXISTS_UNVERIFIED | Explicit guards and new integration cases |

## Implementation

`backend/src/management-scope.ts` derives Manager scope in two bounded recursive
queries using UNION to terminate even with legacy cycles. It uses membership
roles and explicit management relationships, never position names. Read scope
is enforced in `organization-structure.ts` and `users.ts`, including totals,
search and object endpoints. The chart filters memberships before returning data;
HR and Employee cannot read privileged membership details through the chart.
Parent IDs/names outside a Manager's department scope are redacted.

Existing `authorizeMutation` serializes API relationship mutations on the tenant
row. Migration triggers use the same tenant lock for direct SQL writes. Tests
race opposite department moves and opposite reporting assignments and require
exactly one success. Department deactivation cannot leave active dependants;
inactive leaders cannot be newly assigned. Position moves cannot invalidate
existing assignments. Existing list/detail/assignment endpoints are reused.

## Migration and restore plan

Migration `006_org_integrity.sql` is a forward, transactional proposal. It creates
no parallel hierarchy tables and removes no business data. It adds composite
tenant foreign keys, normalized code indexes, a tenant-parent constraint, and
department/reporting cycle guards. Existing cross-tenant links, duplicate normalized
codes, organization parents or cycles cause the migration to fail and roll back.
An operator must review and repair those records; migration never guesses ownership
or silently clears relationships. A dedicated upgrade test exercises invalid
legacy tenant links and cycles, rollback preservation, repair and successful retry.

The migration takes DDL locks (5-second lock timeout); deployment requires reviewed
backup/restore and migration ordering. Before commit, PostgreSQL rolls back failed
DDL; after release, restore an approved backup or ship a reviewed forward repair.
No destructive down migration is provided. On completion follow-up, migration 006
was dry-run with ROLLBACK and then committed to the configured 127.0.0.1 development
database. Fingerprints of users, memberships, organizations, departments and positions
were unchanged before/after. All five tenant constraints and all four guard triggers
were verified. No production database was changed.

## Checks and security review

New tests supplement rather than
duplicate ORG-001 coverage: recursive grants/revocation after moves, out-of-scope
objects, title/role separation, disabled units/leaders, HR/Employee chart redaction,
database cross-tenant references and cycles, concurrent updates, legacy upgrade.

| Command/check actually run | Result |
| --- | --- |
| `npm --prefix backend test` with `ORG_BROWSER_PATH` configured (final run) | PASS: 102 tests in 6 files, including authenticated Edge integration and MFA regression; migrations 001–006 and PostgreSQL constraints passed |
| Legacy-data upgrade test | PASS: cross-tenant and cyclic data rejected; rollback preserves rows; repaired fixture upgrades successfully |
| `npm --prefix backend run typecheck`, `run lint`, `run build` | PASS |
| `npm --prefix frontend run test -- --reporter=dot` | PASS: 80 tests; after the final mobile fix, 19 affected UI tests also passed |
| `npm --prefix frontend run typecheck`, `run lint` | PASS |
| `npm --prefix backend audit --omit=dev --audit-level=high` | PASS: 0 reported vulnerabilities in production dependencies |
| `python3 -m unittest discover -s tests` | PASS: 21 policy tests |
| `python3 scripts/check_skill_policy.py` | PASS: offline metadata validation |
| Existing policy validator against changed/untracked working-tree paths | PASS: local scope validation; not a PR check |
| `python3 scripts/policy_check.py` | NOT VERIFIED in PR context: BASE_SHA unavailable |
| `git diff --check` | PASS |
| Semgrep 1.144.0, `p/owasp-top-ten`, backend + frontend, metrics off | PASS after MFA tag-length repair: exit 0, no findings |
| Hosted CI/Sonar, independent release approval | NOT VERIFIED: local checks do not imply hosted CI or human merge approval |

An intermediate test run had 93 passing tests and one upgrade test hitting Vitest's
default 5-second timeout. Only that database-creation/migration test received a
30-second timeout; the final run passed all 94 tests. No assertion was removed.

Source review boundaries: session identity -> organization boundary -> role and
relationship scope -> object filtering -> response. The confirmed high-risk
tenant-wide Manager data exposure and UUID-only tenant references have targeted
regression tests. Security release approval and CI remain required; no scanner
result or independent human security approval is implied by this document.

## EMP-001 dependency and limits

Scopes use existing account memberships, not a new Employee profile model.
Employment dates, employee lifecycle, matrix reporting and cross-tenant enterprise
groups are outside scope and require EMP-001 or a separately reviewed model.
The company/branch/department/team hierarchy is represented by the existing
department tree within a tenant. Directory information remains distinct from
membership personal data; the precise visibility policy is in `contracts/api.md`.

Production dataset upgrade and hosted CI results are not verified locally.
ORG-002 preserves the existing frontend component
and response structure; a new UI test exercises a 16-level hierarchy and descendant
collapse/re-expansion. Other ORG-001 UI regression tests run with that same fixture
contract. New code files: management-scope.ts and 006_org_integrity.sql. Updated:
organization-structure.ts, users.ts, org.test.ts, OrganizationView.test.tsx,
contracts/api.md, .agent-task.json and this acceptance report.

Execution used one main agent, zero subagents; skills: api-development,
security-review, database-migrations, test-engineering and frontend-standards. Multiple skills were
needed because the change crosses permission enforcement, schema integrity and
integration testing. Final merge/release requires human approval for high-risk
authorization, migration and protected-contract changes.

References: [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html),
[PostgreSQL 18 constraints](https://www.postgresql.org/docs/18/ddl-constraints.html),
[ASVS](https://asvs.owasp.org/).

## Completion follow-up evidence

The Manager sidebar now exposes its authorized chart, departments and positions;
mutation controls remain unavailable. Visual inspection found a clipped mobile
subtitle, repaired with wrapping styles on the organization view. A real headless
Edge integration logs into an Express app with disposable Admin/Manager accounts
on temporary PostgreSQL, renders the production frontend build and checks chart
scope, expand/collapse, Roboto, mobile overflow and scoped listing screens. It uses
test-only `requireMfa:false`; runtime MFA policy is unchanged, with MFA still covered
by the existing AUTH regression suite. This is not a claim of MFA-enabled browser
verification against a real user's account.

Browser artifacts use synthetic data:
[desktop](evidence/org-002/manager-desktop.png),
[mobile](evidence/org-002/manager-mobile.png).

To repeat on Windows PowerShell: build the frontend, set `ORG_BROWSER_PATH` to the
installed Edge/Chrome executable, optionally set `ORG_BROWSER_EVIDENCE` to an output
directory, then run `npm --prefix backend test`. `ORG_BROWSER_ONLY=true` selects only
the browser test while retaining disposable database setup/teardown. Without a
browser path this platform-dependent test skips; API/security tests still run.
No dependency was added. New test files: `org-browser.test.ts`,
`org-browser-driver.mjs` and `mfa-crypto.test.ts`; Vitest config adds the optional
browser-only selection. Navigation and wrapping updates are in DashboardShell and
OrganizationView/org.css, with navigation regression coverage.

Semgrep first reported `gcm-no-tag-length` in `backend/src/mfa-crypto.ts`. Six tests
reproduced acceptance of truncated GCM tags (4, 8, 12–15 bytes). Both encryption and
decryption now explicitly require 16 bytes, preserving compatibility with existing
generated ciphertext. Regression covers round-trip, owner binding and rejection
of truncated tags. The same scanner then exited 0 without findings. This evidence
addresses that finding and does not prove absence of every security risk.
Scanner image digest:
`sha256:10301f060aacf84078f9704fb1ba3a321df4ac46b009fd29c1c66880d1db8e77`.

The local development server was restarted only after verifying its listening
port, Node server process and exact workspace frontend build. Root HTTP 200 and
anonymous `/api/auth/me` HTTP 401 were confirmed. No production deployment,
automatic merge or approval claim was made. Hosted CI runs on PRs targeting main
or workflow_dispatch; publishing changes/triggering that remote workflow and
human merge approval remain the release handoff.
