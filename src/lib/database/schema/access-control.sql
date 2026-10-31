-- Roles, permissions and the admin audit log.
-- Idempotent: scripts/db-migrate.js runs every schema file on each invocation.
-- Permission keys are defined in src/lib/auth/permissions.ts; '*' grants every permission.
-- Every signed-in user implicitly has the 'player' role and signed-out visitors the 'guest' role,
-- so access_user_roles only holds the extra roles a user was given.
-- Tables are prefixed access_ because the unused data-protection service already claims
-- user_roles and audit_log.

CREATE TABLE IF NOT EXISTS access_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  -- Higher ranks can assign lower ones; nobody can assign a role above their own rank
  rank INTEGER NOT NULL DEFAULT 0,
  built_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_role_permissions (
  role_id UUID NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS access_user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  granted_by UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_access_user_roles_role ON access_user_roles (role_id);

-- Per-user exceptions to their roles: 'grant' adds a permission, 'deny' removes it (deny wins)
CREATE TABLE IF NOT EXISTS access_user_overrides (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log (created_at DESC);

-- Numeric limits (keys in LIMIT_DEFS). A role without a row for a limit leaves it to the user's
-- other roles; a NULL value means no limit. The most generous of a user's roles applies.
CREATE TABLE IF NOT EXISTS access_role_limits (
  role_id UUID NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
  limit_key TEXT NOT NULL,
  value INTEGER CHECK (value IS NULL OR value >= 0),
  PRIMARY KEY (role_id, limit_key)
);

-- A user's own limit replaces their roles' (NULL: no limit)
CREATE TABLE IF NOT EXISTS access_user_limits (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  limit_key TEXT NOT NULL,
  value INTEGER CHECK (value IS NULL OR value >= 0),
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, limit_key)
);

-- Bans and suspensions. Either leaves the user only what signed-out visitors can do;
-- a ban also signs them out and stops them signing in. Suspensions always end (until);
-- bans end only if until is set. Lifted ones are kept for the record.
CREATE TABLE IF NOT EXISTS access_user_sanctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ban', 'suspend')),
  reason TEXT,
  until TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lifted_at TIMESTAMPTZ,
  lifted_by UUID,
  CHECK (kind = 'ban' OR until IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_access_user_sanctions_user ON access_user_sanctions (user_id) WHERE lifted_at IS NULL;

-- Built-in roles. Each grant list is inserted only together with its role, so a role edited
-- in the admin page keeps its edits when this file runs again.
WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('guest', 'Guest', 'Signed-out visitors', 0, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p FROM r, unnest(ARRAY[
  'lobby.view', 'table.view', 'tournament.view'
]) AS p;

WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('player', 'Player', 'Every signed-in user', 10, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p FROM r, unnest(ARRAY[
  'lobby.view', 'table.view', 'table.spectate_chat',
  'table.join', 'table.waitlist', 'game.play', 'game.straddle', 'game.run_it_twice',
  'game.rabbit_hunt', 'game.show_cards', 'game.rebuy', 'game.react',
  'room.create', 'room.create_private', 'room.configure', 'room.choose_variant', 'room.start',
  'room.approve_seat', 'room.kick_player', 'room.transfer_host', 'room.view_ledger',
  'tournament.view', 'tournament.register',
  'chat.send', 'chat.private', 'chat.delete_own', 'friends.use', 'profile.upload_avatar',
  'history.view_own', 'history.export', 'stats.hud', 'stats.view_others', 'rit.verify'
]) AS p;

WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('host', 'Host', 'Trusted hosts; can also correct their table''s ledger', 20, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p FROM r, unnest(ARRAY[
  'room.create', 'room.create_private', 'room.configure', 'room.choose_variant', 'room.start',
  'room.approve_seat', 'room.kick_player', 'room.transfer_host',
  'room.view_ledger', 'room.edit_ledger'
]) AS p;

WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('tournament_director', 'Tournament Director', 'Creates and runs tournaments', 30, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p FROM r, unnest(ARRAY[
  'tournament.create', 'tournament.manage', 'tournament.eliminate', 'tournament.payouts',
  'tournament.report'
]) AS p;

WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('moderator', 'Moderator', 'Keeps chat and tables civil', 40, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p FROM r, unnest(ARRAY[
  'admin.access', 'admin.rooms.view', 'admin.users.view', 'admin.users.suspend',
  'admin.alerts.view', 'table.view_private', 'chat.delete_any', 'chat.moderate', 'avatar.moderate'
]) AS p;

-- Everything except editing roles and impersonating users
WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('admin', 'Admin', 'Runs the site day to day', 80, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, p FROM r, unnest(ARRAY[
  'lobby.view', 'table.view', 'table.view_private', 'table.view_hole_cards', 'table.spectate_chat',
  'table.join', 'table.join_private', 'table.waitlist', 'game.play', 'game.straddle',
  'game.run_it_twice', 'game.rabbit_hunt', 'game.show_cards', 'game.rebuy', 'game.react',
  'room.create', 'room.create_private', 'room.configure', 'room.choose_variant', 'room.start',
  'room.approve_seat', 'room.kick_player', 'room.transfer_host',
  'room.view_ledger', 'room.edit_ledger',
  'tournament.view', 'tournament.register', 'tournament.create', 'tournament.manage',
  'tournament.eliminate', 'tournament.payouts', 'tournament.report',
  'chat.send', 'chat.private', 'chat.delete_own', 'chat.delete_any', 'chat.moderate',
  'friends.use', 'profile.upload_avatar', 'avatar.moderate',
  'history.view_own', 'history.view_any', 'history.export', 'stats.hud', 'stats.view_others',
  'rit.verify',
  'admin.access', 'admin.rooms.view', 'admin.rooms.manage', 'admin.users.view', 'admin.users.ban',
  'admin.users.suspend', 'admin.users.reset_password', 'admin.chips.adjust', 'admin.alerts.view',
  'admin.alerts.resolve', 'admin.security.config', 'admin.audit_log.view', 'admin.announcements',
  'roles.view', 'roles.assign'
]) AS p;

-- Users listed in ADMIN_EMAILS are always treated as super admins, so the site can't be locked out
WITH r AS (
  INSERT INTO access_roles (key, name, description, rank, built_in)
  VALUES ('super_admin', 'Super Admin', 'Every permission, including editing roles', 100, TRUE)
  ON CONFLICT (key) DO NOTHING RETURNING id
)
INSERT INTO access_role_permissions (role_id, permission)
SELECT r.id, '*' FROM r;

-- Built-in limits, seeded once: only while no role has any limit, so later edits are kept
INSERT INTO access_role_limits (role_id, limit_key, value)
SELECT r.id, l.limit_key, l.value
FROM (VALUES
  ('player', 'rooms.per_day', 10),
  ('player', 'tables.max_seated', 4),
  ('player', 'chat.per_minute', 20),
  ('host', 'rooms.per_day', NULL),
  ('moderator', 'chat.per_minute', NULL),
  ('admin', 'rooms.per_day', NULL),
  ('admin', 'tables.max_seated', NULL),
  ('admin', 'chat.per_minute', NULL),
  ('super_admin', 'rooms.per_day', NULL),
  ('super_admin', 'tables.max_seated', NULL),
  ('super_admin', 'chat.per_minute', NULL)
) AS l(role_key, limit_key, value)
JOIN access_roles r ON r.key = l.role_key
WHERE NOT EXISTS (SELECT 1 FROM access_role_limits);

ALTER TABLE access_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_user_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_role_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_user_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_user_sanctions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON access_roles, access_role_permissions, access_user_roles,
      access_user_overrides, admin_audit_log, access_role_limits, access_user_limits,
      access_user_sanctions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON access_roles, access_role_permissions, access_user_roles,
      access_user_overrides, admin_audit_log, access_role_limits, access_user_limits,
      access_user_sanctions FROM authenticated;
  END IF;
END $$;
