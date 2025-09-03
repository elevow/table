Admin Alerts API Authentication

- All /api/admin/* routes now require an admin token header.
- Set environment variable ADMIN_API_TOKEN to a strong random value.
- Clients must include header: X-Admin-Token: <token>.

Notes
- This is a minimal guard for admin-only endpoints. Replace with your RBAC/session system in production.
- Alerts are persisted in the admin_alerts table. Run migrations to create the table.
