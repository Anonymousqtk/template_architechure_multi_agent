# AUTH-003 session and MFA contract

Retain AUTH-001 same-origin JSON, Origin and signed CSRF defenses for every POST. Runtime loadConfig requires a separate32byte base64 MFA_ENCRYPTION_KEY, always enables mandatory ADMIN/HR MFA. Any enrolled user requires MFA. Login remains200 with existing profile plus security {mfaRequired,mfaEnabled,mfaVerified}; restricted sessions have no management permissions. /me remains available to let UI complete MFA. All other protected APIs403 MFA_REQUIRED until completion. Public login/forgot/reset/validate still function; reset never removes MFA. Cookie/session lifetime pending5min, full8h absolute,30min idle.

| Method | /api/auth path          | Request / response                                                                                                                                           |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /mfa/status             | own {enabled,required,verified,recoveryCodesRemaining}; no secrets                                                                                           |
| POST   | /mfa/enroll             | {password} -> {secret,uri}, only when unenrolled; secret returned once per initiation, encrypted pending10min                                                |
| POST   | /mfa/confirm            | {code} -> {recoveryCodes:10 one-time strings}; TOTP proof enables MFA, revokes old sessions, rotates cookie                                                  |
| POST   | /mfa/verify             | {code:OTP or recovery code}; pending sessions only;204 and full-session rotation; completed sessions409 MFA_ALREADY_VERIFIED                                 |
| POST   | /reauthenticate         | {password,code?}; factor required when enrolled;204, rotate preserving absolute expiry; required for sensitive actions after10min                            |
| POST   | /mfa/recovery-codes     | {password,code}; verified session plus both proofs; returns10 new codes once, invalidates old set, revokes other sessions/rotates preserving absolute expiry |
| POST   | /mfa/disable            | {password,code};204, all sessions revoked/rotate; ADMIN/HR denied403 MFA_REQUIRED                                                                            |
| POST   | /mfa/recover            | {password,code:32hex saved recovery code};204; clears factor/old codes, revokes all sessions, rotates restricted cookie; Admin/HR must enroll again          |
| GET    | /sessions               | own active sessions {items:[id,deviceLabel,createdAt,lastSeenAt,expiresAt,current]}; UUID is a database handle, never bearer token/hash                      |
| POST   | /sessions/:id/revoke    | {};204; own session only,404 for another identity; recent auth required                                                                                      |
| POST   | /sessions/revoke-others | {};204; all own other sessions across organizations; recent auth required                                                                                    |

Sensitive existing RBAC/invitation writes recheck current session/MFA/reauth transactionally. Setting fresh reauth via a completed MFA challenge is forbidden; use password+factor. Individual/current session revocation clears cookie. MFA disable/recovery/enrollment invalidate all old global-identity sessions. Role/status revocation remains organization-scoped from AUTH-002.

Error codes: MFA_REQUIRED, INVALID_FACTOR, MFA_NOT_ENROLLED, MFA_ALREADY_ENABLED, MFA_ALREADY_VERIFIED, ENROLLMENT_EXPIRED, REAUTH_REQUIRED, SESSION_NOT_FOUND, RATE_LIMITED. Existing stable auth/input errors retained. Audit uses existing table and safe outcome/event identifiers; no password, OTP, raw recovery key, session token/hash, secret or full user-agent/IP. Coarse browser family is informational, never an authentication factor. UI /security renders enrollment/challenge/recovery and active-session management; recovery keys shown once and never persisted in browser storage.
