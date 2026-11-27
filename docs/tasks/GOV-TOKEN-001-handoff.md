# GOV-TOKEN-001 handoff

Completed local configuration for shared, token-lean Codex and Claude Code rules.

- `CLAUDE.md` imports `AGENTS.md`; four Claude skill wrappers reuse existing Codex skill instructions on demand.
- Optional reviewer/security agents allow only Read, Grep and Glob. The main session supplies a scoped diff and check results. Both inherit the approved session model; choosing a cheaper model still requires human approval.
- Project-anchored Read exclusions cover dependencies, generated/build output, lockfiles, environment files and local data, including sessions started in subdirectories.
- `.claude/` and `CLAUDE.md` require high-risk governance scope and trigger all application CI scopes.
- The prior task manifest is archived as `GOV-TOKEN-001.agent-task.json`; the active manifest describes this continuation only. Existing dashboard/backend work remains outside this task.

Validation: policy unit suite PASS (26 tests), using the installed Python 3.15 executable because WindowsApps `python`/`py` aliases were inaccessible. Formatting and scoped manifest checks are reported in the session handoff.

NOT VERIFIED: live Claude Code configuration loading, actual model cost, runtime file-denial behavior and PR CI. No deployment, model switch, scan or subagent execution was performed. Human approval is required to merge these high-risk governance changes.

Read deny rules are file-tool controls, not an OS sandbox: arbitrary subprocesses in the main session may still read files indirectly. The reviewers have no shell tools. See the official [subagent tool restrictions](https://code.claude.com/docs/en/sub-agents#restrict-which-tools-a-subagent-can-use) and [file permission limits](https://code.claude.com/docs/en/permissions#what-read-and-edit-rules-cover).
