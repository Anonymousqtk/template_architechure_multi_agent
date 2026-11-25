# Vietnamese and English localization audit

Status as of 2026-11-25: **incomplete**. English is marked partial in the UI.
This is a source-level inventory, not a browser-by-browser certification. A
page is marked partial only where it subscribes to the selected locale; all
other groups below contain fixed Vietnamese text and are not integrated.

| Page or route group                                         | Source                                                                                   | Status and observed gaps                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home / overview (`/app`)                                    | `src/pages/Dashboard/Dashboard.tsx`                                                      | Partial: many labels translated; role labels, some error information and mixed-language content remain.                                                                                                                     |
| Shared workspace and navigation                             | `src/components/layout/DashboardShell.tsx`, `src/components/navigation/WorkspaceNav.tsx` | Partial: primary navigation uses translations; several controls and secondary navigation remain fixed. Selector is available before and after login.                                                                        |
| Login                                                       | `src/App.tsx`                                                                            | Partial: login form and shared shell labels switch language; previously displayed errors still need localization.                                                                                                           |
| Password recovery and reset                                 | `src/App.tsx`                                                                            | Partial: form, validation, success messages and shared shell switch language; full browser coverage remains outstanding.                                                                                                    |
| Invitation acceptance                                       | `src/App.tsx`                                                                            | Partial: acceptance states, form and shared shell switch language; full browser coverage remains outstanding.                                                                                                               |
| Invitation management                                       | `src/App.tsx`                                                                            | Partial: form, status, feedback and dates switch language; surrounding shell and generic API error coverage remain incomplete.                                                                                              |
| Sign-in verification components                             | `src/features/auth/components/`                                                          | Partial: sign-in verification and passkey settings switch language; shared error-code coverage and surrounding security page remain incomplete.                                                                             |
| Account profile (`/app?view=profile`)                       | `src/pages/Settings/AccountProfile.tsx`                                                  | Partial: profile card, editor labels, avatar controls and avatar validation switch language; API errors still need localization.                                                                                            |
| Account security (`/security`)                              | `src/pages/Settings/AccountSecurity.tsx`                                                 | Partial: MFA, recovery, session text and recovery-file instructions switch language; some API errors and full browser coverage remain outstanding.                                                                          |
| Users, audit and detail                                     | `src/pages/Users/Users.tsx`, `src/features/users/`                                       | Partial: list, audit and account-detail labels switch language; shared API errors and full browser coverage remain outstanding.                                                                                             |
| Units                                                       | `src/pages/Organization/Units.tsx`                                                       | Partial: page labels, forms, statuses, confirmations and three unit-specific API errors switch language; other shared API errors still need localization.                                                                   |
| Job title catalog                                           | `src/pages/Organization/JobTitlesPanel.tsx`                                              | Partial: catalog and form labels switch language; shared API errors and wider browser coverage remain outstanding.                                                                                                          |
| Organization, departments, positions and organization chart | `src/pages/Organization/`                                                                | Partial: chart, navigation and department form switch languages; positions, organization settings and other feedback remain incomplete.                                                                                     |
| Employees and employee card                                 | `src/pages/Employees/`, `src/features/employees/`                                        | Partial: list, import, QR, core detail, contract, history, document, salary and insurance labels switch language; detail dates follow locale. Some dynamic text, server-supplied errors and API feedback remain incomplete. |
| Attendance, shifts, leave types and attendance policy       | `src/pages/Attendance/Attendance.tsx`                                                    | Partial: navigation, status labels and date/time formatting follow language; forms and feedback remain incomplete.                                                                                                          |
| Payroll, components, accounting, payslips and compliance    | `src/pages/Payroll/Payroll.tsx`                                                          | Partial: main navigation switches language; tables, controls, notifications and dates remain incomplete.                                                                                                                    |
| Reporting center                                            | `src/pages/Reporting/ReportingCenter.tsx`                                                | Partial: navigation, audit headings and common filters switch language; report contents, feedback and remaining formatting require work.                                                                                    |
| Sensitive-action confirmation                               | `src/components/common/SensitiveActionConfirmation.tsx`                                  | Partial: verification instructions, controls and displayed error change with the selected language; shared error messages retain the limitations below.                                                                     |

Cross-cutting gaps: `src/services/api.ts` supplies English for selected error
codes and a generic English fallback for other codes. Many screens store the
rendered error string, so changing language after an error does not yet update
that existing message. Full code-specific English coverage remains outstanding;
`src/features/users/account-types.ts` and `src/features/employees/employee-types.ts`
contain shared labels; dynamic server-supplied content must not be translated as
though it were application text. Existing tests cover the selector, persistence,
navigation and part of the dashboard, but not end-to-end language coverage.

Review method: enumerated production TypeScript and TSX files, traced route
branches in `src/App.tsx`, searched for localization subscriptions, fixed locale
formatting and shared error/role labels, then inspected representative source.
The presence or absence of Vietnamese characters alone is not a completeness
test: interpolation, English-only strings, dynamic error messages and user data
need individual review. Neither the audit nor the current tests establish full
coverage or translation accuracy.

## TECH-011 automated inventory

The AST inventory counts potential hardcoded JSX text and selected literal accessibility attributes in production TSX. Counts include false positives and do not establish completeness. Dynamic expressions, notifications, API messages, feature dictionaries and interpolation need separate review. Run `npm run i18n:check` for locations.

| Component                                                | Potential strings |
| -------------------------------------------------------- | ----------------: |
| `App.tsx`                                                |                 6 |
| `components/layout/DashboardShell.tsx`                   |                 9 |
| `features/auth/components/PasskeySettings.tsx`           |                 1 |
| `features/employees/components/EmployeeDetailDrawer.tsx` |                 8 |
| `features/employees/components/EmployeeQrBadge.tsx`      |                 1 |
| `features/users/components/AccountDetailDrawer.tsx`      |                 1 |
| `i18n/LanguageSelector.tsx`                              |                 2 |
| `pages/Attendance/Attendance.tsx`                        |               110 |
| `pages/Dashboard/Dashboard.tsx`                          |                 2 |
| `pages/Employees/EmployeeCardPage.tsx`                   |                 1 |
| `pages/Employees/Employees.tsx`                          |                 5 |
| `pages/Organization/OrganizationView.tsx`                |                59 |
| `pages/Payroll/Payroll.tsx`                              |               102 |
| `pages/Reporting/ReportingCenter.tsx`                    |               217 |
| `pages/Settings/AccountProfile.tsx`                      |                 1 |
