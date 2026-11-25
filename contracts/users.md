# AUTH-002 user-management API contract

Extends contracts/api.md. All routes retain AUTH-001 same-origin JSON + X-CSRF-Token cookie defenses, current session checks and stable {code} errors. Prefix /api/organizations/:organizationId. Wrong organization403, unauthenticated401, inaccessible/missing resource404, malformed400, last-admin invariant409. Tenant/action policy: docs/AUTH-002-DESIGN.md.

GET /api/auth/me and login retain existing shape and add permissions.readUsers, manageUsers, assignRoles, viewAudit booleans. Existing invite/grantHR fields stay unchanged. MANAGER joins the role union. readUsers: ADMIN/HR/MANAGER; manageUsers: ADMIN/HR; assignRoles/viewAudit: ADMIN only.

| Method | Path relative to prefix                 | Payload/response                                                                                                                                |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| GET    | /users?q=&role=&status=&page=1&limit=20 | {items:User[],page,limit,total}; q max100 case-insensitive email/name search; stable order; filter rows/count by caller scope before pagination |
| GET    | /users/:userId                          | {user:User}; self or scoped resource                                                                                                            |
| POST   | /users/:userId/status                   | {isActive:boolean}; 204; membership-scoped status, sessions revoked, audit                                                                      |
| POST   | /users/:userId/role                     | {role:'ADMIN'                                                                                                                                   | 'HR'                                                                       | 'MANAGER' | 'EMPLOYEE'}; 204; Admin only, no self mutation, sessions revoked, audit |
| POST   | /users/:userId/manager                  | {managerUserId:uuid                                                                                                                             | null}; 204; Admin only, EMPLOYEE target, active MANAGER in same org, audit |
| GET    | /audit-events?page=1&limit=20           | {items:AuditEvent[],page,limit,total}; Admin only, safe org-scoped event records                                                                |

User={id,email,fullName,role,isActive,userIsActive,emailVerified,managerUserId,createdAt}; id refers to global users.id, role/isActive/managerUserId are membership-scoped. Read APIs expose only approved safe fields. AuditEvent={id,eventType,actorUserId,subjectUserId,createdAt,metadata}; omit secrets. Roles/status/manager payloads are strict; caller-supplied organization, permissions or unrelated properties rejected. Self-changing role/status/manager denied. No role creation, direct public registration, global-user deactivation or organization-settings write is added by AUTH-002. A single assigned role is replaced/revoked to EMPLOYEE rather than introducing redundant role-grant tables.

Error codes include FORBIDDEN, USER_NOT_FOUND, SELF_CHANGE_FORBIDDEN, LAST_ADMIN_REQUIRED, INVALID_MANAGER, INVALID_INPUT, AUTHENTICATION_REQUIRED. Frontend navigation uses permissions; API remains authoritative. UI routes /admin/users and /admin/audit consume these contracts.

POST /api/auth/profile {fullName:string1..120} updates only the current authenticated user name; strict payload rejects role/email/org changes;204 and PROFILE_UPDATED audit. Filters role (four roles) and status (active,locked,inactive) combine with server resource scope. Audit metadata includes outcome SUCCESS or DENIED.
