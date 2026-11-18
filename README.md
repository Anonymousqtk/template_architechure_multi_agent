# ManagerHR — V4 Model Routing + Agent Governance

**This package extends V3. No repository code has been deployed or modified on GitHub.**

Start: `docs/ARCHITECTURE.md` → `docs/MODEL-STRATEGY.md` → `docs/OPERATIONS.md`.

1. Copy into a repository carefully; merge existing workflows instead of overwriting.
2. Run `python3 scripts/check_model_policy.py` and `python3 -m unittest discover -s tests`.
3. Default profile is **inherit**: no forced model ID, uses your existing ChatGPT-signed-in Codex client.
4. For explicit per-agent models, verify available IDs in your Codex client, then run `scripts/apply_model_profile.py` with the confirmed names. Example is educational and may not be accessible.
5. CI policy job runs the new static model-policy check. No extra AI or tokens are used by GitHub Actions.
6. Open a PR; enforce `required-gate` once your actual code, test scripts and Github Ruleset are configured.

## Model-specific additions
- `policy/model-routing.json`: routing tiers, escalation triggers, preferred effort
- `policy/token-budget.json`: clearly labeled SOFT guardrails
- `scripts/apply_model_profile.py`: dry-run or explicit apply, no API calls
- `scripts/check_model_policy.py`: static CI gate for routing config drift
- `docs/MODEL-STRATEGY.md`: detailed control plane, safe start, limitations
- `tests/test_model_policy.py`: consistency tests

## Limitations
The V3 application scaffolding is still a template: the ManagerHR repo was empty at prior verification. No application builds, database migrations or deployment tested. A JSON policy cannot impose real runtime token quotas or automatically change a live model. A profile script can only check IDs you confirmed yourself, not entitlements. For hard limits you need an instrumented orchestrator (often API-based and separately billed).


## V5: official-source, skill-aware routing
- 8 project-local skills in `.codex/skills/` (created for ManagerHR using official references; **not** downloaded official or certified Skills).
- Registry: `policy/skill-sources.json`; routing: `policy/skill-routing.json`.
- Offline validation: `python3 scripts/check_skill_policy.py` and `python3 -m unittest discover -s tests`.
- Source review: `docs/SKILL-SOURCES.md`; operation and audit: `docs/SKILL-OPERATIONS.md`.
- Skills are discovered by metadata and their content is loaded only when selected. Routing JSON is policy guidance, not an executable auto-router. No skill download runs automatically.
- V4 model policy, ownership, CI and security controls remain intact.
- **IMPORTANT:** Framework-agnostic starter until actual ManagerHR source is available. Confirm framework versions before using vendor-specific checklists.

## V5.1: Automatic monitoring of official Skill updates
- Weekly read-only metadata monitor: `.github/workflows/skill-updates.yml`
- Allowlist and approved baselines: `policy/upstream-watch.json`
- Local CLI: `python scripts/check_skill_updates.py --output skill-update-report.json`
- Manual review process: `docs/SKILL-UPDATES.md`
- No automatic Skill install, merge, execution or model calls; creates/updates a single GitHub Issue.
