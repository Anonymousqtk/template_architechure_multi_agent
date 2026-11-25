# ManagerHR V4 — Model strategy (strictly scoped, cost-aware)

## Authoritative policy

`policy/model-routing.json` is the **policy source of truth** for tiers, preferred efforts and escalation. Runtime Codex reads `.codex/config.toml` and `.codex/agents/*.toml`, **not** this JSON. `scripts/apply_model_profile.py` translates policy into TOML, while `scripts/check_model_policy.py` validates drift.

## Default and profiles

- **inherit** (default): no explicit model or effort in agent TOML; Codex inherits the model and effort currently selected in your signed-in client. This is the only safe default without checking account entitlements.
- **example**: economy `gpt-6-luna`, balanced/deep `gpt-6.1-sol`. **Do not apply blindly.** Verify names, client availability, entitlement and supported effort first. This is an illustrative profile, not a claim that those IDs work in your subscription.
- Manager is root Codex session; model choice remains in the signed-in UI/session, not in a subagent file. Make its selection deliberately.

## Agent routing

| Agent     | Tier     | Preferred effort | Why                                                                  |
| --------- | -------- | ---------------- | -------------------------------------------------------------------- |
| Frontend  | economy  | low              | Scoped UI edits                                                      |
| Backend   | balanced | medium           | Service logic and data boundaries                                    |
| Database  | balanced | medium           | Migration risk                                                       |
| Security  | balanced | medium           | Analyze scanner evidence; use deep only for substantiated high risks |
| Reviewer  | economy  | low              | Diff-only, findings-first                                            |
| Optimizer | economy  | low              | Only after benchmarks                                                |
| Tester    | economy  | low              | Targeted test work                                                   |

## Escalation: controlled, not magic

One escalation maximum per task, only after a documented trigger, human approval, and a verified stronger model. The included scripts **do not** change model mid-session. Reconfigure an agent and start a new session (or explicit spawn) if supported. Log escalation in the task record.

## Budget semantics

`policy/token-budget.json` defines **soft guardrails** (delegations, retries, context file counts), NOT metered token caps. ChatGPT-plan usage limits are separate from API billing. No hidden API requests, credential handling or paid fallback.

## Use the profile tool

```bash
python3 scripts/check_model_policy.py
python3 scripts/apply_model_profile.py --profile inherit --apply
# Only after confirming exact IDs in your Codex client:
python3 scripts/apply_model_profile.py --profile example --available-models gpt-6-luna,gpt-6.1-sol --apply
python3 scripts/check_model_policy.py
```

## Token-saving operational rules

1. Prefer zero subagents for small tasks; max one for medium, two for cross-layer complex tasks.
2. Check deterministic tooling before AI review. Do not resend all source, scanner logs, or entire conversation.
3. Keep context under the task-category file-count guideline; exceptions require a reason.
4. Retry only for a concrete failure; a repeated failed test triggers a review of root cause, not infinite retries.
5. Security approval gates and real quality validation take precedence over cost savings.

## Verification limits

Static policy scripts verify files **not** effective model, live quota, token count, or actual agent behavior. Check the selected model in your Codex client and monitor usage in official usage UI. A true hard token limiter requires an instrumented orchestrator with authoritative metering; it is not provided here.
