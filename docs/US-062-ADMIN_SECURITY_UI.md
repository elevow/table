# US-062: Admin UI for Live Security Config and Scheduler Controls

Scope
- Live, runtime-adjustable security configuration (in-memory overrides).
- Admin API to read/update effective config.
- Admin UI page to view/edit overrides and control the security scheduler.

Key Endpoints (admin-only; require `X-Admin-Token`)
- GET /api/admin/security/config → { config, overrides }
- PATCH /api/admin/security/config → apply overrides or `{ clear: true }`
- GET /api/admin/security/scheduler → { lastRun }
- POST /api/admin/security/scheduler { action: 'start'|'stop'|'runOnce' }

UI
- Page: /admin/security
- Store admin token in localStorage (`adminToken`).
- Shows effective config and current overrides; edit overrides JSON and save/clear.
- Buttons for Start/Stop/Run once; shows lastRun timestamp.

Tech Notes
- Runtime overrides module: `src/lib/security/security-config-runtime.ts`.
- Effective config merges env/defaults with overrides via `getLiveSecurityConfig()`.
- Analyzer and scheduler read live config (no restart needed).
- Admin routes guarded by `src/lib/api/admin-auth.ts`.

Security
- Minimal header-based guard for admin endpoints. Replace with RBAC/session auth in production.
