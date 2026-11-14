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
-- Boards of a hand run more than once (run it twice); NULL otherwise
ALTER TABLE hand_records ADD COLUMN IF NOT EXISTS run_boards JSONB;
-- Betting structure and dealer button seat, for exporting hand histories; NULL on older hands
ALTER TABLE hand_records ADD COLUMN IF NOT EXISTS betting_mode TEXT;
ALTER TABLE hand_records ADD COLUMN IF NOT EXISTS button_seat INTEGER;
-- Players who deleted the hand's session from their own results; everyone else still sees it
ALTER TABLE hand_records ADD COLUMN IF NOT EXISTS hidden_for TEXT[] NOT NULL DEFAULT '{}';
-- Players staff took off the leaderboard (test accounts, say); their own stats are unchanged
ALTER TABLE player_statistics ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;
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

-- Side bets: separate money from the chips on the table, settled with the poker at the end of the night.
-- Who is in each side bet at a table and their pick. prev_active/prev_pick are how the row stood
-- when the hand in play started, so a change made mid-hand counts from the next hand.
CREATE TABLE IF NOT EXISTS side_bet_players (
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  bet TEXT NOT NULL,
  player_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  pick TEXT,
  prev_active BOOLEAN NOT NULL DEFAULT FALSE,
  prev_pick TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, player_id, bet)
);
-- Each player's unpaid share of a side-bet pot (high card bingo, bad beat jackpot), until it is won
CREATE TABLE IF NOT EXISTS side_bet_pools (
  room_id TEXT NOT NULL,
  bet TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, bet, player_id)
);
-- What each player won (positive) or lost (negative) on a side bet in a hand
CREATE TABLE IF NOT EXISTS side_bet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  hand_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL DEFAULT 0,
  bet TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  amount NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hand_id, bet, player_id)
);
CREATE INDEX IF NOT EXISTS idx_side_bet_entries_room ON side_bet_entries (room_id, created_at);
-- Head to head: one player challenges another; once accepted, whoever does better at poker from
-- then on wins the stake. The *_start columns are each player's poker result when it was accepted.
CREATE TABLE IF NOT EXISTS side_bet_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  challenger_name TEXT,
  opponent_id TEXT NOT NULL,
  opponent_name TEXT,
  stake NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'settled', 'cancelled')),
  challenger_start NUMERIC,
  opponent_start NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_side_bet_challenges_room ON side_bet_challenges (room_id, status);
ALTER TABLE side_bet_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_bet_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_bet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_bet_challenges ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON side_bet_players, side_bet_pools, side_bet_entries, side_bet_challenges FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON side_bet_players, side_bet_pools, side_bet_entries, side_bet_challenges FROM authenticated;
  END IF;
END $$;

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

-- Each user's saved preferences, e.g. { "display": { "highContrastCards": true } }
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON user_preferences FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON user_preferences FROM authenticated;
  END IF;
END $$;
