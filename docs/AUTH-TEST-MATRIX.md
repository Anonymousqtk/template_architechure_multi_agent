# AUTH-001 Verification matrix

No test below has been executed against an application yet. Mark each as PASS, FAIL or NOT VERIFIED using actual tool output.

| ID      | Test case                                            | Expected                                                     |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| AUTH-01 | Anonymous attempts to create employee without invite | No public registration route; denied                         |
| AUTH-02 | ADMIN invites employee in own org                    | Invite persisted and email queued/sent by provider           |
| AUTH-03 | HR tries to invite ADMIN                             | Rejected                                                     |
| AUTH-04 | HR of org A invites into org B                       | Rejected with 403                                            |
| AUTH-05 | Valid new-user invite accepted                       | Exactly one user + org membership created, token consumed    |
| AUTH-06 | Invite accepted twice                                | Second attempt rejected; no duplicate user/membership        |
| AUTH-07 | Two concurrent accepts of same invite                | Exactly one succeeds                                         |
| AUTH-08 | Expired/revoked/reissued invite token                | Rejected                                                     |
| AUTH-09 | User edits role/org in accept body                   | Server ignores/rejects, uses stored invitation               |
| AUTH-10 | Existing user accepts invite with wrong email        | Rejected                                                     |
| AUTH-11 | Valid login → session cookie flags                   | HttpOnly, Secure (production), SameSite and safe domain/path |
| AUTH-12 | Invalid password and unknown email                   | Generic messages, rate limiting                              |
| AUTH-13 | Logout, revoked membership, disabled user            | Session no longer grants access                              |
| AUTH-14 | Unknown email requests reset                         | Same public response as known email                          |
| AUTH-15 | Reset token replay/expiry                            | Rejected; no password change                                 |
| AUTH-16 | Password reset succeeds                              | Password changed, active sessions revoked                    |
| AUTH-17 | Concurrent reset-token consumption                   | Exactly one succeeds                                         |
| AUTH-18 | CSRF from untrusted origin                           | Rejected                                                     |
| AUTH-19 | Invite/reset raw token in DB or logs                 | No raw token stored/logged                                   |
| AUTH-20 | Mail adapter absent                                  | Explicit DEV-only limitation, no false success claim         |
| AUTH-21 | Anonymous bootstrap admin attempt                    | No public bootstrap route                                    |
| AUTH-22 | HTTP redirect/referrer with token                    | No token leaked to third parties                             |
