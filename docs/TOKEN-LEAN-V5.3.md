# V5.3 — Strict token-saving operational mode

## Priority order

1. Maintain correct behavior, authentication security and CI gates.
2. Minimize total Codex usage (main + all delegated agents) rather than number of parallel sessions.
3. Prefer deterministic tools instead of AI reviewers for lint, typecheck, tests, dependency audit and SAST.

## Dispatch matrix

| Task                  | Default subagents | Maximum without additional approval |
| --------------------- | ----------------: | ----------------------------------: |
| Trivial/small         |                 0 |                                   0 |
| Medium (single layer) |                 0 |                                   0 |
| Complex/fullstack     |                 0 |     1 only if independently bounded |
| High risk auth/RBAC   |                 0 |    1 if specialist review justified |

Security review is **required as an activity**, not automatically a second AI agent: targeted negative authorization tests, scanner findings and manual/AI review evidence are acceptable only if meaningful and actually performed. Human approval remains mandatory for high-risk merge.

## Runtime and policy limits

- `max_concurrent_threads_per_session = 1` limits simultaneity, not total agent spawns, tokens or ChatGPT quota.
- JSON values are **advisory**. Actual enforcement of per-task usage requires telemetry and an orchestrator.
- With `inherit`, no claimed model tier is physically enforced. Check your Codex model menu and usage before pinning.
- Skill descriptions are discovered but the skill body should be opened only when relevant.
- Avoid repeating the same report in parent/subagent response; subagent replies need changed paths, check outcome and risks only.
- Results of checks may only be reused when code, inputs, dependencies and environment affecting them have not changed.
- Existing AUTH-001 design and implementation must not be replaced by a new scaffold.

## How to check

```sh
python3 scripts/check_token_lean.py
python3 scripts/check_model_policy.py
python3 scripts/check_skill_policy.py
python3 -m unittest discover -s tests
```

## Migration safety

Copy new files carefully. Compare `AGENTS.md`, `.codex/`, `policy/` and workflows with existing tracked changes before replacing. Keep runtime secrets out of source control. Never run migrations automatically without review.
