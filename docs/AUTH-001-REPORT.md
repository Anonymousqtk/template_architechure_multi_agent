# AUTH-001 implementation and verification report

Task: AUTH-001. Risk: HIGH. Status: IMPLEMENTED / LOCAL VERIFICATION PASSED; release definition of done remains incomplete until staging SMTP and required CI pass. No merge, production migration, Admin bootstrap, active scan or deployment was performed.

## Implemented

PostgreSQL schema, Express/TypeScript API and React/TypeScript same-origin UI implement login/logout, invitation-only new-user registration, matching verified existing-account invitation acceptance, forgot/reset password and organization-scoped HR/Admin invitation create/list/revoke/resend. There is no public registration or bootstrap API. ADMIN can grant HR; HR can grant EMPLOYEE; invitation UI/API cannot grant ADMIN.

Passwords use Argon2id; bearer secrets are CSPRNG-generated and stored only as SHA-256 digests. Transactions serialize invitation/reset consumption and login versus reset. Sessions enforce active user, organization and membership on every API request. Cookie, Origin/CSRF, throttling, no-referrer, no-store and audit controls are implemented.

## Agents, skills and model

Manager coordinated Database, Backend, Frontend, Test Engineer, Security Agent and Code Reviewer; at most two subagents ran concurrently, with separate file ownership. Optimizer was not invoked. Every agent inherited the session model; no escalation, API fallback or paid model selection occurred. Sequential stage/subtask skills: agent-orchestration; database-migrations; api-development + security-review; frontend-standards; test-engineering; security-review; code-review. All came from the approved local catalog; no external skills were installed.

## Actual command evidence

| Check                          | Commands actually executed                                                                                                     | Final result                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| PostgreSQL migrations          | `node database/test-migrations.mjs`; final backend test command also applied migrations on a fresh cluster                     | PASS on disposable PostgreSQL 18; constraints and rollback verified                         |
| Backend validation             | `npm run typecheck`, `npm run lint`, `npm run build` in backend                                                                | PASS after fixing unused middleware parameter and TypeScript rootDir                        |
| Backend unit/integration       | `npm run test:coverage` in backend (disposable database runner)                                                                | PASS: 28 tests; statements 90.55%, branches 81.14%, lines 96.27%                            |
| Frontend validation            | `npm run lint`, `npm run typecheck`, `npm run build` in frontend                                                               | PASS, including after test additions                                                        |
| Frontend UI                    | `npm run test:coverage` in frontend                                                                                            | PASS: 9 tests; statements/lines 90.8%, branches 79.85%                                      |
| Dependency audit               | `npm audit --audit-level=high --omit=dev` in each workspace                                                                    | PASS: 0 vulnerabilities reported by both production audits; dev dependencies excluded       |
| Governance unit tests          | Actual Python runtime with `-m unittest discover -s tests`                                                                     | PASS: 20 tests                                                                              |
| Model/skill policy             | Actual Python runtime with `scripts/check_model_policy.py` and `scripts/check_skill_policy.py`                                 | PASS (offline metadata/config checks)                                                       |
| Local changed-path policy      | Import existing `policy_check.validate` against tracked changes and untracked files plus task manifest                         | PASS; not a PR/human approval claim                                                         |
| Built-server smoke             | Spawned `node backend/dist/server.js`, fetched login HTML, JS bundle and CSRF endpoint, checked no-referrer; stopped own child | PASS; no database fixture or browser involved                                               |
| Whitespace/syntax              | `git diff --check`; `node --check` for migration/test runners                                                                  | PASS at execution time                                                                      |
| PR-context policy              | `python3 scripts/policy_check.py`, then actual Python runtime                                                                  | NOT VERIFIED: Python alias inaccessible initially; actual runtime requires missing BASE_SHA |
| SAST                           | `semgrep --version`                                                                                                            | NOT VERIFIED: binary unavailable; configured CI scan not executed locally                   |
| Staging / browser / deployment | No staging SMTP, browser E2E or production commands executed                                                                   | NOT VERIFIED                                                                                |

Python alias commands initially failed; the usable runtime was `C:/Users/Tu Thao/AppData/Local/Python/pythoncore-3.15-64/python.exe`. Windows sandbox PostgreSQL startup also failed initially; disposable tests passed with reviewed local execution outside that restriction. Initial native argon2 dependency build failed; final implementation uses installed @node-rs/argon2 and its real Argon2id tests pass. Initial lint/build failures were fixed before the final successful runs. No remaining executed application-test failure is open.

