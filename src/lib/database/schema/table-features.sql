-- Hand records, chip ledger and player notes for the table page.
-- Idempotent: scripts/db-migrate.js runs every schema file on each invocation.
-- The server reaches these through its own connection; the public API roles get no access.

-- One row per completed hand, written by the server when the hand ends.
-- id is the engine's hand id, so a hand finished by two requests at once is stored once.
CREATE TABLE IF NOT EXISTS hand_records (
  id UUID PRIMARY KEY,
  room_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  variant TEXT,
  kind TEXT NOT NULL DEFAULT 'normal',
  small_blind NUMERIC NOT NULL DEFAULT 0,
  big_blind NUMERIC NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  board JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ id, name, seat, startStack, endStack, net, won, folded, cards, revealed }]
  -- cards are every dealt card; the API returns them only to their owner or when revealed
  players JSONB NOT NULL,
  -- [{ playerId, action, amount, put, stage, auto }]
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  winners JSONB NOT NULL DEFAULT '[]'::jsonb,
  pot NUMERIC NOT NULL DEFAULT 0,
  player_ids TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_hand_records_room_ended ON hand_records (room_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_hand_records_player_ids ON hand_records USING GIN (player_ids);

-- Chips each player brought to and took from a table, for the end-of-night settlement.
CREATE TABLE IF NOT EXISTS chip_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('buy_in', 'rebuy', 'cash_out')),
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chip_ledger_room ON chip_ledger (room_id, created_at);

-- Private notes a player keeps about other players; only the owner ever sees them.
CREATE TABLE IF NOT EXISTS player_notes (
  owner_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  color TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, subject_id)
);

ALTER TABLE hand_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE chip_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON hand_records, chip_ledger, player_notes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON hand_records, chip_ledger, player_notes FROM authenticated;
  END IF;
END $$;
