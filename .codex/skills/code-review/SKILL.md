---
name: code-review
description: Use for nontrivial code review of correctness, maintainability, design or SonarQube findings; not trivial formatting changes.
---

# code-review

## Approved references

- `sonar` — https://docs.sonarsource.com/sonarqube-server/ (version: version-matched)
- `nist-ssdf` — https://csrc.nist.gov/pubs/sp/800/218/final (version: 1.1)

## Procedure

1. Start from diff and existing deterministic scan output.
2. Prioritize actual bugs, concurrency, error paths and contract issues; avoid lint repetition.
3. Report actionable evidence with file and line; use concise comments.
4. Read-only unless separate edit approval is given.

## Output contract

Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
