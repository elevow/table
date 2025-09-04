-- US-043: Query Performance Optimization Migration
-- Adds strategic indexes and supporting structures for high-traffic query paths

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Strategic indexes based on common access patterns
CREATE INDEX IF NOT EXISTS idx_player_stats_user_id ON player_statistics(user_id);
CREATE INDEX IF NOT EXISTS idx_bankroll_history_player_time ON bankroll_history(player_id, created_at DESC);

-- Game history accelerators
CREATE INDEX IF NOT EXISTS idx_game_history_hand_id ON game_history(hand_id);
CREATE INDEX IF NOT EXISTS idx_game_history_started_at_desc ON game_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_history_results_total_pot ON game_history(((results->>'totalPot')::numeric));

-- Player actions accelerators
CREATE INDEX IF NOT EXISTS idx_player_actions_game_player ON player_actions(game_id, player_id);

-- Removed partial index that depended on NOW() (non-IMMUTABLE). Prefer the existing
-- timestamp index from earlier migrations or add a BRIN index if the table grows large:
-- CREATE INDEX IF NOT EXISTS idx_player_actions_timestamp_brin ON player_actions USING BRIN (timestamp);

-- Comments
COMMENT ON INDEX idx_bankroll_history_player_time IS 'US-043: Speeds up per-player history queries by time';
COMMENT ON INDEX idx_game_history_results_total_pot IS 'US-043: Supports filtering/sorting on total pot';
