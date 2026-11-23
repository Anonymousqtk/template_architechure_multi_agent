# ManagerHR Auth API contract — v1 (invitation-only)

API prefix: `/api/auth` and `/api/organizations/:organizationId/invitations`. JSON responses; session cookies; all changing endpoints require appropriate CSRF defense. Server must validate org membership on every call. Error responses use stable error codes; avoid leaking account existence.

| Verb | Path | Auth | Operation |
|---|---|---|---|
| POST | `/api/auth/login` | Public, rate-limited | `{email,password}` → session cookie and safe user profile |
| POST | `/api/auth/logout` | Session | Invalidate session; clear cookie |
| GET | `/api/auth/me` | Session | Identity, active organization and permissions |
| GET | `/api/auth/profile/avatar` | Session | Current account avatar URL or `null`; independent of employee linkage |
| POST | `/api/auth/profile/avatar` | Session + CSRF (and MFA when required) | `{fileName,mimeType,contentBase64}` → save the current user's JPG/PNG avatar (max 10MB) |
| GET | `/api/auth/profile/avatar/content` | Session | Stream only the signed-in user's private avatar |
| POST | `/api/auth/forgot-password` | Public, rate-limited | `{email}` → `202 {message:"If the account exists, instructions will be sent."}` |
| POST | `/api/auth/reset-password` | Public, rate-limited | `{token,newPassword}` → 204, invalidate other sessions |
| GET | `/api/auth/invitations/validate?token=...` | Public, rate-limited | Return only safe status: valid/invalid/expired (no email enumeration) |
| POST | `/api/auth/invitations/accept` | Token possession | `{token,fullName,password}` for new account; existing-account acceptance must require verified matching user session |
| POST | `/api/organizations/:organizationId/invitations` | HR/Admin in same org | `{email,role}` → 202; one-time link via email adapter |
| GET | `/api/organizations/:organizationId/invitations` | HR/Admin in same org | Paginated invitations without token/hash; includes an avatar URL only when the invitee is an active member of that organization |
| POST | `/api/organizations/:organizationId/invitations/:id/revoke` | HR/Admin in same org | Revoke pending invitation |
| POST | `/api/organizations/:organizationId/invitations/:id/resend` | HR/Admin in same org | Reissue token, invalidating previous |

No public `POST /api/auth/register`; public account creation requires invitation acceptance. The organization and role in an invitation cannot be overridden by request payloads. User cannot self-assign HR or ADMIN. 

Use HTTP 400 for invalid input, 401 for unauthenticated, 403 for unauthorized, 409 for existing/incompatible membership where no information leaks to anonymous callers, 410 for expired/used invite (when safe), and 429 for rate limiting. Schema validation errors may include `fields`, an array of invalid field paths, but must never include submitted values. HTTP status choices may be adapted to the selected framework provided security invariants remain intact.

**Contract first:** Backend owns API implementation; Frontend consumes this contract; Database owns migrations. Any change to this file requires Manager review and high-risk task approval.

## Passkey authentication

The CSRF bootstrap response advertises `passkeysAvailable` for HTTPS origins and local `localhost` development. Passkeys are available to active Admin and HR memberships with an enrolled Authenticator.

| Verb | Path | Requirement and result |
|---|---|---|
| POST | `/api/auth/passkeys/login/options` | Public and rate-limited. Returns discoverable WebAuthn request options. |
| POST | `/api/auth/passkeys/login/verify` | Accepts `{challenge,response}`. Issues a verified session and the usual profile after a valid assertion. |
| GET | `/api/auth/passkeys` | Verified owner. Returns `{items}` with credential IDs and creation/last-use timestamps for the current relying party. |
| POST | `/api/auth/passkeys/register/options` | Verified owner with recent reauthentication. Returns WebAuthn creation options. |
| POST | `/api/auth/passkeys/register/verify` | Same requirement. Accepts `{challenge,response}` and returns 204 after registration. |
| POST | `/api/auth/passkeys/remove` | Same requirement. Accepts `{id}`, withdraws that passkey and revokes other sessions. Returns 204. |

The server verifies the origin, relying-party ID and device user verification. Challenges expire after five minutes, are bound to the requesting browser and operation, and are consumed atomically. Registration also binds the challenge to the current session. Password plus Authenticator and recovery codes remain available. Resetting the Authenticator through MFA recovery revokes the account's associated passkeys.

## ORG-002 organization and management scope

### Job titles and position reporting

- Admin and HR manage the tenant catalog at `/api/organizations/:organizationId/job-titles`. GET lists paginated titles with `q` and `isActive`. GET by ID returns `{jobTitle}`. POST accepts `{code,name,description?,isActive?}`. PATCH accepts partial fields. Codes are unique per tenant after normalization.
- Position POST and PATCH also accept `jobTitleId` and `managerPositionId`. An explicit `null` clears a relationship. Position reads show the linked title and visible manager position. Use `jobTitleId` to filter by title and, as Admin or HR, `managerPositionId` to list direct reports. Managers only see supervisor details for active positions in their own department scope.
- New relationships require active references in the same tenant. Deactivation preserves existing relationships. A position with direct reports cannot be deleted until those reports are moved or detached. The Position reporting structure and existing employee reporting are maintained independently. Neither a job title nor a position changes system permissions.
- Migration `009` adds nullable relationships without inferring links for existing positions. For rollback in a shared environment, use an approved backup or reviewed forward repair.

