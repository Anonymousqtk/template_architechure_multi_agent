# ManagerHR frontend

React 19 + TypeScript + Vite. Install with `npm ci`, then run `npm run build`. The backend serves `frontend/dist` with the API on the same origin. For local UI development, `npm run dev` proxies `/api` to port 3000; set the backend `APP_ORIGIN` to the actual Vite origin (normally `http://localhost:5173`) for Origin validation.

Source is organized by responsibility: `src/pages` contains application screens,
`src/components` shared UI and layout, `src/features` feature-specific components
and types, `src/hooks` reusable hooks, `src/services` API access, `src/utils`
utilities, and `src/assets/styles` shared styles. Tests live beside their modules.
`App.tsx` retains the existing authentication and route handling; `main.tsx` is
the entry point. Public fonts remain in `public/fonts` to preserve their URLs.

The language selector currently translates part of the workspace navigation only.
Vietnamese remains the default; the selected language is stored in the browser.
Other screens and messages still need Vietnamese and English translation before
the English interface can be considered complete. Add translations to `src/i18n`
for new user-facing text, including accessible labels and error messages.

Available checks: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`. The Test Engineer owns UI test cases. A successful build alone does not verify end-to-end behavior or accessibility compliance.

Routes: `/login`, `/forgot-password`, `/reset-password?token=...`, `/invite/accept?token=...`, `/admin/invitations`, and `/app`. `/register` accepts a valid invitation only; it is not public registration. Invitation and reset tokens are removed from history on page load and retained only in memory until completion. Reloading a scrubbed link requires reopening the email link. Existing users can sign in within invitation acceptance without losing the in-memory token.

No session or invitation tokens are stored in localStorage or sessionStorage. All changing requests use the backend CSRF token and cookie credentials. UI permissions improve navigation; backend authorization remains authoritative. Without SMTP, a visible DEV_ONLY banner explains that no real email is sent.
