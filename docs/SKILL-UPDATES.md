# Skill update governance: detect, review, promote

**Scope:** Official upstream metadata, not executable updates. A new release does NOT mean its content should immediately become the local Skill.

## Workflow

1. Every Monday 11:23 Asia/Bangkok, `.github/workflows/skill-updates.yml` queries the official GitHub API (read-only).
2. It emits an artifact and opens/updates one review issue when tracked versions differ or have no approved baseline.
3. Maintainer inspects release notes, publisher, source diff, scripts, licensing, version compatibility and security implications.
4. Create a **human-reviewed PR** to update local `.codex/skills`, `policy/skill-sources.json`, `policy/upstream-watch.json` (`approved_ref`) and relevant routing/docs.
5. CI validates policy and tests. Merge only with human approval and branch protections.
6. No untrusted downloaded script or upstream Skill is automatically executed. Review source instructions for prompt injection, data exfiltration and overly broad filesystem/tool access.

## Important distinctions

- `openai/skills` HEAD changes frequently. Track a pinned SHA as **reviewed baseline**; do NOT auto-follow HEAD into production.
- OWASP/NIST/W3C publications are standards, not Codex Skill packages. Local `SKILL.md` translates approved requirements into procedure. Update only after gap analysis.
- Frameworks and scanners must match project dependency versions; the newest upstream release may be incompatible.
- `approved_ref: null` signifies first-run baseline needed. Do not automatically approve today's HEAD.
- GitHub Actions cron can be delayed, and scheduled workflows may be disabled on inactive repositories. This is weekly polling, not guaranteed instant notification.
- This workflow uses GitHub issue write permission; repository settings must permit creation and workflows must be enabled. GitHub repository may be empty until your code is pushed.
- To inspect a local report: `python scripts/check_skill_updates.py --output skill-update-report.json` (network required).
- Test static validators: `python scripts/check_skill_policy.py` and `python -m unittest discover -s tests`.
- **Token cost:** workflow uses no ChatGPT or API model tokens; GitHub Actions minutes and rate limits still apply.
