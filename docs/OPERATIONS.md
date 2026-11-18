# Operating procedure

## Prepare a task

1. Copy `.agent-task.example.json` to `.agent-task.json` and complete the ID, changed scope(s), risk and acceptance criteria.
2. Manager approves the work plan. Do not delegate a tiny edit.
3. Assign exactly one owner per source file. Keep reviewer and security advisory.
4. Open a PR; `policy-check` validates declared intent; `required-gate` validates checks.
5. For security-sensitive or governance changes, request human review and use branch protection / CODEOWNERS. The manifest does not itself grant authorization.

## Required GitHub settings

- Protect `main`: require PR before merge; require status check named `required-gate`; restrict direct pushes; dismiss stale approvals if appropriate.
- Require CODEOWNERS review and add actual GitHub usernames/teams to `.github/CODEOWNERS` yourself; don't use placeholder identities.
- Set up Sonar variables and secrets only after creating the Sonar project and validating edition/platform constraints.
- Restrict staging-security environment and define `STAGING_URL` / `STAGING_HOST` for manual ZAP scan.
- Do not put sensitive tokens in `.agent-task.json` or agent context.

## What to watch

- Docs-only change: no app jobs; gate still completes.
- Backend-only change: backend quality, backend SAST; no frontend job.
- CI/security configuration change: full verification + high-risk policy declaration.
- Auth/payment/secret-related path: manifest must declare high risk and security review; human review enforced via GitHub, not AI instructions.
- Database-only: `database/check.sh` currently does only a basic placeholder check; must be replaced with actual migration verification before production.

## Caveats

- An attacker with write access to a PR could modify policy scripts on that same PR. Enforce review of governance files with CODEOWNERS and GitHub branch protection, and consider a reusable centrally controlled workflow for strict guarantees.
- All file boundaries are behavioral unless enforced by external permissions/sandboxes. A file manifest is not proof of agent attribution.
- Deployment not enabled until real stack, infrastructure and environments are known.

## Database fail-closed behavior

A change to `database/` deliberately fails the CI gate until `database/test-migrations.sh` exists and performs actual safe migration verification against a disposable database. This is intentional: a placeholder success would falsely signal production readiness. After connecting the real database stack, add that script and verify schema upgrades, downgrade/rollback where supported, and data preservation.