## ATT-001 attendance, scheduling and leave

All routes below use `/api/organizations/:organizationId/attendance`. Use the same session and CSRF rules as the other organization APIs. Employee resolution and review scope are tenant-bound. Admin/HR configure catalogs and schedules. Managers review within their existing management scope. Employees record their own punches. A reviewer cannot approve or reject their own request or a request they submitted on behalf of someone else.

| Method | Relative path | Operation |
|---|---|---|
| GET | `/employees?q=&page=` · `/catalog` | Scope-filtered employee list and attendance catalogs. |
| GET | `/employees/:employeeId/ledger?from=&to=&timeZone=` | Calendar (shift local dates), raw/effective punches, correction history, leave (requested time zone, UTC default), and balances. |
| PUT | `/shifts/:id` · `/leave-types/:id` | Create with `new` or replace the named configuration. |
| PUT/DELETE | `/employees/:employeeId/schedule/:id` | Add (`new`), replace or remove future, unpunched shift/off assignments. Shifts snapshot their hours, time zone and thresholds. Ambiguous local times require an explicit ISO offset. |
| POST | `/punches/:scheduleId` | `{action:"IN"\|"OUT"}` only. Server provides time and checks eligibility. |
| POST | `/corrections/:scheduleId` · `/corrections/:id/review` | Propose an effective in/out pair after shift end, or approve/reject with a reason. Raw punches stay intact. |
| PUT | `/employees/:employeeId/balances/:leaveTypeId` | Set total authorized allowance minutes with a reason. |
| POST | `/employees/:employeeId/leave` · `/leave/:id/review` · `/leave/:id/cancel` | Submit an explicit time interval, approve/reject, or cancel with a reason. Pending cancellation is available to the requester/employee and scoped reviewers. Approved cancellation requires a different authorized reviewer with recent authentication. |

Late, early departure and after-shift overtime indicators are computed only when their respective shift thresholds are configured. Recorded minutes describe elapsed timestamps. Break deductions, payroll rounding, overtime payment, accrual, holidays, expiry and carryover require approved business rules. Tracked leave approval requires an explicit `chargeMinutes`; available minutes are allowance minus approved charges, so replay cannot double-charge and cancellation releases the allocation. Existing scheduled work stays visible under approved leave. Worked time and approved leave conflicts are exposed for reconciliation.

Migration `010` is additive. Production rollback requires an approved backup or a reviewed forward repair because attendance records carry audit history.

`/api/organizations/:organizationId` remains an authenticated tenant boundary.
Internal branches, departments, teams and groups reuse `departments.parent_id`;
the current schema has no separate tenant group. A non-null
`parentOrganizationId` is rejected with 400 `INVALID_PARENT`; no metadata from
another organization is returned. No new endpoint or Employee profile is added.

Existing GET endpoints: `/departments`, `/departments/:departmentId`, `/positions`,
`/positions/:positionId`, `/users`, `/users/:userId` and `/org-chart`.
`GET /api/organizations/:organizationId/users/:userId/avatar` returns a private avatar only when the requester can view that member through the same organization and role/manager scope as the user-detail endpoint. Member-list avatar URLs follow that route.
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

## ATT-002 — department attendance

Under `/api/organizations/:organizationId/attendance` (same-origin JSON/CSRF and existing session/MFA checks):

- `GET /catalog` adds `departments` for Admin/HR: `{id,name,mode,timeZone,startTime,endTime,weekdays}`. Other roles receive an empty department list.
- `PUT /departments/:id/policy`: Admin/HR with recent reauthentication only. Strict body `{mode:"SHIFT"|"OFFICE",timeZone,startTime:"HH:mm",endTime:"HH:mm",weekdays:number[]}`; weekdays use Sunday=0 through Saturday=6, unique and nonempty. Office hours must end later on the same day; timezone must exist in PostgreSQL. Returns 204; unknown/foreign/inactive department 404. Audit event `ATT_DEPARTMENT_POLICY_SAVED`.
- `GET /employees` adds `attendanceMode`, default SHIFT for employees without a department. Mode is taken from the employee's own department, without inheritance.
- `GET /employees/:employeeId/ledger` adds `attendanceKind` (SHIFT/OFFICE/OFF) and `virtual` to schedule rows. Office days are projected from the department's activation date, employee hire date, weekdays and timezone; existing overlapping schedules/days off take precedence. GET performs no writes.
- `POST /employees/:employeeId/office-punch`: strict `{action:"IN",workDate:"YYYY-MM-DD"}`. Self only, active office employee, current day in department timezone. Creates the day's snapshot and records server time atomically. Early check-in opens 120 minutes before start, never on the previous local date; closes at end. Existing open work, duplicate punches and approved leave still block check-in. Clients use existing `POST /punches/:id` with `{action:"OUT"}` after check-in, including after a department/mode change.
- Existing `POST /corrections/:scheduleId` accepts optional paired `{employeeId,workDate}` to snapshot a virtual office day before requesting a correction. Existing scope/self/admin checks, past-day restrictions, review rules and raw-punch preservation remain mandatory.

