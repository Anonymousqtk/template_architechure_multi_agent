# ManagerHR | Agent governance and CI/CD

```mermaid
flowchart TD
  U[Developer request] --> M[Manager: classify + task manifest]
  M --> P{Risk and scope?}
  P -->|Simple| D[Manager edits narrowly]
  P -->|Complex| W[Relevant builder agent: FE / BE / DB]
  P -->|Security-sensitive| S[Security advisory review]
  W --> T[Tester when behavior changes]
  D --> PR[Pull request]
  T --> PR
  S --> PR
  PR --> G[Policy check: changed scopes + risk]
  G --> C[Changed-area CI: lint / test / build]
  C --> A[SAST + dependency audit]
  A --> Q[Required gate]
  Q --> H{Human approval for protected/high risk}
  H -->|Approved + gate passes| MERGE[Merge]
  H -->|Not approved| STOP[Block]
  MERGE --> DEPLOY[Separate reviewed deployment]
```

## Clear division of authority

| Layer                           | What it can guarantee                                 | What it cannot guarantee                                                |
| ------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| AGENTS.md / TOML                | Requests consistent agent behavior                    | OS-level permission enforcement                                         |
| Task manifest + policy_check.py | Declared PR scopes and risk flags match changed paths | Which AI process made the actual edits                                  |
| CI                              | Actual commands and tests ran (if configured)         | Absence of all vulnerabilities                                          |
| Branch Rulesets / CODEOWNERS    | Require reviewers and a passing check                 | Prevent repository admins from changing settings, depending on controls |
| Human reviewer                  | Decide high-risk exceptions and deployments           | Replace automated test evidence                                         |

## State transitions

`REQUESTED → SCOPED → IMPLEMENTED → VERIFIED → REVIEWED → MERGEABLE → DEPLOYED`

No transition to MERGEABLE on a failed/absent required-gate. High-risk tasks also need reviewer approval configured in GitHub Rulesets.

## Context-budget policy

1. Locate via file names, then targeted search; don't load full repo.
2. Pass to a subagent: task ID, scoped paths, 3-5 acceptance criteria, minimal diff, and tool findings summary.
3. Return from agent: paths, actionable findings, exact command/result, blockers. No full file echoes.
4. Reuse scanner and coverage artifacts. Never automatically ask AI to repeat deterministic CI checks.
5. Limit two concurrent subagents; no automatic retry loops.

## V4 model-routing overlay

```mermaid
flowchart TD
    U[Developer task] --> M[Manager / root Codex]
    P[model-routing.json policy] --> V[Static config validator]
    V --> A[7 agent TOML configs]
    M --> D{Delegation necessary?}
    D -->|No| S[One scoped implementation]
    D -->|Yes / max 2| A
    A --> Q[Targeted tools / tests / scan]
    S --> Q
    Q --> G{Quality gate}
    G -->|Fail| F[Fix specific finding]
    G -->|Pass| H[Human review / merge]
    F --> Q
```

Policy JSON is not executed by Codex. Runtime agent settings come from TOML; default profile inherits your signed-in client's model.
