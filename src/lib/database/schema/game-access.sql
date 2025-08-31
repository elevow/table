-- US-067: Game Access Control - Schema and RLS Policies
-- Implements row-level security for game data so only participating players (or spectators of public games)
-- can access appropriate information, and protects hole cards until showdown.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core room table (aligned with US-020 Game Rooms)
CREATE TABLE IF NOT EXISTS game_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    game_type TEXT NOT NULL,
    max_players INTEGER NOT NULL,
    blind_levels JSONB NOT NULL DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'waiting',
    configuration JSONB,
    -- Visibility flag to support spectator access
    is_public BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_game_rooms_created_at ON game_rooms(created_at);
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms(status);

-- Active games table (acts as our "games" for access control purposes)
CREATE TABLE IF NOT EXISTS active_games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    current_hand_id UUID,
    dealer_position INTEGER NOT NULL,
    current_player_position INTEGER NOT NULL,
    pot NUMERIC NOT NULL DEFAULT 0,
    state JSONB,
    last_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_active_games_room_id ON active_games(room_id);
CREATE INDEX IF NOT EXISTS idx_active_games_last_action ON active_games(last_action_at DESC);

-- Player-game participation and per-player state (US-070 technical notes adapted)
CREATE TABLE IF NOT EXISTS player_games (
    game_id UUID NOT NULL REFERENCES active_games(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    stack INTEGER NOT NULL,
    current_bet INTEGER DEFAULT 0,
    folded BOOLEAN DEFAULT FALSE,
    all_in BOOLEAN DEFAULT FALSE,
    cards JSONB DEFAULT '[]', -- hole cards stored securely here
    last_action TEXT,
    last_action_time TIMESTAMPTZ,
    PRIMARY KEY (game_id, user_id),
    CONSTRAINT valid_position CHECK (position >= 0 AND position < 9)
);

CREATE INDEX IF NOT EXISTS idx_player_games_user ON player_games(user_id);
CREATE INDEX IF NOT EXISTS idx_player_games_game ON player_games(game_id);

-- Enable RLS on active_games and player_games
ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_games ENABLE ROW LEVEL SECURITY;

-- Policy: Players can view active games they're in
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'active_games' AND policyname = 'players_can_view_their_games'
    ) THEN
        EXECUTE $$
            CREATE POLICY players_can_view_their_games
            ON active_games FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM player_games pg
                    WHERE pg.game_id = id
                      AND pg.user_id = (current_setting('app.current_user_id', true))::uuid
                )
            )
        $$;
    END IF;
END$$;

-- Policy: Spectators can view public games (room is marked is_public)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'active_games' AND policyname = 'spectators_can_view_public_games'
    ) THEN
        EXECUTE $$
            CREATE POLICY spectators_can_view_public_games
            ON active_games FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM game_rooms gr
                    WHERE gr.id = room_id AND gr.is_public = TRUE
                )
            )
        $$;
    END IF;
END$$;

-- Policy: Players can view their own player_games rows
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'player_games' AND policyname = 'player_games_self_select'
    ) THEN
        EXECUTE $$
            CREATE POLICY player_games_self_select
            ON player_games FOR SELECT
            USING (user_id = (current_setting('app.current_user_id', true))::uuid)
        $$;
    END IF;
END$$;

-- Optional: Allow players to update their own state (position/stack/bets) if needed by engine via SQL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'player_games' AND policyname = 'player_games_self_update'
    ) THEN
        EXECUTE $$
            CREATE POLICY player_games_self_update
            ON player_games FOR UPDATE
            USING (user_id = (current_setting('app.current_user_id', true))::uuid)
        $$;
    END IF;
END$$;

-- Redacted view: exposes player state but protects hole cards until showdown for non-owners.
-- Spectators see rows of public games only. Players see their games regardless of public flag.
CREATE OR REPLACE VIEW player_games_redacted AS
SELECT
  pg.game_id,
  pg.user_id,
  pg.position,
  pg.stack,
  pg.current_bet,
  pg.folded,
  pg.all_in,
  CASE
    WHEN pg.user_id = (current_setting('app.current_user_id', true))::uuid
      OR COALESCE(ag.state->>'phase', '') = 'showdown'
      THEN pg.cards
    ELSE '[]'::jsonb
  END AS cards,
  pg.last_action,
  pg.last_action_time
FROM player_games pg
JOIN active_games ag ON ag.id = pg.game_id
JOIN game_rooms gr ON gr.id = ag.room_id
WHERE (
  -- Player of the game
  EXISTS (
    SELECT 1 FROM player_games self
    WHERE self.game_id = pg.game_id
      AND self.user_id = (current_setting('app.current_user_id', true))::uuid
  )
  OR
  -- Or spectator of a public game
  gr.is_public = TRUE
);

COMMENT ON VIEW player_games_redacted IS 'Player view with hole cards redacted unless owner or showdown; spectators see only public games.';
