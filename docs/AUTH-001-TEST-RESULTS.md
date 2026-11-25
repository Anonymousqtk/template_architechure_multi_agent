# AUTH-001 test evidence

Test Engineer used the approved `test-engineering` skill with the inherited model. Tests own only `backend/test/auth.test.ts`, `backend/test/security.test.ts`, and `frontend/src/App.test.tsx`. No production source was modified by the Tester.

## Executed evidence

- Manager executed the final backend coverage run against the disposable PostgreSQL cluster: **PASS, 28 tests in 2 files**, 16.12 seconds. Statements 90.55%, branches 81.14%, functions 96.15%, lines 96.27%. Both migrations and constraint checks passed. Backend lint/typecheck/build passed.
- Manager executed `npm run test:coverage` in `frontend/`: **PASS, 9 tests**. Statements/lines 90.8%, branches 79.85%, functions 71.42%.
- Tester subsequently executed `npm run lint`, `npm run typecheck`, and `npm run build` in `frontend/`: **PASS**, combined command exit 0. Vite 6.4.1 built 30 modules.
- The final backend suite includes two regressions added after business review: a second tab preserves the first tab's CSRF token, and stale resend delivery results cannot overwrite the current token's delivery status. Both passed.
- The fixture test module fails closed without both the disposable runner opt-in and `DATABASE_URL`. Tests use real HTTP requests, real PostgreSQL transactions and real Argon2id verification. They do not call production provisioning or migrations.

## Matrix mapping

All PASS statuses below refer to the executed application tests, with the stated limits. Test names retain the matrix IDs for traceability.

| Matrix  | Result                          | Evidence                                                                                                                     |
| ------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | PASS                            | Missing public registration; arbitrary token cannot create a user                                                            |
| AUTH-02 | PASS (adapter fixture)          | Own-org ADMIN invite persisted; normalized recipient and token hash passed to injected mail adapter; safe paginated list     |
| AUTH-03 | PASS                            | HR cannot grant ADMIN/HR; ADMIN can grant HR                                                                                 |
| AUTH-04 | PASS                            | Cross-org create/list/revoke/resend denied; employee cannot administer                                                       |
| AUTH-05 | PASS                            | Invitation consumption creates exactly one verified user and stored-role membership                                          |
| AUTH-06 | PASS                            | Replay rejected; no duplicate identity/membership                                                                            |
| AUTH-07 | PASS                            | Concurrent accepts produce one 204 and one 410                                                                               |
| AUTH-08 | PASS                            | Expired, revoked and previous resend token rejected; fresh token valid                                                       |
| AUTH-09 | PASS                            | Injected role/organization rejected without consuming invitation                                                             |
| AUTH-10 | PASS                            | Anonymous/wrong user rejected; matching verified existing session can join another org without password overwrite            |
| AUTH-11 | PASS                            | Session rotation, production Secure/HttpOnly/SameSite=Lax/Path=/, host-only cookie                                           |
| AUTH-12 | PASS                            | Unknown user and wrong password return identical errors; shared database throttle returns 429 and Retry-After                |
| AUTH-13 | PASS                            | Logout, inactive membership/user/organization block session access                                                           |
| AUTH-14 | PASS                            | Known/unknown reset responses match; blocked mail adapter does not block public response                                     |
| AUTH-15 | PASS                            | Expired reset and replay rejected with password unchanged                                                                    |
| AUTH-16 | PASS                            | Reset changes password and revokes multiple sessions; no automatic login                                                     |
| AUTH-17 | PASS                            | Concurrent resets produce exactly one winner                                                                                 |
| AUTH-18 | PASS                            | Hostile Origin, absent CSRF header and forged signature rejected                                                             |
| AUTH-19 | PASS (tested application flows) | Persisted invite/reset/session/audit rows and console capture contain no raw bearer tokens or plaintext password             |
| AUTH-20 | PASS                            | Missing SMTP adapter and API DEV_ONLY mode do not report SENT                                                                |
| AUTH-21 | PASS                            | No public bootstrap endpoint                                                                                                 |
| AUTH-22 | PASS (headers/UI)               | No-referrer/no-store/self-only policy; no redirect; reset/invite token removed from browser history and never put in storage |

Additional executed backend regression: reset holding the user lock prevents an old-password login from creating a surviving session. The test waits for PostgreSQL lock contention rather than relying on a fixed race delay.

Additional executed unit tests verify 256-bit random tokens, SHA-256 digests, signed comparisons, Argon2id parameters, corrupt-password handling, absent SMTP, and fail-closed configuration.

Frontend tests cover accessible labels and focused generic login errors, CSRF request headers, forgot-password generic text and DEV_ONLY warning, password confirmation, invite-only `/register`, new/existing account invitation acceptance, and employee/HR controls. UI tests use jsdom with a controlled HTTP adapter; they are not a real-browser certification.

## Not verified by this evidence

- Real SMTP/provider delivery in staging, provider retries and durable dispatch.
- Full browser end-to-end journeys, assistive-technology audit and network-level referrer capture.
- Reverse-proxy/request logs, production HTTPS configuration, deployed monitoring, production migrations and bootstrap provisioning.
- Semgrep, dependency audits, PR-context policy and authoritative CI are reported separately by Manager; these application tests cannot establish those results.
