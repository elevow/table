-- Tournaments run through /api/tournaments.
-- Idempotent: scripts/db-migrate.js runs every schema file on each invocation.
-- The server reaches this through its own connection; the public API roles get no access.

-- One row per tournament. state is the whole TournamentState (src/types/tournament-management.ts);
-- name and status are copied out of it for listing. Every change locks the row (SELECT ... FOR UPDATE),
-- applies the rule and writes state back, so concurrent requests on different instances can't interleave.
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status, created_at DESC);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tournaments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tournaments FROM authenticated;
  END IF;
END $$;
