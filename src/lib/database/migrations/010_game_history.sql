
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Main game history table as specified in US-010
CREATE TABLE IF NOT EXISTS game_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL,
    hand_id UUID NOT NULL,
    action_sequence JSONB NOT NULL,
    community_cards TEXT[] NOT NULL DEFAULT '{}',
    results JSONB NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Additional table for player actions analytics
CREATE TABLE IF NOT EXISTS player_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES game_history(id) ON DELETE CASCADE,
    player_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('fold', 'check', 'call', 'bet', 'raise', 'all-in')),
    amount DECIMAL(15,2) DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    position INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying as per US-011 requirements
CREATE INDEX IF NOT EXISTS idx_game_history_table_id ON game_history(table_id);
CREATE INDEX IF NOT EXISTS idx_game_history_hand_id ON game_history(hand_id);
CREATE INDEX IF NOT EXISTS idx_game_history_started_at ON game_history(started_at);
CREATE INDEX IF NOT EXISTS idx_game_history_ended_at ON game_history(ended_at);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_game_history_table_date ON game_history(table_id, started_at);
CREATE INDEX IF NOT EXISTS idx_game_history_date_range ON game_history(started_at, ended_at);

-- Player actions indexes for analytics
CREATE INDEX IF NOT EXISTS idx_player_actions_game_id ON player_actions(game_id);
CREATE INDEX IF NOT EXISTS idx_player_actions_player_id ON player_actions(player_id);
CREATE INDEX IF NOT EXISTS idx_player_actions_timestamp ON player_actions(timestamp);
CREATE INDEX IF NOT EXISTS idx_player_actions_action ON player_actions(action);

-- Composite index for player analytics
CREATE INDEX IF NOT EXISTS idx_player_actions_player_timestamp ON player_actions(player_id, timestamp);

-- JSONB indexes for efficient querying of action sequences and results
CREATE INDEX IF NOT EXISTS idx_game_history_action_sequence_gin ON game_history USING GIN (action_sequence);
CREATE INDEX IF NOT EXISTS idx_game_history_results_gin ON game_history USING GIN (results);

-- Functional indexes for common analytics queries
CREATE INDEX IF NOT EXISTS idx_game_history_total_pot ON game_history(((results->>'totalPot')::numeric));
CREATE INDEX IF NOT EXISTS idx_game_history_winner_count ON game_history((jsonb_array_length(results->'winners')));

-- Removed partial index that used NOW() in predicate (non-IMMUTABLE). Use the existing
-- started_at index above, or consider a BRIN index for very large tables:
-- CREATE INDEX IF NOT EXISTS idx_game_history_started_at_brin ON game_history USING BRIN (started_at);

-- Comments for documentation
COMMENT ON TABLE game_history IS 'US-010: Records detailed game history for replay and analysis features';
COMMENT ON COLUMN game_history.action_sequence IS 'JSONB array of all player actions during the hand';
COMMENT ON COLUMN game_history.community_cards IS 'Array of community cards dealt';
COMMENT ON COLUMN game_history.results IS 'JSONB object containing hand results, winners, and pot distribution';

COMMENT ON TABLE player_actions IS 'Normalized player actions for efficient analytics queries';
COMMENT ON COLUMN player_actions.action IS 'Player action type: fold, check, call, bet, raise, all-in';
COMMENT ON COLUMN player_actions.amount IS 'Bet/raise amount (0 for fold/check/call)';

-- Create a view for simplified game history queries
CREATE OR REPLACE VIEW game_history_summary AS
SELECT 
    gh.id,
    gh.table_id,
    gh.hand_id,
    gh.started_at,
    gh.ended_at,
    (gh.ended_at - gh.started_at) as duration,
    (gh.results->>'totalPot')::numeric as total_pot,
    (gh.results->>'rake')::numeric as rake,
    jsonb_array_length(gh.results->'winners') as winner_count,
    array_length(gh.community_cards, 1) as community_card_count,
    jsonb_array_length(gh.action_sequence) as action_count
FROM game_history gh;

COMMENT ON VIEW game_history_summary IS 'Simplified view of game history with calculated fields for analytics';

-- Create a function for efficient player statistics
CREATE OR REPLACE FUNCTION get_player_game_stats(
    p_player_id UUID,
    p_date_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_date_to TIMESTAMP WITH TIME ZONE DEFAULT NULL
) 
RETURNS TABLE(
    total_hands BIGINT,
    total_winnings NUMERIC,
    average_winnings NUMERIC,
    hands_won BIGINT,
    win_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT gh.id) as total_hands,
        COALESCE(SUM(
            CASE 
                WHEN w.value->>'playerId' = p_player_id::text 
                THEN (w.value->>'winAmount')::numeric 
                ELSE 0 
            END
        ), 0) as total_winnings,
        COALESCE(AVG(
            CASE 
                WHEN w.value->>'playerId' = p_player_id::text 
                THEN (w.value->>'winAmount')::numeric 
                ELSE 0 
            END
        ), 0) as average_winnings,
        COUNT(DISTINCT 
            CASE 
                WHEN w.value->>'playerId' = p_player_id::text AND (w.value->>'winAmount')::numeric > 0
                THEN gh.id 
            END
        ) as hands_won,
        CASE 
            WHEN COUNT(DISTINCT gh.id) > 0 
            THEN ROUND(
                COUNT(DISTINCT 
                    CASE 
                        WHEN w.value->>'playerId' = p_player_id::text AND (w.value->>'winAmount')::numeric > 0
                        THEN gh.id 
                    END
                )::numeric / COUNT(DISTINCT gh.id)::numeric * 100, 
                2
            )
            ELSE 0
        END as win_rate
    FROM game_history gh
    CROSS JOIN LATERAL jsonb_array_elements(gh.results->'winners') w(value)
    WHERE (gh.action_sequence::text LIKE '%"playerId":"' || p_player_id || '"%' 
           OR gh.results::text LIKE '%"playerId":"' || p_player_id || '"%')
      AND (p_date_from IS NULL OR gh.started_at >= p_date_from)
      AND (p_date_to IS NULL OR gh.started_at <= p_date_to);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_player_game_stats IS 'US-010: Calculate player statistics from game history efficiently';

-- Create trigger for automatic cleanup of very old records (optional)
CREATE OR REPLACE FUNCTION cleanup_old_game_history() 
RETURNS TRIGGER AS $$
BEGIN
    -- Delete records older than 2 years to manage storage
    DELETE FROM game_history 
    WHERE started_at < NOW() - INTERVAL '2 years';
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled cleanup trigger (runs on insert, but with condition to avoid frequent execution)
CREATE OR REPLACE FUNCTION cleanup_old_game_history_if_needed()
RETURNS TRIGGER AS $$
BEGIN
    -- Only perform cleanup once per day (skip if any row was created in the last day besides the new one)
    IF (
        SELECT COUNT(*) = 0
        FROM game_history
        WHERE created_at > NOW() - INTERVAL '1 day'
          AND id <> NEW.id
    ) THEN
        DELETE FROM game_history
        WHERE started_at < NOW() - INTERVAL '2 years';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotent trigger creation
DROP TRIGGER IF EXISTS trg_cleanup_old_game_history ON game_history;
CREATE TRIGGER trg_cleanup_old_game_history
AFTER INSERT ON game_history
FOR EACH ROW
EXECUTE FUNCTION cleanup_old_game_history_if_needed();
