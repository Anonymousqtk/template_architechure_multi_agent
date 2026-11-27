# ManagerHR — agent rules (Codex + Claude Code, token-lean)

Loaded every turn: keep this file short. Details live in `policy/*.json` and `docs/` — open them only when the task needs them.

## Non-negotiable

- Auth is invitation-only: no anonymous registration, no role self-assignment, no automatic admin bootstrap. Auth/RBAC/permission/secret/migration work is **high risk**: needs security controls, negative-authorization tests and human approval to merge.
- No deploy, production change, destructive migration, active scan, model switch, API fallback or third-party skill install without explicit human approval.
- Never claim a check, scan or approval passed without an actual result. Report unexecuted checks as NOT VERIFIED.
- Never fabricate security fixes; schema SQL is a migration proposal, not proof it was applied.
- New user-facing text (including a11y text and errors) goes into the translation system in Vietnamese and English; never translate user data or identifiers.
- Follow root Prettier/EditorConfig and `.prettierignore`.
- `policy/ownership.json` is the source of truth for ownership; enforcement is `scripts/policy_check.py`, CI and human review, not this file.

## Workflow (single agent first)

1. `git status` + `git diff --name-only`. Write a fresh `.agent-task.json` (copy `.agent-task.example.json`; UTF-8 **without BOM**) containing only this task's id, scope, risk and acceptance. Archive the old one in `docs/tasks/` if unfinished.
2. Read only the files you will change and their direct callers/tests. Use search (grep) for symbols instead of reading large files whole; read line ranges.
3. Implement in the main session. Prefer deterministic tools (lint, typecheck, tests, existing scan output) over AI review.
4. Verify with targeted checks only; do not rerun checks on unchanged inputs. Stop after a test fails twice and report root cause.
5. Report briefly: task id, changed paths, commands run with PASS/FAIL/NOT VERIFIED, subagents used and why, open risks, approvals needed.

Auth tasks: read `docs/AUTH-INVITE-DESIGN.md`, `contracts/api.md`, `docs/AUTH-TEST-MATRIX.md` — only the sections relevant to the change.

## Delegation

- Small/medium task: **0 subagents**. Complex or high risk: at most **1** bounded, read-only subagent (e.g. `reviewer` or `security`), only if it saves total work. Ask before more. Never two agents on one file.
- Give a subagent the diff or exact paths and the question, not the whole context; it returns findings only (path:line, severity, fix).
- Ownership when assigned: `frontend/`, `backend/`, `database/`; tests in those dirs or `tests/`. Governance (`AGENTS.md`, `.codex/`, `.claude/`, `policy/`, `scripts/`, `.github/`) is main-agent only and high risk.
- Skills: use at most one, only when the task matches (`.claude/skills/` for Claude, `.codex/skills/` for Codex). Standards in `policy/skill-sources.json` are references, not installs.

## Checks

- Code: `npm run check` (format, lint, typecheck, i18n) or the per-workspace equivalent; targeted `npm test` in `frontend/` or `backend/`.
- Governance/policy changes: `python -m unittest discover -s tests`; in PR context `python scripts/policy_check.py`. CI is authoritative for merge.
- Never paste full logs, dependency trees or whole source files into context; quote failing excerpts with path:line.
