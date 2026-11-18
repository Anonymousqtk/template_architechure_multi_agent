# ManagerHR Auth API contract — v1 (invitation-only)

API prefix: `/api/auth` and `/api/organizations/:organizationId/invitations`. JSON responses; session cookies; all changing endpoints require appropriate CSRF defense. Server must validate org membership on every call. Error responses use stable error codes; avoid leaking account existence.

| Verb | Path | Auth | Operation |
|---|---|---|---|
| POST | `/api/auth/login` | Public, rate-limited | `{email,password}` → session cookie and safe user profile |
| POST | `/api/auth/logout` | Session | Invalidate session; clear cookie |
| GET | `/api/auth/me` | Session | Identity, active organization and permissions |
| POST | `/api/auth/forgot-password` | Public, rate-limited | `{email}` → `202 {message:"If the account exists, instructions will be sent."}` |
| POST | `/api/auth/reset-password` | Public, rate-limited | `{token,newPassword}` → 204, invalidate other sessions |
| GET | `/api/auth/invitations/validate?token=...` | Public, rate-limited | Return only safe status: valid/invalid/expired (no email enumeration) |
| POST | `/api/auth/invitations/accept` | Token possession | `{token,fullName,password}` for new account; existing-account acceptance must require verified matching user session |
| POST | `/api/organizations/:organizationId/invitations` | HR/Admin in same org | `{email,role}` → 202; one-time link via email adapter |
| GET | `/api/organizations/:organizationId/invitations` | HR/Admin in same org | Paginated invitations without token/hash |
| POST | `/api/organizations/:organizationId/invitations/:id/revoke` | HR/Admin in same org | Revoke pending invitation |
| POST | `/api/organizations/:organizationId/invitations/:id/resend` | HR/Admin in same org | Reissue token, invalidating previous |

No public `POST /api/auth/register`; public account creation requires invitation acceptance. The organization and role in an invitation cannot be overridden by request payloads. User cannot self-assign HR or ADMIN. 

Use HTTP 400 for invalid input, 401 for unauthenticated, 403 for unauthorized, 409 for existing/incompatible membership where no information leaks to anonymous callers, 410 for expired/used invite (when safe), and 429 for rate limiting. HTTP status choices may be adapted to the selected framework provided security invariants remain intact.

**Contract first:** Backend owns API implementation; Frontend consumes this contract; Database owns migrations. Any change to this file requires Manager review and high-risk task approval.