Detailed AUTH-01�22 evidence and limitations: [test report](AUTH-001-TEST-RESULTS.md).

## Independent advisory reviews

Security identified login/reset race, reset SMTP timing signal and globally shared validation throttle; code fixes and regression tests passed. Reviewer identified multi-tab CSRF invalidation and stale resend delivery status; source fixes were independently reread and both regression tests passed. Final security source review reported no new concrete HIGH/CRITICAL code blocker; this is not proof of absence of vulnerabilities or approval to merge. No duplicate scans or full CI pipeline were run.

## Changed paths

- `.agent-task.json`, `README.md`, `docs/progress.md`, `docs/AUTH-LOCAL-SETUP.md`, `docs/AUTH-001-TEST-RESULTS.md`, this report.
- `database/migrations/002_auth_controls.sql`, `database/test-migrations.mjs`, `database/test-migrations.sh`, `database/verify.sql`, `database/README.md`, `database/.gitignore`.
- `backend/src/{app,bootstrap,config,mail,security,server}.ts`, `backend/test/{auth,security}.test.ts`, `backend/test-runner.mjs`, package/lock files, TypeScript/ESLint/Vitest configs, environment example, README and ignore file.
- `frontend/src/{App.tsx,App.test.tsx,api.ts,main.tsx,styles.css}`, `frontend/index.html`, package/lock files, TypeScript/ESLint/Vite/Vitest configs and README.

The existing initial SQL proposal, API contract, protected policy/scripts and CI workflows were not changed. The new database shell entrypoint is staged solely to record executable mode 100755 for the existing CI check; no commit was made.

## Remaining risks and approvals

- Reset mail uses a bounded in-memory queue: restart may lose delivery. Durable encrypted delivery/retry design needs review before production. SMTP transport itself is not staging-verified. DEV_ONLY explicitly means no mail sent.
- Required Semgrep/PR CI and real-browser end-to-end/assistive-technology verification remain unverified. Application log tests do not prove proxy logs redact token URLs; deployment must enforce this. Timing tests do not prove complete response-time indistinguishability.
- Proxy/IP throttling, HTTPS/cookie behavior on actual infrastructure, secret management, monitoring, rate-limit retention and runtime database privileges need deployment verification. Default runtime binds localhost and ignores untrusted forwarded IP headers.
- Migration 002 targets a new installation with no existing sessions; an existing installation requires reviewed backfill and migration ledger. Backups/restore and production migration execution require separate approval.
- Human review and successful required CI gate are required before merging this high-risk authentication change. First Admin provisioning and deployment each require explicit authorization. None were executed.

See [local setup](AUTH-LOCAL-SETUP.md), [backend operation](../backend/README.md), and [database verification](../database/README.md).

## Follow-up AUTH-001-UI-002 (2026-11-18)

User requested a UI refresh, Vietnamese repair and local test account. Approved frontend-standards skill and inherited Frontend agent were used. Changed frontend/src/App.tsx, frontend/src/styles.css and frontend/index.html. Fixed legacy/corrupted HTML title encoding; redesigned navy/indigo interface with Vietnamese-compatible Segoe UI/Arial sans fonts, 16px controls and responsive layouts.

PASS: frontend lint/typecheck/build and 9 UI tests (statement coverage 91.01%); source/built UTF-8 checks. Isolated Chrome checked desktop1440 and mobile390: no horizontal document overflow, correct Vietnamese title and rendered text. Real browser login reached /app, then /admin/invitations, with EMPLOYEE/HR role options; mobile admin layout also passed overflow checks. Screenshots were inspected; this is a focused browser smoke check, not full accessibility certification.

At the user's explicit request, the existing audited bootstrap CLI provisioned admin@managerhr.test with ADMIN membership in ManagerHR Demo, strictly on the previously created localhost development PostgreSQL cluster. Verified one ADMIN_BOOTSTRAP event; real login and organization invitations APIs returned200. No credentials were put in tracked source or this report; the temporary password input file was removed. No production changes. Earlier statements that bootstrap was not executed describe the original task, before this authorized follow-up.

Local preview remains http://localhost:3000/login. Mail remains DEV_ONLY. Production/SAST/SMTP staging approval and verification gates from the original report remain unchanged.
