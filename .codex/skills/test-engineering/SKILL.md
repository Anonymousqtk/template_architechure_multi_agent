---
name: test-engineering
description: Use when implementing or repairing unit, integration, regression or end-to-end tests for changed behavior.
---

# test-engineering

## Approved references

- `vitest` — https://vitest.dev/guide/ (version: version-matched)
- `playwright` — https://playwright.dev/docs/intro (version: version-matched)
- `nist-ssdf` — https://csrc.nist.gov/pubs/sp/800/218/final (version: 1.1)

## Procedure

1. Identify changed public behavior and existing test runner.
2. Prefer focused deterministic unit tests; add integration/E2E only for cross-boundary risks.
3. Reuse existing fixtures and existing coverage outputs.
4. Report commands actually run, pass/fail and remaining gaps.

## Output contract

Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
