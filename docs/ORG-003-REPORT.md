# ORG-003 — independent organization management

Implemented locally with a dedicated **Đơn vị** menu at `/admin/units`. Read/list, create, edit, archive/delete, restore and select are supported. Archives preserve business data and revoke that organization's sessions. A user cannot archive the organization of their current session.

## Explicit operator decisions

The operator clarified that units are independent companies, selected option 2 (separate system administrator provisions companies and nominates each initial Admin), and explicitly designated `admin@managerhr.test` as the initial system administrator. Company ADMIN is not system authority. Migration 012 grants nobody automatically; the separately executed local designation is audited as `SYSTEM_ADMIN_PROVISIONED`, with a null application actor and an explicit local-operator source.

System administrators see company metadata and may provision/edit/archive/restore. Company Admins edit metadata of organizations where they hold an active ADMIN membership. Selecting a company requires active membership even for system administrators; it does not grant access to employees, departments or attendance by itself. Creation requires an explicitly nominated active verified existing account as initial Admin; no membership is implicitly granted to the creator. To work in a new organization, nominate an account that should actually administer it.

## Changed paths for ORG-003

`.agent-task.json`, `backend/src/app.ts`, `backend/src/units.ts`, `backend/test/units.test.ts`, `database/migrations/012_system_administrators.sql`, `frontend/src/App.tsx`, `frontend/src/DashboardShell.tsx`, `frontend/src/Units.tsx`, `frontend/src/Units.test.tsx`, `frontend/src/api.ts`, `contracts/api.md`, `docs/AUTH-INVITE-DESIGN.md`, this report. Existing ATT-002 working-tree changes were preserved.

## Checks actually run

- `npm test` in backend: PASS, 124 tests, 1 existing browser test skipped. Includes migrations 001–012, existing upgrade/constraint verification and backend coverage on disposable PostgreSQL. An initial test attempt failed because the new enforced-MFA test fixture omitted its encryption key; a temporary CSPRNG key was added to that fixture, and the complete rerun passed.
- `npm run build`, `npm run lint` in backend and frontend: PASS.
- Frontend `npm test -- --run src/Units.test.tsx src/DashboardShell.test.tsx src/App.test.tsx`: PASS, 35 tests. After extending sensitive-action confirmation to units, affected Units/App tests were rerun: PASS, 26 tests.
- Installed Python 3.15 interpreter, `-m unittest discover -s tests`: PASS, 21 tests. The `python` alias is unusable here, so the installed executable was used directly.
- `scripts/policy_check.py`: PASS for local PR comparison from merge-base with `origin/main` to HEAD. Working-tree modified/untracked paths additionally passed the policy's `validate` function. This is local validation, not authoritative remote CI or approval.
- `git diff --check`: PASS.
- Local custom-format `pg_dump` backup created in the user's temporary directory before applying migration 012 and the explicitly authorized designation. Local database retained 3 users, 1 organization and 1 employee. The grant and its audit event were inserted in one transaction after verifying the nominated account was active, email-verified and an active company Admin.
- Backend restarted from the new build. Authenticated UI use with the user's real password/MFA was not performed by the agent.

## Security review and remaining gates

Main-session source review checked trust boundaries, strict request schemas, parameterized SQL, fresh transactional session/role checks, MFA, recent reauthentication, global provisioning authority, denied-action auditing, active membership checks, session revocation, cookie rotation and preservation of absolute expiry. Switching from Employee to Admin creates a restricted MFA session rather than silently granting privileged access; regression tests verify this. Duplicate organization-code constraint errors map to a stable conflict response. The frontend retries sensitive writes only after the existing reauthentication confirmation flow.

No new SAST/dependency scan or browser certification is claimed. No dependency changes, automatic Admin bootstrap, anonymous provisioning, hard deletion, production migration, merge or deployment was performed. Human review and authoritative CI are still required before production release. Additional system-administrator grants/revocations require a separate explicit operator decision; there is no runtime role-grant endpoint.

Delegation: 0, all work performed in the main session.