New shift assignments to an office department return 409 `ATT_OFFICE_NO_SHIFT`; explicit days off remain supported. Existing schedules and recorded punches remain valid. Changing department policy snapshots elapsed office days (including today) under the organization mutation lock. Newly projected future days use the updated policy. Recorded minutes are elapsed in/out time; there is no automatic lunch deduction or overtime threshold for office days. No default departments are switched automatically.

Migration `011_department_attendance.sql` is additive and defaults all departments to SHIFT. It takes schema locks with a 5-second lock timeout; existing null-shift schedules become OFF. For rollback, retain the new schema and roll back application code, or restore an approved backup; do not drop attendance history. Production application requires human review and CI.

## ORG-003 — independent companies and system provisioning

The operator explicitly selected separate system-administrator provisioning. Company ADMIN does not imply system authority. `system_administrators` records a separately designated existing verified identity; migration 012 grants nobody. The initial local designation was explicitly requested for `admin@managerhr.test`. No public registration, automatic bootstrap or runtime API for granting system-administrator rights exists.

All `/api/units` operations require a valid active session; writes use the existing same-origin JSON/CSRF protections. System authority requires completed MFA in runtime mode. Sensitive writes also recheck current session, membership, user status and recent reauthentication in the transaction.

- `GET /api/units` → `{items,canCreate,canArchive}`. Ordinary users see active organizations with active memberships. System administrators see organization metadata including archived organizations. Each item is `{id,name,code,description,isActive,role,current,canSelect,canEdit}`. Global metadata access does not grant tenant-data access.
- `POST /api/units`: system administrators only; strict `{name,code:null|string,description:null|string,adminEmail}`. Code uses uppercase letters, numbers, underscore, dot or hyphen (1–30 characters), name 1–100, description at most 500. Initial Admin must be an active, verified existing user. Atomically creates an independent organization plus the nominated initial ADMIN membership; the creator receives no implicit membership. Returns 201 `{id}`. Audits `ORGANIZATION_PROVISIONED` with nominated user. This is the explicitly authorized organization-provisioning flow; ordinary memberships still use invitation acceptance.
- `PATCH /api/units/:id`: system administrator or active ADMIN membership in that target organization; strict full metadata `{name,code,description,isActive?}`. Only system administrators may change activation state. Returns 204. Code collisions return 409 `DUPLICATE_CODE`; inaccessible targets 404 `UNIT_NOT_FOUND`. Audits `ORGANIZATION_UPDATED`.
- `DELETE /api/units/:id`: system administrators only; `{}` body. Archives the organization and revokes its sessions while retaining history, employees, memberships and audit evidence. Returns 204; already archived/unknown target 404. Cannot archive the current organization (409 `UNIT_CURRENT`); first select another authorized active organization. Audits `ORGANIZATION_ARCHIVED`. Restore using PATCH with `isActive:true`.
- `POST /api/units/:id/select`: `{}` body. Requires an active target membership even for system administrators. Revokes the previous session and issues a new random HttpOnly cookie with only the target role from the database. Preserves the previous absolute expiry and reauthentication/MFA state; entering a privileged membership without completed MFA creates a restricted session capped at five minutes. Returns 204; client fetches `/api/auth/me` and clears tenant-specific screens. Audits `ORGANIZATION_SELECTED`.

Errors also include `UNIT_ADMIN_UNAVAILABLE`, `FORBIDDEN`, `MFA_REQUIRED`, `REAUTH_REQUIRED`, and existing authentication/input errors. Selecting a unit never changes membership or grants ADMIN. No operation attaches independent organizations in a hierarchy. Hard deletion and global access to employee/attendance records are not provided.

## PAY-001 — Payroll, Salary Components & Allowance Management

All payroll endpoints operate under `/api/organizations/:organizationId/payroll`. Tenant isolation is strictly enforced via `organization_id` on all tables, operations, and foreign keys. All monetary calculations use fixed-point decimal arithmetic (PostgreSQL `numeric(15, 2)` and exact integer cent mathematics) to prevent any floating-point inaccuracies. No speculative tax or insurance rates are assumed without approved policy.

| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/catalog` | Admin, HR | List active salary components for payroll configuration. |
| GET | `/components` | Admin, HR | Paginated salary components with search (`q`) and type filter (`type`). |
| POST | `/components` | Admin, HR | Create salary component (`code`, `name`, `type`, `calculationType`, `isTaxable`, `isStatutory`, `defaultAmount`, `active`, `description`). |
| PUT | `/components/:id` | Admin, HR | Update component attributes. Code is immutable. |
| GET | `/employees/:employeeId/salary-profile` | Admin, HR, Manager (in scope), Employee (self) | Fetch active employee salary profile, gross/net mode, base salary, and assigned recurring components. |
| PUT | `/employees/:employeeId/salary-profile` | Admin, HR (reauth) | Create/update employee salary profile and recurring allowance/deduction components. Each save creates a new version preserving history. Sensitive values are never logged to console or audit metadata. |
| GET | `/periods` | Admin, HR, Manager | Paginated payroll periods with status filter (`DRAFT`, `UNDER_REVIEW`, `APPROVED`, `CLOSED`). |
| POST | `/periods` | Admin, HR | Create a new payroll period in `DRAFT` status (`code`, `name`, `startDate`, `endDate`, `standardWorkingDays`, `paymentDate`, `notes`). |
| GET | `/periods/:id` | Admin, HR, Manager | Retrieve period detail and aggregate summary (slips count, total gross, total net, employee count). |
| POST | `/periods/:id/calculate` | Admin, HR (reauth) | Idempotent draft calculation integrating approved attendance punches, approved leaves, and recurring components. Blocked on `CLOSED` periods (409 `PAYROLL_PERIOD_CLOSED`). |
| PATCH | `/periods/:id/status` | Admin, HR (reauth) | Lifecycle transition: `DRAFT` → `UNDER_REVIEW` → `APPROVED` → `CLOSED`. Setting `CLOSED` permanently locks the period and its slips via database trigger and application check. |
| GET | `/periods/:id/slips` | Admin, HR, Manager (in scope), Employee (self) | Paginated list of payslips within the specified period. Filtered by role and management scope. |
| GET | `/slips/:id` | Admin, HR, Manager (in scope), Employee (self) | Itemized payslip detail with breakdown lines (base salary, allowances, bonuses, deductions, overtime). |
| GET | `/my-slips` | Authenticated employee | Self-service payslip history for the logged-in user across all accessible periods. |

### PAY-001 Enhancement — Salary History & Social Insurance (BHXH)

| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/employees/:employeeId/salary-history` | Admin, HR, Manager (in scope), Employee (self) | Paginated history of all salary profile versions for the employee, including effective dates, salary mode, currency, and recurring components. Applied salary (profile) vs. received salary (payslip) are distinct. |
| GET | `/my-salary-profile` | Authenticated employee | Self-service shortcut: returns current active salary profile, components, and last 6 historical entries for the calling user's linked employee record. |
| GET | `/employees/:employeeId/adjustment-log` | Admin, HR, Manager (in scope), Employee (self) | Paginated audit log of salary profile saves: action type, effective dates, salary mode, actor name, and reason. No monetary values stored in audit. |
| GET | `/employees/:employeeId/social-insurance` | Admin, HR, Manager (in scope), Employee (self) | Current BHXH profile (mã BHXH, mã BHYT, ngày tham gia, mức lương đóng, trạng thái) and last 12 monthly contributions. |
| PUT | `/employees/:employeeId/social-insurance` | Admin, HR (reauth) | Create/update employee BHXH profile. Deactivates the current ACTIVE record and inserts a new one to preserve history. Audit log written (no salary amounts). |
| GET | `/employees/:employeeId/social-insurance/contributions` | Admin, HR, Manager (in scope), Employee (self) | Full paginated BHXH contribution history (tháng, mức lương đóng, tỷ lệ, số tiền, trạng thái xác nhận). |
| POST | `/employees/:employeeId/social-insurance/contributions` | Admin, HR (reauth) | Record or update a monthly BHXH contribution. `contributionMonth` must be the first of the month. On conflict for the same month, updates the existing row (supports adjustments). Rates and amounts are entered by HR/Admin; no formula assumed. |

**Invariants:**
- Monetary fields use `numeric(15,2)`; never `float`. Rates use `numeric(5,4)`.
- Salary profiles are append-only (each PUT creates a new row; old rows are retained).
- BHXH profiles are append-only (PUT deactivates the current record and inserts a new one).
- Contribution `contributionMonth` must be the first day of the month (400 `CONTRIBUTION_MONTH_MUST_BE_FIRST_OF_MONTH` otherwise).
- No auto-confirmation, auto-transfer, or formula-based tax/insurance computation is performed without explicit HR input.
- Audit events: `PAYROLL_PROFILE_SAVED`, `SI_PROFILE_SAVED`, `SI_CONTRIBUTION_RECORDED`. No salary amounts in audit payloads.

Migration `013_payroll_management.sql` creates core payroll tables and the `guard_closed_payroll_period` trigger.
Migration `016_salary_si_history.sql` (additive) creates `employee_social_insurance`, `social_insurance_contributions`, `salary_adjustment_log`, and the `trg_salary_profile_created` trigger that auto-populates the adjustment log on each salary profile insert. Salary profile writes set `app.current_user_id` transaction-locally; the trigger rejects inserts without this authenticated actor context.

