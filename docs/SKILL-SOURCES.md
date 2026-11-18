# Source-of-truth & trust model (reviewed 2026-11-18)

**Standards are not the same as ready-made agent Skills.** ManagerHR Skills are concise, project-owned workflow wrappers pointing to authoritative sources. No certificate, official endorsement or automatic compliance is implied.

| Domain | Primary authority | Source ID | Version policy |
|---|---|---|---|
| Codex Skill structure | OpenAI Developer Docs | openai-skills | living documentation |
| Skill discovery evaluation | OpenAI | openai-skill-evals | living documentation |
| Secure development lifecycle | NIST SP 800-218 SSDF | nist-ssdf | v1.1 final; do not treat 1.2 draft as final |
| App security verification | OWASP ASVS | owasp-asvs | 5.0.0 stable |
| Top risk awareness | OWASP Top 10 | owasp-top10 | 2025; not a replacement for ASVS |
| HTTP API contract | OpenAPI Initiative | openapi | match framework/project |
| Accessibility | W3C WCAG | wcag | 2.2 recommendation |
| Frontend framework | React, Next.js, TypeScript maintainers | react, nextjs, typescript | match installed versions |
| Data & migrations | PostgreSQL official docs | postgres | match server major version |
| QA & security tools | Vitest, Playwright, SonarSource, Semgrep, OWASP ZAP | vendor references | match installed versions |
| CI protection | GitHub Actions docs | github-actions | pin third-party actions by full SHA when verified |

## Source evaluation checklist
1. Is it a standards body or publisher/vendor official domain? If not, require explicit approval.
2. Is the version published and stable? Do not silently upgrade pinned standards.
3. Is the content instructional only, or does it execute code/network? Never execute unreviewed code.
4. Is there a framework/version mismatch with ManagerHR? Prefer installed-version docs.
5. Record source, version, reviewed date and reviewed PR. Do not silently update.

See `policy/skill-sources.json` for full URLs. Add sources only via code review. For optional external skill discovery, inspect OpenAI's current Plugins catalog; older `openai/skills` GitHub repository redirects readers to newer examples. Never auto-install from search results.
