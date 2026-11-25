---
name: api-development
description: Use for backend HTTP APIs, request validation, authorization, and API contract changes.
---

# api-development

## Approved references

- `openapi` — https://spec.openapis.org/oas/ (version: living)
- `owasp-asvs` — https://asvs.owasp.org/ (version: 5.0.0)
- `nist-ssdf` — https://csrc.nist.gov/pubs/sp/800/218/final (version: 1.1)

## Procedure

1. Inspect the affected API contract and existing framework conventions.
2. Specify request/response schema and authorization rules.
3. Avoid trusting client-side validation; apply server-side validation.
4. Implement only affected handlers and tests; document backwards compatibility.

## Output contract

Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
