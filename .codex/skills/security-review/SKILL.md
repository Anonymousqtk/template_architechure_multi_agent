---
name: security-review
description: Use for authentication, authorization, personal data, secrets, unsafe input, threat modeling or confirmed scanner findings.
---

# security-review

## Approved references
- `owasp-asvs` — https://asvs.owasp.org/ (version: 5.0.0)
- `owasp-top10` — https://top10.owasp.org/ (version: 2025)
- `nist-ssdf` — https://csrc.nist.gov/pubs/sp/800/218/final (version: 1.1)
- `semgrep` — https://semgrep.dev/docs/ (version: version-matched)
- `zap` — https://www.zaproxy.org/docs/ (version: version-matched)

## Procedure
1. Establish threat boundary and affected code/data paths.
2. Map requirements to ASVS 5.0.0 where applicable; do not rely only on Top 10.
3. Use Semgrep/dependency/ZAP results if already available; do not rerun scans by default.
4. Provide severity, evidence, affected path and recommended mitigation; state unverified findings.
5. Remain read-only and never run intrusive scans without permission.

## Output contract
Give changed paths or findings, evidence, commands actually executed, result, risk and next action. Keep it short. No fabricated test results.
