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

## ORG-002 organization and management scope

`/api/organizations/:organizationId` remains an authenticated tenant boundary.
Internal branches, departments, teams and groups reuse `departments.parent_id`;
the current schema has no separate tenant group. A non-null
`parentOrganizationId` is rejected with 400 `INVALID_PARENT`; no metadata from
another organization is returned. No new endpoint or Employee profile is added.

Existing GET endpoints: `/departments`, `/departments/:departmentId`, `/positions`,
`/positions/:positionId`, `/users`, `/users/:userId` and `/org-chart`.
Manager department scope is the union of active departments explicitly assigned
via `manager_user_id` and their active descendants. Position scope is active
positions bound to those departments; unbound positions do not grant access.
Manager user scope is self, active verified reporting descendants through active
Manager/Employee memberships, and active verified Manager/Employee members of
visible departments. A job title grants no access. Unassigned Managers see no
departments/positions and only their own permitted user record.

Lists, search, pagination and totals apply the same scope. Out-of-scope object
IDs return 404; a different tenant URL returns 403. Managers cannot mutate
hierarchy, assignments or roles. A valid department move updates computed scope
on the next request; an independent reporting grant can remain valid.

Admin has tenant-wide membership visibility. HR membership visibility remains
self and Employees. Employee cannot list users and can read only self; the
department/position directory remains visible within the organization, including
assigned department leaders as directory information. Chart member details obey
the same role scope; out-of-scope reporting manager details are redacted.

Chart JSON retains `{organization, departmentTree, unassignedMembers,
totalDepartments, totalPositions, totalMembers}`. Nodes retain `{id,parentId,
code,name,description,manager,members,memberCount,children}`. A scoped root whose
parent is outside visibility has a null parent; active units with inactive
parents are displayed as roots. Inactive units are excluded from the chart and
Manager scope. Visible reporting members outside visible active departments
appear in `unassignedMembers`. Totals describe the returned data, not hidden data.

Admin/HR can manage departments/positions in the current tenant; only Admin can
assign reporting managers. Existing active-session, CSRF, MFA and reauthentication
checks remain mandatory. Mutations lock the organization before topology checks.
Self/cyclic/cross-tenant parent and reporting assignments are rejected. A department
with active children, memberships or positions cannot be disabled (409
`DEPARTMENT_IN_USE`); deletion also checks inactive dependencies. A department-bound
position requires a matching department on assignment; moves that would invalidate
existing assignments return 409 `POSITION_IN_USE`. Strict body schemas reject
mass assignment. Changes to reporting, position or department never change RBAC.
