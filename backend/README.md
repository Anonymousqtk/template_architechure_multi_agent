# Backend AUTH-001

Express 5 / TypeScript, PostgreSQL, Argon2id. Install with `npm ci`, copy `.env.example` into your process environment (Node does not automatically load it), apply reviewed migrations to an approved local database, build frontend and backend, then `npm start`. Development: `npm run dev`.

`GET /api/auth/csrf` establishes a signed HttpOnly CSRF cookie and returns `csrfToken`. Every POST requires same-origin `Origin`, JSON content type and `X-CSRF-Token`. CORS is deliberately disabled. Cookies use HttpOnly, SameSite=Lax, path=/ and Secure with `__Host-` names in production. Deploy behind HTTPS without logging query strings/bodies. Socket IP is used for throttling; proxy headers are untrusted. Review a deployment-specific trusted proxy and distributed IP policy before exposing multiple proxies.

Sessions are opaque 256-bit random identifiers, stored only as SHA-256 in the specified `user_sessions` schema, with server-side expiry/revocation and active user/org/membership validation on every request. Express supplies cookie serialization; a general express-session JSON store was not used because its schema and raw opaque-ID persistence differ from the approved hash-only schema. Session IDs rotate at every successful login. Multi-organization users initially enter their oldest active membership; switching organizations is outside AUTH-001.

Mail uses a TLS-required SMTP adapter. Without SMTP, API and UI explicitly report DEV_ONLY: no delivery and no recoverable raw links are written. Tests inject a memory capture adapter; it must never be enabled in production. Delivery failures are recorded without provider errors or raw links. No staging SMTP verification is implied.

No public registration/bootstrap endpoint exists. Bootstrap CLI is never automatic, refuses a nonempty organizations table, uses an advisory transaction lock, and writes an audit event. Human approval is required before running it. It requires `ALLOW_ADMIN_BOOTSTRAP=I_HAVE_HUMAN_APPROVAL`, `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME`, `BOOTSTRAP_ORGANIZATION`, and `BOOTSTRAP_PASSWORD_FILE` pointing to a private file; never pass passwords on the command line. Delete the private input file according to operator policy after use. No bootstrap was executed by implementation.

Production migration, admin provisioning, trusted proxy settings, SMTP staging verification and deployment require human review. Apply migrations with a separate privileged deployment account; runtime DB role should only have required SELECT/INSERT/UPDATE privileges. Keep database and SMTP secrets outside version control.

## AUTH-003 security/session operation

Runtime requires MFA_ENCRYPTION_KEY: an independent32-byte CSPRNG key encoded as base64, stored only in approved secret storage/local ignored .env. Never derive it from CSRF/passwords, print it, commit it or overwrite it after MFA enrollment. Back up and rotate/re-encrypt it through a separately reviewed secret-management process. Production loadConfig always enables Admin/HR MFA; requireMfa:false is a direct test-factory fixture option, not a supported runtime environment switch.

Admin/HR password login produces a limited5-minute session. /security guides manual TOTP enrollment; secret/codes stay in component memory, not browser storage. Save recovery codes once shown. MFA completion rotates the session, invalidates old handles and enables RBAC. Existing privileged sessions are automatically restricted after upgrade. Session inactivity expires at30minutes; absolute expiry8hours; sensitive management requires reauth within10minutes. Reauthentication rotates IDs while preserving absolute expiry.

Lost device: /security recovery needs password plus an unused saved code; it revokes all sessions/factor/codes, then privileged users must enroll again. While a valid factor remains, regenerate backup codes with password+factor; the old set and other sessions are revoked. Losing every factor/code requires a separately authorized identity-verification/support procedure, never a password-only MFA bypass or unreviewed Admin backdoor. A password reset does not disable MFA. TOTP is not phishing-resistant; passkeys remain a future reviewed integration, not a claimed capability.

Local AUTH-003 migration004 preserves current accounts and adds session metadata plus user_mfa. Production migration, trusted HTTPS/proxy handling, secret backup/rotation and CI/SAST require review. No production actions or test email sends were performed for AUTH-003.
