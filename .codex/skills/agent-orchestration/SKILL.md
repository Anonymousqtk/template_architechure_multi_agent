---
name: agent-orchestration
description: Use for fullstack multi-agent task decomposition, scope, budget, skill selection or escalation. Do not use for a trivial single-file edit.
---

# agent-orchestration

## Approved references

- `openai-skills` — https://developers.openai.com/plugins/concepts/skills (version: living)
- `openai-skill-evals` — https://developers.openai.com/blog/eval-skills (version: living)
- `nist-ssdf` — https://csrc.nist.gov/pubs/sp/800/218/final (version: 1.1)

## Procedure

1. Read task contract and ownership.
2. Decide whether 0, 1 or 2 subagents are needed; keep tasks disjoint.
3. Select approved skills from policy/skill-routing.json; load only selected SKILL.md.
4. Supply minimal inputs and evidence requirements; never assume a skill was actually invoked.
5. Require verification outputs, record blockers and approval requirements.

## Output contract

Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
