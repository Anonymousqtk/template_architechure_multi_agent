# AUTH-001 Agent execution plan (sequential gates)

**Precondition:** Repository currently has no application code. The local V5.1 governance package is the foundation, NOT a running website.

1. Manager (main session): inspect actual tree, existing framework, policies, compatible Skills; no external Skill installs. Write `.agent-task.json`, set `risk=high`, `security_review_required=true`, scopes `frontend,backend,database`, obtain approval for any protected-policy changes and any bootstrap/deploy step. Read only relevant Skills (up to two per subtask).
2. Database: review `database/migrations/001_auth_invitation_schema.sql` as a proposal, adapt to chosen ORM, write migration/test. Must not execute against production.
3. Backend: implement endpoints in `contracts/api.md` with atomic token consumption, session security, authorization, rate limiting, email adapter and audit events.
4. Frontend: build login, invitation acceptance, forgot/reset and admin invitation UI; no public generic registration.
5. Tester: add cases from `docs/AUTH-TEST-MATRIX.md`; avoid editing production source concurrently with other agents.
6. Security: read-only adversarial review of diff + scan findings (OWASP ASVS, Authentication, Forgot Password, Session). Manager routes defects to owning writer. Reviewer: business logic and maintainability without duplicating Security. Optimizer only with profiling evidence.
7. Manager: run one targeted test suite per workspace, collect results once, update task status; CI as final gate. Report PASS/FAIL/NOT VERIFIED with evidence, not promises.

Max two subagents at once, only if editing non-overlapping files. For strict dependencies prefer DB → Backend → Frontend → Tester → Security/Review. Token budget is soft guidance, not an actual enforcement mechanism.
