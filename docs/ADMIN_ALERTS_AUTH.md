Admin API Authentication

- All /api/admin/* routes require a signed-in admin session, checked by `requireAdminSession` in src/lib/auth/auth-utils.ts.
- A user is an admin when their account email is listed in the ADMIN_EMAILS environment variable (comma-separated).
- Clients send the session token as `Authorization: Bearer <token>` (the admin pages do this via `authHeaders()`).
- Responses: 401 when not signed in, 403 when signed in but not an admin.

Notes
- Alerts are persisted in the admin_alerts table. Run migrations to create the table.