### PAY-003 — Payroll Accounting & Reconciliation

All endpoints operate under `/api/organizations/:organizationId/payroll`. Strict RBAC restricts financial accounting and reconciliation mutations to `ADMIN` and `HR`. All monetary figures use exact decimal representation (`numeric(15,2)` in PostgreSQL and integer cents arithmetic in TypeScript).

| Method | Relative path | Access | Operation |
|---|---|---|---|
| POST | `/accounting/accounts/seed-defaults` | Admin, HR | Idempotently seeds default standard chart of accounts (VAS 3341, 6422, 6421, 622, 3383, 3384, 3386, 3382, 3335, 1121, 1111) and posting rules. |
| GET | `/accounting/accounts` | Admin, HR | Paginated chart of accounts with search (`q`), type filter (`type`), and active status filter (`isActive`). |
| POST | `/accounting/accounts` | Admin, HR | Create accounting account (`code`, `name`, `type`, `description`, `isActive`). Code is unique per organization. |
| PUT | `/accounting/accounts/:id` | Admin, HR | Update account attributes (`name`, `description`, `isActive`). Account code and type are immutable once created. |
| GET | `/accounting/rules` | Admin, HR | List active payroll posting rules with joined account and department details. |
| POST | `/accounting/rules` | Admin, HR | Create posting rule (`ruleCode`, `name`, `componentType`, `departmentId`, `debitAccountId`, `creditAccountId`, `isActive`). |
| PUT | `/accounting/rules/:id` | Admin, HR | Update posting rule attributes (`name`, `debitAccountId`, `creditAccountId`, `isActive`). |
| POST | `/periods/:id/accounting/generate` | Admin, HR | Generate balanced double-entry journal entry from an `APPROVED` or `CLOSED` payroll period. Enforces `totalDebit == totalCredit` balancing. Reject unapproved periods (409 `PAYROLL_PERIOD_NOT_APPROVED_OR_CLOSED`). |
| GET | `/periods/:id/accounting/entries` | Admin, HR | List journal entries generated for the specified payroll period. |
| GET | `/accounting/entries/:entryId` | Admin, HR | Detailed journal entry voucher with itemized debit and credit lines, account codes, names, and department allocation. |
| POST | `/accounting/entries/:entryId/post` | Admin, HR | Transition journal entry from `DRAFT` to `POSTED`. Once posted, entries are locked and immutable via database trigger. |
| POST | `/accounting/entries/:entryId/reverse` | Admin, HR | Reverse a posted journal entry. Creates a linked reversal entry with opposite Debit/Credit lines, updates original to `REVERSED`, and records audit trail. |
| POST | `/periods/:id/disbursements` | Admin, HR | Record or import payment disbursements batch for a payroll period with unique transaction codes and bank info. |
| GET | `/periods/:id/disbursements` | Admin, HR | Paginated list of payment disbursements for the specified period. |
| POST | `/periods/:id/reconcile` | Admin, HR | Run reconciliation comparing approved payroll slips vs completed disbursements. Detects variances (`MATCHED`, `UNPAID`, `UNDERPAID`, `OVERPAID`, `DUPLICATE`, `ORPHAN_PAYMENT`), updates period liabilities, and saves discrepancy items. |
| GET | `/periods/:id/reconciliation` | Admin, HR | Retrieve reconciliation summary, totals, and list of discrepancy items. |
| PATCH | `/reconciliation/discrepancies/:id` | Admin, HR | Update discrepancy resolution status (`PENDING`, `INVESTIGATING`, `ADJUSTED`, `RESOLVED`, `IGNORED`) with resolution notes and audit trail. |
| GET | `/periods/:id/liabilities` | Admin, HR | Retrieve payroll liabilities snapshot for the period (beginning balance, incurred payable, paid, remaining ending balance, status). |
| GET | `/liabilities/summary` | Admin, HR | Retrieve historical liabilities ledger across all payroll periods. |
| GET | `/periods/:id/accounting/export` | Admin, HR | Export accounting data in UTF-8 CSV with BOM for Excel (`type=journal`, `reconciliation`, `liabilities`, `disbursements`). Read-only; does not mutate status. |

**Invariants:**
- Journal entries must balance: total Debit exactly equals total Credit (`numeric(15, 2)`).
- Posted journal entries are immutable: database trigger `guard_posted_journal_entry` rejects updates and deletes to posted entries and lines (except reversal transition).
- Reversals never delete or edit posted entries; they create a new reversing entry and link `reversal_entry_id`.
- Journal entries can only be generated from `APPROVED` or `CLOSED` payroll periods.
- Exporting accounting files is strictly non-mutating and does not imply payment or transfer execution.
- Migration `018_payroll_accounting_reconciliation.sql` creates `accounting_accounts`, `accounting_rules`, `payroll_journal_entries`, `payroll_journal_entry_lines`, `payroll_disbursements`, `payroll_reconciliations`, `payroll_reconciliation_discrepancies`, `payroll_liabilities`, and `guard_posted_journal_entry` trigger.

