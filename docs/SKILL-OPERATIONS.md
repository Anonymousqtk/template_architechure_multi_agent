# Skill operations and evidence

## Trigger

1. Manager reads task contract + ownership policy and classifies task.
2. Inspect `policy/skill-routing.json`; select 0-2 relevant skills based on scope/risk, avoiding a skill for trivial edits.
3. Use local `.codex/skills/<skill>/SKILL.md` only for selected workflows.
4. Manager routes to exactly the required subagent(s); skill selection does not itself create a subagent.
5. Reuse existing CI evidence. Do not rerun scanner/test without reason.
6. Record _observed_ usage only when runtime trace/chat evidence exists; otherwise state `not_verified`.

## Minimal audit (human or workflow logs)

- Task ID, agent role, selected skill, SKILL.md revision/hash, reason for trigger
- Runtime evidence (if available); otherwise `not_verified`
- Real commands run and result; tests/quality gate status; approvals

A static validator proves only metadata and references are configured, NOT that Codex used the Skill or complied with security standards.

## Commands

```bash
python3 scripts/check_skill_policy.py
python3 -m unittest discover -s tests
```

## Daily Manager prompt

"Implement <task>. Follow AGENTS.md, policy/ownership.json and policy/skill-routing.json. Select only necessary approved local skills and show which were actually loaded. No external skill installations, no repeated tests, no unverified claims. Reuse existing CI output; report paths, commands, evidence and risks briefly."
