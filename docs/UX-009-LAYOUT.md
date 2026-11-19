# UX-009 screen consolidation

- Personal account: /app (profile overview and editor), /security (MFA, recovery and own sessions), linked through one account section navigation.
- Organization: /admin/users, /admin/invitations and /admin/audit share permission-filtered section navigation. Detail/edit stays within the user list; audit remains a separate task view.
- Authentication: login, forgot/reset password, invitation acceptance and required MFA retain focused screens. Pending MFA hides workspace navigation; verified MFA and saved recovery codes continue to /app.
- Recovery: backup-code replacement and lost-device reset are grouped; device/session management stays in the security section. No API or authorization change.
- Layout: compact authenticated header, active section links, responsive account summary. Marketing illustration stays on public authentication screens.

Validation: frontend lint/typecheck/build and regression tests executed in session. No authenticated browser, CI, SAST or PR-policy result is claimed. Python launcher unavailable; PR context absent. Human release review remains required. No delegation.