## EMP-003 — Employee Profile Enhancements, Documents & Batch Import

All operations operate under `/api/organizations/:organizationId`. Tenant isolation is strictly enforced via `organization_id` on all tables, operations, and foreign keys. File storage enforces magic-byte inspection (JPEG, PNG, PDF, XLSX, CSV), path sanitization, tenant directory scoping, and role-based authorization. Sensitive personal documents and uploaded files are never publicly accessible. Work history records are permanent and immutable (cannot be deleted).

### Avatar Management
Personal account avatars are available to every signed-in account, including administrators with no employee profile. JPG/PNG uploads are limited to 10MB, stored under the user ID, and audited as `USER_PROFILE_AVATAR_UPDATED`. The self-service content route is owner-only; organization member-avatar routes apply the existing member visibility rules. Invitation rows include avatar URLs only for active members of that same organization. Migration `015_user_profile_avatar.sql` adds the nullable `users.avatar_url` path.

| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/employees/me` | Authenticated user | Resolve the current user's linked employee profile and avatar URL in the selected organization. Returns 404 when no employee profile is linked. |
| POST | `/employees/:employeeId/avatar` | Admin, HR, Employee (self) | Upload avatar (JPEG/PNG, max 5MB). Content passed via base64 `contentBase64`. Magic bytes inspected. |
| GET | `/employees/:employeeId/avatar` | Admin, HR, Manager (in scope), Employee (self) | Stream employee avatar image with strict tenant isolation. |

### Enriched Work History
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/employees/:employeeId/work-history` | Admin, HR, Manager (in scope), Employee (self) | Retrieve paginated work history timeline with `eventType` (`ASSIGNMENT_CHANGED`, `TRANSFER`, `APPOINTMENT`, `PROMOTION`, `AWARD`, `DISCIPLINE`, etc.), `title`, and `notes`. |
| POST | `/employees/:employeeId/work-history` | Admin, HR | Record work history event, appointment, promotion, transfer, or award. Deletions are forbidden by database trigger `guard_work_history_delete`. |

### Employee Documents
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/employees/:employeeId/documents` | Admin, HR, Manager (in scope), Employee (self) | List attached employee documents (`id`, `fileName`, `fileSize`, `mimeType`, `documentType`, `description`, `createdAt`). |
| POST | `/employees/:employeeId/documents` | Admin, HR, Employee (self) | Upload employee document (PDF, JPEG, PNG, XLSX, CSV, max 10MB). Magic bytes validated. |
| GET | `/employees/:employeeId/documents/:documentId/download` | Admin, HR, Manager (in scope), Employee (self) | Authenticated, secure stream download of employee document. |
| DELETE | `/employees/:employeeId/documents/:documentId` | Admin, HR | Delete attached document and purge physical disk storage. |

### Batch Employee Import (Excel / CSV)
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/employees-import/template` | Admin, HR | Download XLSX template (`mau_nhap_nhan_vien.xlsx`) with a data sheet and Vietnamese column guide; the existing CSV import remains supported. |
| POST | `/employees-import/preview` | Admin, HR | Parse uploaded CSV/XLSX file, validate required fields and dates, check for duplicate employee codes and emails within tenant, return row-level preview. |
| POST | `/employees-import/execute` | Admin, HR | Atomically batch-insert validated employee rows, creating employee records, initial work history snapshots, and audit events. |

Migration `014_employee_profile_documents_import.sql` adds `avatar_url` to `employees`, adds `event_type`, `title`, and `notes` to `employee_work_history`, adds the `guard_work_history_delete` trigger, and creates the `employee_documents` table with strict MIME type constraints.

## EMP-004 — Employee QR Code Badge, Public Digital Card & Bank Account Management

Employees can have associated banking details (bank name, account number, account holder name). The current roster QR is a local-only URL preview: organization ID and employee code are placed in the URL fragment, which is not sent to the server. No public employee-card API is enabled, and the previous predictable employee lookup and unauthenticated avatar routes are removed. A QR scan therefore does not disclose or retrieve employee data. A real public card requires an approved secure-link design and a reachable HTTPS origin.

| Method | Path | Access | Operation |
|---|---|---|---|
| POST | `/api/organizations/:organizationId/employees` | Admin, HR | Create employee with optional `bankName`, `bankAccountNumber`, and `bankAccountName`. |
| PATCH | `/api/organizations/:organizationId/employees/:id` | Admin, HR | Update employee details including `bankName`, `bankAccountNumber`, and `bankAccountName`. |

Migration `017_employee_bank_details.sql` adds `bank_name`, `bank_account_number`, and `bank_account_name` to `employees` with an index on `(organization_id, bank_name)`.

## PAY-004 — Payroll Compliance, Statutory Reporting & HR Cost Analytics

All compliance operations operate under `/api/organizations/:organizationId/payroll/compliance`. Access to compliance rules, company-wide statutory reports, analytics, and anomaly resolution is restricted to `ADMIN` and `HR`. Employees can only view and manage their own registered dependents.

