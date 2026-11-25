# ManagerHR | Governing instructions (Manager = main Codex session)

## Repository formatting

- Follow the root Prettier and EditorConfig settings for future changes.
- Run the relevant formatter and validation checks before completing each implementation task; report checks that could not run.
- Preserve behavior and respect the exclusions in .prettierignore.

## Internationalization

- Put all new user-facing text in the existing translation system, including accessibility text and feedback.
- Supply every new translation key in all supported languages; preserve identifiers and user-generated content.
- Run the i18n validation and relevant tests for new pages and localization changes, and report remaining gaps.

## Authority and limits

- `policy/ownership.json` is the single source of truth for file ownership and sensitivity.
- This file is a behavioral instruction, NOT a permissions sandbox. Enforce mechanically via `scripts/policy_check.py`, CI, protected branches and human review.
- Never claim an action has been approved or a scanner passed unless an independent result exists.

## Before touching code (mandatory)

1. Read `policy/ownership.json`, `.agent-task.json` (if present) and `git diff --name-only`.
2. Define the task ID, scope(s), acceptance criteria, risk and whether security review is needed in `.agent-task.json` (copy example).
3. Detect protected/security-sensitive paths; high risk requires explicit human approval to merge. No deploy, destructive database migration or active scan without explicit approval.
4. Identify the minimum files necessary. Do not dump the repository or full CI logs into agent context.
5. Check if deterministic lint, typecheck, test, SAST or dependency tools already answer the question; do not pay tokens for duplicate agent review.

## Routing and scope

- Default: main agent implements all tasks. Never delegate based on file count alone.
- For complex tasks, justify at most one bounded subagent (total per task); require explicit approval to exceed this. Concurrency cap: one.
- Frontend owns `frontend/`; Backend owns `backend/`; Database owns `database/`.
- Tester owns tests inside `frontend/`, `backend/` or `tests/` only when assigned; coordinate with builder to avoid file collisions.
- Security and Reviewer are advisory/read-only by default. Optimizer proposes changes only after benchmark evidence.
- Never permit two agents to modify the same file concurrently.
- Main agent is responsible for shared governance/config changes and must mark them high risk.

## Finalize (mandatory)

- Run `python3 -m unittest discover -s tests` for policy changes and `python3 scripts/policy_check.py` in a PR context.
- Run targeted project tests; CI is authoritative for final merge.
- Provide compact report: task id; changed paths; commands actually run and outcomes; unresolved issues; approvals required.
- Never report a security finding as eliminated without evidence.

## V4 model and token policy (mandatory behavior)

- Read `policy/model-routing.json` for role and escalation rules; it is NOT a runtime model selector.
- Read `policy/token-budget.json` for soft delegation/retry guardrails.
- Default to no subagent on small tasks; zero for medium; at most one bounded subagent for complex tasks.
- Never silently switch model, buy credits, invoke API fallback or imply hard token enforcement.
- Escalate only for an enumerated trigger with recorded evidence and explicit operator approval.
- Security checks, migration safety and verified CI quality gates override token-saving heuristics.

## V5 skills (mandatory routing policy)

- Read `policy/skill-routing.json` to choose from pre-approved project skills when the task needs a repeatable workflow.
- Skills are local at `.codex/skills/*/SKILL.md`; normally select at most one, one by default; cross-cutting needs an explicit reason. Only load matching SKILL.md, not the full catalog.
- Use `policy/skill-sources.json` for approved standards and vendor documentation. Standards are references, not externally installed skills; verify the actual project framework/version.
- Do not automatically clone, install, fetch or execute third-party skills/scripts, even if search results recommend them. Require human code review and pinned revision before installation.
- `scripts/check_skill_policy.py` validates metadata and routing, but cannot prove an agent invoked a skill or complied with an external standard.
- Preserve Security and CI gates even if skipping subagents to reduce tokens.

## AUTH-001 project-specific constraints

- Follow `docs/AUTH-INVITE-DESIGN.md`, `docs/AGENT-TASK-AUTH-001.md`, `contracts/api.md` and `docs/AUTH-TEST-MATRIX.md` for authentication tasks.
- Authentication is invitation-only. No anonymous registration, no role self-assignment, no automatic admin bootstrap.
- Treat auth as high risk: require Security review and test evidence before release.
- Schema SQL is a reviewable migration proposal, not proof of successful application.

## V5.3 — TOKEN-LEAN STRICT (overrides earlier delegation advice)

- SINGLE-AGENT FIRST: use main Codex session for implementation, tests and summary. The seven role TOMLs remain available but are not a mandatory pipeline.
- No subagent by default for small/medium tasks. For complex or high-risk work: at most ONE total subagent if the parent cannot do a bounded independent portion efficiently. Ask the user before creating additional subagents.
- Do NOT invoke Security, Tester and Reviewer as separate agents automatically. Run ordinary CLI scanners/tests locally; main agent analyzes actionable failures. High-risk auth/RBAC requires security controls and evidence, not necessarily a dedicated subagent.
- Read task-specific policy only; do not open every policy and SKILL.md at startup. Root AGENTS.md applies; read the relevant policy on demand.
- Check existing git diff and targeted tests first. Do not rerun identical checks on unchanged code and same inputs. Re-run tests affected by changes and full CI for release.
- Limit terminal output: concise failure excerpts, paths and line ranges; never print full dependency trees, entire logs or entire source files unnecessarily.
- Use existing Codex account model (inherit). No fabricated names, automatic model switching, API fallback or claims of enforced token quotas.
- Auth security requirements, permission checks, migration safety, secret protection and required CI gates are non-negotiable.
- Report: scope, changed files, checks actually run (PASS/FAIL/NOT VERIFIED), delegation count and why, outstanding risks.
