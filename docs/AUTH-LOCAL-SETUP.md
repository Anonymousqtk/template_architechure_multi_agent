# AUTH-001 local operation

Implementation uses PostgreSQL, an Express/TypeScript API and a same-origin frontend. This document is a local development guide; production rollout remains subject to human review and the required CI gate.

## Database

Use a dedicated local PostgreSQL database. Apply `database/migrations/001_auth_invitation_schema.sql` followed by `002_auth_controls.sql` with `psql -v ON_ERROR_STOP=1`. Do not run these commands against production during agent work. The disposable migration check is documented in `database/README.md`.

## Backend and frontend

Install each workspace with `npm ci`. Read `backend/.env.example` for configuration. Build the frontend before starting the backend so that UI and API share one origin. Never put server secrets in frontend environment variables.

Bootstrap of the first organization Admin is an operator action. Review the CLI and obtain approval before running it; there are no default credentials and no anonymous bootstrap endpoint.

Without SMTP the application explicitly reports DEV_ONLY delivery. No real invitation or reset email has been sent in this mode. Test fixtures may capture links in memory; production logs and database records must never contain raw invitation/reset tokens.

## Release gate

Local tests do not replace CI, independent human review, or staging SMTP verification. Require trusted HTTPS, secret management, backups, monitored SMTP and abuse controls before rollout. No production migration, deployment, or Admin provisioning is authorized by this implementation task.


## AUTH-003 local MFA

The local preview now requires Admin/HR to finish MFA before opening management pages. Visit http://localhost:3000/security, enter your current password, add the displayed manual TOTP key to an Authenticator app, enter its6-digit code, then save the10 one-time recovery codes. The agent did not enroll a factor for your real local account. The local encryption key is already generated in ignored backend/.env and was not displayed; preserve this file securely.

The Security page lists/revokes own sessions, allows password+factor reauthentication for sensitive actions, and regenerates recovery codes while a factor is available. MFA setup/login may require waiting for a new30-second OTP if the previous code was already consumed. Reauthentication and recovery proof never log raw secrets. No credentials need to be pasted into chat.
