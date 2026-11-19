# AUTH-003 scope and security decisions

| Area | Existing | Missing / Improvement |
|---|---|---|
| Sessions | Hash-only opaque cookies,8h absolute expiry, login rotation, logout/reset/role/status revocation | Server30min idle expiry, session/device list and individual/all-other revocation |
| Protection | Persistent IP/account/org/recipient throttles; socket IP not forwarded headers; generic auth/reset errors; CSRF | MFA/account throttles and failed-login/rate-limit audit |
| RBAC | Current membership checks and transactional actor/session recheck | Enforce MFA and recent10min reauthentication inside sensitive transactions |
| MFA | None | TOTP enrollment/verify, encrypted secret, saved recovery codes, controlled recovery and mandatory Admin/HR gate |

Single Agent V5.3, inherited model, approved security-review skill. Reuse users, sessions, throttle and audit. Add only user_mfa storage and session metadata. No framework/library downloads, no new app dependency. TOTP selected for existing stack and local preview compatibility; WebAuthn/passkeys deferred until a reviewed RP ID/origin and maintained WebAuthn library are introduced. TOTP is not phishing-resistant and no AAL certification is claimed.

Runtime policy always requires MFA for ADMIN/HR and any user with MFA enrolled. Password login issues a restricted5min session until MFA succeeds. Restricted sessions can only get own /me, CSRF, logout and MFA enrollment/challenge/recovery; other API access403. Role elevation invalidates sessions as AUTH-002 already does. MFA/reauth rotates opaque ID and invalidates all prior session handles. Ordinary reauth preserves absolute expiry. Full sessions expire absolutely after8h and after30min inactivity. Existing privileged sessions become restricted during upgrade.

TOTP6digits,30s period,current or one previous step,global last accepted counter prevents replay across sessions. AES-256-GCM random12byte nonce, authenticated user ID, separate32byte MFA_ENCRYPTION_KEY (base64), never derived from password/CSRF. Pending enrollment10min; password required before displaying secret. Ten random128bit saved recovery codes shown once, hash-only storage; serialized one-time consumption. Recovery requires password plus saved code, removes old factor/codes, revokes all sessions and produces a new restricted session requiring enrollment for Admin/HR. Admin/HR cannot simply disable MFA. Other users disable with password+factor; all other sessions revoked. Never reset MFA through forgot-password or role management.

Sensitive RBAC/invitation writes require recent10min reauth when runtime MFA policy is active, rechecked transactionally. Login/MFA limit by socket IP plus account/user independent of forwarded headers;15min windows, no permanent account lock. Audit excludes raw secrets/OTP/recovery/session tokens, passwords, raw UA or IP. Store only coarse browser family for user-facing session labels. HTTPS/cookies retained from AUTH-001. No active scans or production actions.

Test injection may turn mandatory-role policy off only in the existing regression app factory fixtures; production loadConfig always enables it and requires a configured encryption key. New tests explicitly enable runtime policy. Production keys must be stored/rotated/backed up via approved secret management; losing the key breaks TOTP validation, so recovery codes and reviewed recovery operations remain essential.

References: OWASP Authentication, Session Management and Multifactor Authentication Cheat Sheets; NIST SP800-63B-4 final https://pages.nist.gov/800-63-4/sp800-63b.html. OTP replay resistance and saved recovery controls are tested, not assumed from reference use.


Reviewed sources used during implementation:
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- https://pages.nist.gov/800-63-4/sp800-63b.html

Recovery-code regeneration requires password+factor, invalidates the old set and other sessions, and shows the replacement set only once. Completed MFA sessions cannot use /mfa/verify as a passwordless reauthentication shortcut. Public password-reset UI stays available during MFA challenge; resetting password still preserves the factor.
