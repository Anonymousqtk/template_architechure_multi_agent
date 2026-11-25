# AUTH-002 report - Governance V5.3

Status: PARTIAL for release; implementation and local verification PASS. Required CI/SAST evidence is outstanding. No production migration/deployment, new dependency, security-policy change or model escalation was performed.

## Completed

- Organization-scoped account list/search/role-status filters/pagination, safe account detail.
- Shared deny-by-default permissions and transactional authorization recheck on management and existing invitation writes; retains AUTH-001 auth/session/CSRF/invite flows.
- ADMIN manages other organization members, HR only EMPLOYEE, MANAGER only self/direct EMPLOYEE reports, EMPLOYEE own profile only. Personal editing permits fullName only.
- Organization lock/unlock, role replacement/revocation to EMPLOYEE, manager assignment with same-tenant constraints and active MANAGER validation. Self role/status mutation is always denied. Organization-wide serialization and actor recheck protect last active Admin under simultaneous cross-demotions.
- Sensitive role/status changes revoke target organization's sessions; unlocking never revives old sessions. Login now locks user then rereads/locks current membership, preventing stale login during lock/reset.
- Audited role/status/manager/profile changes; automatic Manager-report unassignments audited individually; denied management actions audited with safe result/code. Admin-only tenant audit page.
- Responsive Vietnamese /admin/users and /admin/audit, permission-based navigation, account detail actions and profile name editor.

## Agents and skill

Current V5.3 continuation: Manager only, zero subagents. Main skill: approved api-development. Prior to the user's V5.3 steering, Database and Security were each attempted under the earlier V5.1 instructions; both failed account usage limit and produced no usable review/implementation result. No retries, credits, fallback API, or model change. Earlier orchestration skill was loaded for that pre-V5.3 attempt. Final security/correctness analysis is by Manager, not claimed as an independent agent result.

## Verification actually executed

| Check                                                                        | Result                                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before extension: AUTH-001 tests                                             | PASS28 backend and9 UI, reused as baseline                                                                                                                     |
| Final backend npm run typecheck / lint / build                               | PASS                                                                                                                                                           |
| Final backend npm run test:coverage                                          | PASS44 tests (28 original incl primitives +16 RBAC); statements91.53%, branches83.77%, lines97.31%                                                             |
| Frontend npm run typecheck / lint / test:coverage / build                    | PASS16 tests (9 existing +7 RBAC UI); statements/lines92.82%, branches74.24%                                                                                   |
| Disposable PostgreSQL18 upgrade / migration / constraint verification        | PASS;003 preserves seeded AUTH-001 identity/hash/role/status; FK/check and rollback assertions pass                                                            |
| Local development migration003                                               | PASS; explicitly guarded localhost127.0.0.1:56423/managerhr;2 existing users and2 memberships unchanged                                                        |
| Isolated real Chrome UI smoke                                                | PASS real Admin login, scoped users/detail and audit; desktop1440/mobile390; correct Vietnamese and no document overflow; no role/status changes or email send |
| Existing Python unittest discover -s tests                                   | PASS21                                                                                                                                                         |
| Existing check_token_lean.py / check_skill_policy.py / check_model_policy.py | PASS                                                                                                                                                           |
| Existing local changed-path policy validation                                | Reported in final Manager output; not a PR approval                                                                                                            |
| Semgrep / Sonar / authoritative PR CI                                        | NOT RUN / NOT VERIFIED; Semgrep unavailable locally; no trusted CI result or PR BASE_SHA                                                                       |
| Production deployment / migration                                            | NOT RUN                                                                                                                                                        |

One initial AUTH-001 race test failed because it searched pg_stat_activity for the old login SQL. Updated its synchronization condition to the new locked user query; the same behavioral assertion now passes. Repeated only the affected backend suite after this fix, audit correction and upgrade-fixture changes. A CLI validation attempt from repository root failed because package.json is workspace-local; the correctly scoped backend commands passed. No full CI/CD pipeline or duplicate SAST scan was run.

## Security and correctness evidence

RBAC01-16 exercise unknown-role deny, anonymous/CSRF rejection, search escaping, DTO secrecy, HR privileged-target denial, Manager direct-report scope, Employee self-only access/name update and injection denial, cross-tenant list/detail/mutations/audit, lock/login/unlock session invalidation, role update/revocation, tenant-local revocation preserving other-tenant sessions, self changes, simultaneous Admin cross-demotions, stale actor-role/session recheck, valid/invalid manager assignments and scope cleanup, safe audit outcomes, and login queued behind a lock. Existing AUTH-001 reset/login and token races still pass.

Manager review identified and addressed stale invitation authorization (recheck within transaction), stale login membership selection (user then membership locks), and silent report unassignment audit. Removed unnecessary locking of unrelated Admin memberships while holding organization lock to reduce conflicting lock orders. No remaining confirmed Critical/High source finding is known from this review; absence of vulnerabilities is not proven. Automated SAST and authoritative CI remain required release gates.

## Changed AUTH-002 files

- .agent-task.json
- backend/src/app.ts, types.ts, authorization.ts, users.ts, server.ts
- backend/test/auth.test.ts
- database/migrations/003_rbac_user_management.sql, database/verify.sql, database/test-migrations.mjs, database/upgrade-before.sql, database/upgrade-after.sql, database/README.md
- frontend/src/App.tsx, api.ts, Users.tsx, Users.test.tsx, styles.css
- contracts/users.md, docs/AUTH-002-DESIGN.md, docs/AUTH-002-REPORT.md, docs/progress.md

Some AUTH-002 schema/API scaffolding was already present on resumption; it was preserved and completed. Pre-existing user governance/config/CI edits were not authored or reverted by this task. Existing AUTH-001 uncommitted files remain in the workspace.

## Remaining gates and next step

- Review the high-risk migration/API/auth changes, run trusted PR CI including SAST, and obtain human approval before merge or production changes.
- Status/roles are membership-scoped; global identity deactivation and organization-settings administration are not exposed. Manager scope is direct EMPLOYEE reports, not a recursive organization tree. Role grants are one effective role per membership.
- AUTH-001 operational limitations still apply: reset email queue is ephemeral; production HTTPS/proxy/log-redaction and monitoring require deployment verification. SMTP credentials remain in ignored local .env and were not printed or modified by AUTH-002. No mail was sent for this task.
- Current local preview is running at http://localhost:3000/admin/users. Existing test Admin credentials remain valid; no credentials are stored in tracked report/source.