### Statutory Compliance Rules Management
Statutory rules (`PIT_DEDUCTIONS`, `PIT_BRACKETS`, `SI_RATES`, `BASE_SALARY_STATUTORY`, `REGIONAL_MIN_WAGE`) are versioned by `effective_from` and `effective_to` dates, with verified Vietnamese legal references.

| Method | Relative path | Access | Operation |
|---|---|---|---|
| POST | `/rules/seed-defaults` | Admin, HR | Seed verified Vietnamese standard rules (Resolution 954/2020, Decree 73/2024, Decree 74/2024, Circular 111/2013). |
| GET | `/rules` | Admin, HR | List statutory rules filterable by `ruleType` and `activeDate`. |
| POST | `/rules` | Admin, HR | Create or update statutory rule with legal reference and JSON parameters. |

### Employee Dependents (Giảm trừ gia cảnh)
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/dependents` | Admin, HR, Employee (self-only) | List employee registered dependents. Filterable by `employeeId`. |
| POST | `/dependents` | Admin, HR, Employee (self-only) | Register a dependent (Child, Spouse, Parent, Other). Employee registrations default to unverified. |
| PATCH | `/dependents/:id/verify` | Admin, HR | Verify or reject dependent tax deduction eligibility. |

### Statutory Tax & Social Insurance Reports
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/pit/period/:periodId` | Admin, HR | Compute Personal Income Tax (PIT) report for payroll period: taxable income, personal and dependent deductions, statutory insurance deductions, assessable income, progressive tax, variance against slips. |
| GET | `/insurance/period/:periodId` | Admin, HR | Compute Social Insurance (SI/HI/UI/Trade Union) report: employee and employer portions, statutory caps (20x base salary for BHXH/BHYT, 20x regional minimum wage for BHTN). |
| GET | `/insurance/fluctuations` | Admin, HR | Track insurance participation fluctuations (D02-LT) for a reporting month: new enrollments and terminations. |

### HR Cost Analytics & Dashboard
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/analytics/period/:periodId` | Admin, HR | Total Cost to Company (CTC) breakdown by salary components, employer insurance and union fees; MoM variance; departmental distribution; three-way distinction between `accruedExpense`, `payableLiability`, and `disbursedPayment`. |

### Compliance Engine & Anomaly Detection
| Method | Relative path | Access | Operation |
|---|---|---|---|
| POST | `/check/:periodId` | Admin, HR | Execute automated compliance scan: minimum wage violations, missing insurance profiles, unverified dependent tax IDs, anomalous MoM wage fluctuations (>30%). |
| GET | `/anomalies` | Admin, HR | List detected compliance anomalies filterable by `periodId` and `resolutionStatus`. |
| PATCH | `/anomalies/:id/resolve` | Admin, HR | Acknowledge, resolve, or waive a compliance anomaly with audit notes. |

### Formal Reports Lifecycle & Export
Compliance reports follow a formal lifecycle (`DRAFT` -> `APPROVED` -> `LOCKED`). Only `APPROVED` or `LOCKED` reports can be exported to official CSV/Excel format. `LOCKED` reports are strictly immutable via database trigger.

| Method | Relative path | Access | Operation |
|---|---|---|---|
| POST | `/reports/generate` | Admin, HR | Generate formal compliance report (DRAFT) for tax, insurance, or cost analytics. |
| GET | `/reports` | Admin, HR | List formal compliance reports. |
| POST | `/reports/:id/approve` | Admin, HR | Formally approve report. |
| POST | `/reports/:id/lock` | Admin | Permanently lock report (trigger prevents further modifications). |
| GET | `/reports/:id/export` | Admin, HR | Export official report in UTF-8 CSV with Excel BOM. Returns 400 if report is still DRAFT. |
| GET | `/audit-logs` | Admin, HR | Retrieve compliance audit trail logs. |

Migration `019_payroll_compliance_reporting.sql` creates `compliance_statutory_rules`, `employee_dependents`, `compliance_reports`, `compliance_anomalies`, `compliance_audit_logs`, and the `guard_locked_compliance_report` trigger.

## RPT-001 Core HR & Attendance Reporting Center

Base path: `/api/organizations/:organizationId/reports`

All reporting endpoints enforce tenant isolation, role-based access control (RBAC), and management scope. Manager role access is scoped to managed departments and reporting descendants via `managementScope`. Employee role access is strictly self-only where permitted, and forbidden from organization-wide roster/structure reports.

### Report Catalog & Metadata
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/catalog` | Admin, HR, Manager, Employee | Retrieve accessible report catalog with metadata and supported filters, filtered by user's role. Auto-seeds defaults on first call. |
| POST | `/catalog/seed-defaults` | Admin, HR | Seed or update standard system report definitions (RPT-EMP-01, RPT-ORG-01, RPT-ATT-01, RPT-LEAVE-01). |

