---
name: performance-audit
description: Use only when a reproducible performance regression, slow query, memory issue or profiling evidence exists.
---

# performance-audit

## Approved references
- `postgres` — https://www.postgresql.org/docs/ (version: version-matched)
- `react` — https://react.dev/ (version: version-matched)
- `nextjs` — https://nextjs.org/docs (version: version-matched)

## Procedure
1. Record baseline metrics and reproduction conditions.
2. Identify likely bottleneck from data, not assumptions.
3. Propose smallest measurable improvement and tradeoffs.
4. Benchmark before and after; retain tests and avoid speculative refactors.

## Output contract
Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
