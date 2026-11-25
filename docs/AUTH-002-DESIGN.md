# AUTH-002: organization-scoped user management and RBAC

Risk HIGH. Extend AUTH-001; do not duplicate identities, memberships, sessions, audit or invitations. One effective role per membership: ADMIN, HR, MANAGER, EMPLOYEE. Revoking an elevated role means assigning EMPLOYEE. Invitation policy stays EMPLOYEE/HR only; Admin promotion occurs only through the authenticated Admin management API.

## Least-privilege matrix

| Role     | Account read/list                                        | Status                               | Assign role/manager               | Audit              |
| -------- | -------------------------------------------------------- | ------------------------------------ | --------------------------------- | ------------------ |
| ADMIN    | All memberships in own organization                      | Own organization; protect last Admin | Other members in own organization | Organization audit |
| HR       | Own profile and EMPLOYEE memberships in own organization | EMPLOYEE only, never self            | Denied                            | Denied             |
| MANAGER  | Own profile and directly assigned EMPLOYEE memberships   | Denied                               | Denied                            | Denied             |
| EMPLOYEE | Own profile only; list denied                            | Denied                               | Denied                            | Denied             |

Every operation verifies active user, organization, membership and session. Unknown role/action denies. No global account activation/deactivation API: status toggles membership.is_active in the current organization. This avoids allowing one tenant to disable another tenant's identity. Global users.is_active remains an AUTH-001 security gate. Manager assignments reference a membership in the same organization and can be assigned only by Admin to an active MANAGER. Manager may read direct EMPLOYEE reports only; assignment cannot widen access to HR/Admin. Self-management of role/status/manager assignment is denied. No password hashes, tokens or session IDs in safe user DTOs.

## Concurrency and revocation

Use one transaction for authorization recheck, mutation, session revocation and audit. Serialize organization administration by locking the organization row; lock affected user/membership rows consistently with AUTH-001 login/reset. Recheck actor's current active role/session inside the transaction, not the request's cached role. Reject mutation removing the last active ADMIN (membership AND user active). Lock/unlock and changed roles revoke target organization's sessions, including before reactivation. New login cannot use stale membership state across a concurrent lock/role mutation. Manager reassignment is audited; actual scope is checked from current rows per request. All mutation failures roll back audit and state together.

## Schema

Migration003 extends memberships role CHECK to MANAGER and adds nullable manager_user_id. Composite FK (manager_user_id,organization_id) references existing memberships(user_id,organization_id); CHECK disallows self reporting. No replacement RBAC tables. Existing audit metadata stores safe before/after values for role, status and manager. Migration is forward-only, transactional, preserves current users and roles, verified on disposable PostgreSQL; no production execution.

## Verification

Baseline AUTH-001 backend and UI tests before implementation. New tests cover policy matrix, anonymous/CSRF denial, cross-tenant list/detail/actions, Manager report bounds, HR privileged-target denial, self elevation, last-admin concurrency, stale actor authorization, login-versus-lock, revoked session after role/status/unlock, safe DTOs, pagination/search and transactional audit. Under updated V5.3, Manager performs security/correctness review using code and deterministic evidence; no additional subagents. No Optimizer, no model escalation, no production deployment.

V5.3 continuation also provides strict self full-name editing and role/status filters. Status is membership-scoped: active = active membership/user; locked = inactive membership with active user; inactive = disabled global identity. Only fullName may be edited personally, never email, role or organization. Audit outcome SUCCESS/DENIED is explicit for new events; automatic report unassignment after Manager-role removal is audited per affected employee. Self-role/status changes are denied even when another Admin exists, a stricter last-Admin safeguard.
