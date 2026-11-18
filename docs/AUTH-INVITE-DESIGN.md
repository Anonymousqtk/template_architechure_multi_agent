# ManagerHR Authentication — invitation-only decision record

Status: APPROVED DESIGN (implementation pending). Task: AUTH-001. Inherits Agent Governance V5.1.

## Product rules
- No public employee self-registration endpoint. `/register` is an invite-acceptance page requiring a valid token; it does not create an arbitrary company membership.
- An authenticated, active HR/Admin may invite a user **only to their own organization** and only for permitted roles. Role HR cannot grant ADMIN unless explicitly allowed by a separately reviewed policy; default: only ADMIN may assign HR; nobody may assign ADMIN from the invitation UI.
- First organization Admin must be provisioned via an **audited, one-time bootstrap CLI** or approved organization-provisioning flow. Never expose an anonymous bootstrap endpoint.
- Each invitation binds `organization_id`, normalized email and intended role, expires after 48 hours, is single-use and can be revoked. Do not automatically change an existing user's membership without an explicit, reviewed join policy.
- Only accepted invitations create/activate new user membership. Invite acceptance must confirm that authenticated/verified email matches invited address; for new users, prove mailbox control by link ownership and require password set.
- One organization owns many memberships; authorization must check `organization_id` for every tenant-owned operation. Global user identity does not imply organization authorization.
- Email delivery must use an adapter (SMTP/provider) configured through secrets; when absent, show a clear DEV-ONLY delivery status, never claim email has been sent.
- Prevent enumeration: generic response on forgot password and invitation requests; detailed invite response available only to authorized HR/Admin in their organization's audit view.

## Route UX
1. `/login`: email, password, accessible validation, loading and generic error. No access tokens in localStorage.
2. `/invite/accept?token=...`: check invite status without exposing sensitive organization/user details; set password, name; complete invite acceptance. History replaced to remove token after consumption.
3. `/forgot-password`: request link; generic success text whether address exists or not.
4. `/reset-password?token=...`: set new password; on success revoke active sessions.
5. `/admin/invitations`: only authorized HR/Admin; invite, view pending, revoke, resend by generating fresh token and invalidating previous token.
6. `/app`: authenticated area; server-enforced permissions (not UI alone).

## Critical security controls
- Use a proven session/auth library when compatible with framework; cookies `HttpOnly`, `Secure` in production, `SameSite=Lax` (or Strict where feasible) and narrow scope. Regenerate session identifiers on login; invalidate server-side on logout, password reset and deactivation.
- Use Argon2id password hashing (or verified safe alternative), password strength checks and throttling with abuse monitoring. Never store or log plaintext passwords or raw invitation/reset tokens.
- Create random tokens with CSPRNG, at least 256 bits; persist only SHA-256 hashes, expiry, and consumed/revoked timestamps; compare safely; consume token and create membership/password change in **one database transaction** with row locking / guarded update.
- CSRF protection required for cookie-authenticated state-changing requests (origin validation plus anti-CSRF as appropriate). Restrict CORS, security headers, HTTPS, and redirect origins.
- Generic login errors, generic reset requests, safe audit logs without tokens; rate-limit by IP, account, recipient and organization; protect email delivery from flooding.
- Reset/invite tokens in URLs: use `Referrer-Policy: no-referrer`, no third-party resources, scrub token from browser URL after processing. Password reset does not automatically authenticate the user.
- Clearly separate email confirmation, membership role and account status. Define ability to accept invite for existing user after email verification without overwriting their password.

## Transaction and concurrency rules
- Two concurrent accept requests against the same token: exactly one succeeds.
- Resend invalidates prior pending token before issuing a new one.
- Organization, email and role are read from server-side invitation row, not client input.
- Soft-deleted users/inactive organizations must not authenticate.
- Updates that affect role or membership require authorization and audit evidence.

## Definition of done
- User can log in, log out, accept valid invitation, request reset and reset password through real UI/API/DB.
- Invalid, expired, revoked, already-used tokens are rejected; race and enumeration tests pass.
- Authorized HR/Admin can invite and revoke inside own org; cross-org and role escalation attempts fail.
- Real email delivery via configured provider is tested in staging (development fixture must not be described as production-ready).
- Unit/integration tests, lint/typecheck, Semgrep, dependency audit, governance checks run; report PASS/FAIL/NOT VERIFIED.
- Production deploy requires human review; no auto-creation of admin credentials.

## Sources
- OWASP ASVS 5.0.0: https://asvs.owasp.org/
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