### P0 Reports
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/emp-roster` | Admin, HR, Manager (scoped) | RPT-EMP-01: Employee headcount, status distribution, department/contract breakdowns, average tenure, and paginated roster. |
| GET | `/org-structure` | Admin, HR, Manager (scoped) | RPT-ORG-01: Department tree hierarchy, active positions, manager coverage, and department staffing counts. |
| GET | `/attendance-summary` | Admin, HR, Manager (scoped), Employee (self-only) | RPT-ATT-01: Attendance & shift metrics, work schedule adherence, on-time rate, late/early minutes, and shift details. |
| GET | `/leave-summary` | Admin, HR, Manager (scoped), Employee (self-only) | RPT-LEAVE-01: Leave allowances, approved charged hours/days, remaining balances, utilization rate, and recent leave requests. |

### Shared Reporting Engine: Export & Templates
| Method | Relative path | Access | Operation |
|---|---|---|---|
| POST | `/export` | Admin, HR, Manager (scoped), Employee (self-only) | Export report data to CSV with UTF-8 BOM for Microsoft Excel. Automatically records export audit log with row count and filter parameters. |
| GET | `/templates` | Admin, HR, Manager, Employee | List saved report query/filter presets for current authenticated user. |
| POST | `/templates` | Admin, HR, Manager, Employee | Save a personalized report filter preset. |
| DELETE | `/templates/:id` | Admin, HR, Manager, Employee | Delete user-saved report filter preset. |
| GET | `/export-audit` | Admin, HR | Retrieve sensitive report export audit logs (user, report code, format, row count, filters, IP, timestamp). |

Migration `020_reporting_center_engine.sql` creates `report_catalog`, `report_saved_templates`, and `report_export_audit_logs`.

## RPT-002 — Payroll & Accounting Reporting

Base path: `/api/organizations/:organizationId/reports`

Integrated with Reporting Center (RPT-001) and inherits PAY-001, PAY-002, and PAY-003 data structures. Enforces exact BigInt cents currency arithmetic (no floating-point rounding errors), tenant isolation, strict RBAC, and department/management scoping.

### Payroll Reports (Category: PAYROLL)
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/payroll-summary` | Admin, HR, Manager (scoped), Employee (self-only) | **RPT-PAY-01**: Bảng lương tổng hợp & chi tiết theo kỳ. Returns Gross, Net, statutory deductions, allowances, bonuses, working days, status. Highlights draft vs closed period snapshot. |
| GET | `/payroll-components` | Admin, HR, Manager (scoped), Employee (self-only) | **RPT-PAY-02**: Báo cáo cơ cấu phụ cấp, thưởng & khấu trừ. Breakdowns non-taxable allowances, taxable allowances, bonuses, statutory employee insurance (8% BHXH, 1.5% BHYT, 1% BHTN), PIT deduction, and net pay. |
| GET | `/payroll-variance` | Admin, HR, Manager (scoped) | **RPT-PAY-03**: Báo cáo biến động quỹ lương giữa các kỳ. MoM net pay variance percentage and delta, headcount delta, average pay variance per employee, individual employee delta, and anomalous variance flags ($\ge 20\%$). |

### Accounting & Liability Reports (Category: ACCOUNTING)
| Method | Relative path | Access | Operation |
|---|---|---|---|
| GET | `/cost-allocation` | Admin, HR, Manager (scoped) | **RPT-ACC-01**: Báo cáo phân bổ chi phí lương theo phòng ban & đơn vị. Distributes gross salary, employer statutory insurance (21.5%), trade union fee (2%), and Total Cost to Company (CTC) mapped to Vietnamese Accounting Standards (VAS 6421 Chi phí bán hàng, VAS 6422 Chi phí quản lý doanh nghiệp). |
| GET | `/payroll-liabilities` | Admin, HR | **RPT-ACC-02**: Báo cáo công nợ lương & đối chiếu thanh toán. 3-way reconciliation between payable liabilities (TK 3341), verified disbursements (TK 1121/1111), and remaining balance; employee bank account details; settlement status (SETTLED, PARTIAL, UNPAID). |
| GET | `/journal-entries` | Admin, HR | **RPT-ACC-03**: Báo cáo sổ nhật ký bút toán kế toán lương. General ledger journal entries with multi-line debit/credit accounts, double-entry balance check (Total Debit = Total Credit), posted timestamp, reversal traceability (`reversalEntryNumber`). |

### Export & Audit Trail
All 6 reports (`RPT-PAY-01` through `RPT-PAY-03`, `RPT-ACC-01` through `RPT-ACC-03`) are fully supported by the unified export engine (`POST /export`), generating standard RFC 4180 CSV with UTF-8 BOM for Microsoft Excel compatibility and recording immutable audit entries in `report_export_audit_logs`.

Migration `021_payroll_accounting_reporting.sql` updates `report_catalog_category_check` to include `'ACCOUNTING'` and adds composite performance indexes on `payroll_slips`, `payroll_slip_items`, `payroll_disbursements`, and `payroll_journal_entries`.




