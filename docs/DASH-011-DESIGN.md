# DASH-011 dashboard design

Reference: F:/Code/CloneRea/hr-manager (read-only). User confirmed implementation in current ManagerHR localhost:3000 project.

Design retained: purple #7367f0, background #f8f7fa, white cards, text #444050, muted #8b8698, 260px sidebar/70px rail, 24px gutters, 56px toolbar, 6/3/3 top row, 6/6 reports, 4/4/4 summaries. Inline SVG icons and CSS artwork; no new dependency or external font request.

Routes: /app is dashboard; /app?view=profile retains personal profile/editor. /security, organization screens and account detail drawer remain accessible. Required MFA still prevents entry to the workspace. Sidebar groups organization/account tasks according to server permissions. Search forwards an encoded q query to the existing scoped users screen.

Data: existing permission-scoped users totals, role counts, active/locked counts, own sessions, up to 8 latest invitations, up to 5 audit events. Invitation sample bounds are shown explicitly; no total invitation count claimed. Employee loads only own sessions; Manager does not load invitations or audit. Failed resources display unavailable rather than fabricated zero. Retry is explicit. Attendance, payroll, recruitment and department statistics are not fabricated because backend modules are absent.

Verification: frontend unit/regression tests, lint, typecheck/build; isolated Edge headless fixture checks. Desktop 1440px: sidebar260, toolbar x284/y16/h56, hero x284/y96/h260, reports y380/h404, summary y808. Mobile390: body width390, no horizontal page overflow, modal navigation and Escape/focus/scroll restoration checked. Screenshots inspected. Browser fixtures do not prove live authenticated backend integration.

No backend change, production deploy, schema migration, real account mutation or delegation. Python policy runner unavailable as established in session; PR context and trusted CI/SAST not available. Release remains subject to human review.
