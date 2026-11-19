# ManagerHR frontend

React 19 + TypeScript + Vite. Install with `npm ci`, then run `npm run build`. The backend serves `frontend/dist` with the API on the same origin. For local UI development, `npm run dev` proxies `/api` to port 3000; set the backend `APP_ORIGIN` to the actual Vite origin (normally `http://localhost:5173`) for Origin validation.

Available checks: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`. The Test Engineer owns UI test cases. A successful build alone does not verify end-to-end behavior or accessibility compliance.

Routes: `/login`, `/forgot-password`, `/reset-password?token=...`, `/invite/accept?token=...`, `/admin/invitations`, and `/app`. `/register` accepts a valid invitation only; it is not public registration. Invitation and reset tokens are removed from history on page load and retained only in memory until completion. Reloading a scrubbed link requires reopening the email link. Existing users can sign in within invitation acceptance without losing the in-memory token.

No session or invitation tokens are stored in localStorage or sessionStorage. All changing requests use the backend CSRF token and cookie credentials. UI permissions improve navigation; backend authorization remains authoritative. Without SMTP, a visible DEV_ONLY banner explains that no real email is sent.
