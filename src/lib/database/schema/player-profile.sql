-- US-009: Player Profile Storage Schema
-- Comprehensive player profile management with bankroll history and game statistics

-- Main players table
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    bankroll DECIMAL(15,2) NOT NULL DEFAULT 0,
    stats JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token UUID,
    reset_token UUID,
    reset_token_expires TIMESTAMP WITH TIME ZONE
);

-- Bankroll history for tracking balance changes
CREATE TABLE IF NOT EXISTS bankroll_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL, -- 'deposit', 'withdrawal', 'game_win', 'game_loss', 'rake'
    description TEXT,
    game_id UUID, -- Reference to specific game/hand if applicable
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Player game statistics (detailed stats beyond the JSONB field)
CREATE TABLE IF NOT EXISTS player_game_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_type VARCHAR(50) NOT NULL, -- 'texas_holdem', 'omaha', etc.
    stakes_level VARCHAR(50) NOT NULL, -- '1/2', '2/5', etc.
    hands_played INTEGER DEFAULT 0,
    total_profit DECIMAL(15,2) DEFAULT 0,
    biggest_win DECIMAL(15,2) DEFAULT 0,
    biggest_loss DECIMAL(15,2) DEFAULT 0,
    vpip DECIMAL(5,2) DEFAULT 0, -- Voluntary Put In Pot percentage
    pfr DECIMAL(5,2) DEFAULT 0, -- Pre-flop Raise percentage
    aggression_factor DECIMAL(5,2) DEFAULT 0,
    total_session_time INTEGER DEFAULT 0, -- in minutes
    last_played TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Player achievements and badges
CREATE TABLE IF NOT EXISTS player_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    achievement_type VARCHAR(100) NOT NULL,
    achievement_name VARCHAR(200) NOT NULL,
    description TEXT,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Player preferences and settings
CREATE TABLE IF NOT EXISTS player_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- 'ui', 'game', 'notifications', etc.
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(player_id, category)
);

-- Indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_players_created_at ON players(created_at);
CREATE INDEX IF NOT EXISTS idx_players_last_login ON players(last_login);
CREATE INDEX IF NOT EXISTS idx_players_bankroll ON players(bankroll);

CREATE INDEX IF NOT EXISTS idx_bankroll_history_player_id ON bankroll_history(player_id);
CREATE INDEX IF NOT EXISTS idx_bankroll_history_created_at ON bankroll_history(created_at);
CREATE INDEX IF NOT EXISTS idx_bankroll_history_transaction_type ON bankroll_history(transaction_type);
CREATE INDEX IF NOT EXISTS idx_bankroll_history_game_id ON bankroll_history(game_id);

CREATE INDEX IF NOT EXISTS idx_player_game_stats_player_id ON player_game_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_game_type ON player_game_stats(game_type);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_stakes ON player_game_stats(stakes_level);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_last_played ON player_game_stats(last_played);

CREATE INDEX IF NOT EXISTS idx_player_achievements_player_id ON player_achievements(player_id);
CREATE INDEX IF NOT EXISTS idx_player_achievements_type ON player_achievements(achievement_type);

CREATE INDEX IF NOT EXISTS idx_player_preferences_player_id ON player_preferences(player_id);
CREATE INDEX IF NOT EXISTS idx_player_preferences_category ON player_preferences(category);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_players_updated_at ON players;
CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_player_game_stats_updated_at ON player_game_stats;
CREATE TRIGGER update_player_game_stats_updated_at BEFORE UPDATE ON player_game_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_player_preferences_updated_at ON player_preferences;
CREATE TRIGGER update_player_preferences_updated_at BEFORE UPDATE ON player_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update player bankroll and create history entry
CREATE OR REPLACE FUNCTION update_player_bankroll(
    p_player_id UUID,
    p_amount DECIMAL(15,2),
    p_transaction_type VARCHAR(50),
    p_description TEXT DEFAULT NULL,
    p_game_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS JSONB AS $$
DECLARE
    v_current_balance DECIMAL(15,2);
    v_new_balance DECIMAL(15,2);
    v_history_id UUID;
BEGIN
    -- Get current balance with row lock
    SELECT bankroll INTO v_current_balance 
    FROM players 
    WHERE id = p_player_id 
    FOR UPDATE;
    
    IF v_current_balance IS NULL THEN
        RAISE EXCEPTION 'Player not found: %', p_player_id;
    END IF;
    
    -- Calculate new balance
    v_new_balance := v_current_balance + p_amount;
    
    -- Check for negative balance on withdrawals
    IF v_new_balance < 0 AND p_transaction_type IN ('withdrawal', 'game_loss') THEN
        RAISE EXCEPTION 'Insufficient funds. Current balance: %, requested: %', v_current_balance, p_amount;
    END IF;
    
    -- Update player bankroll
    UPDATE players 
    SET bankroll = v_new_balance,
        updated_at = NOW()
    WHERE id = p_player_id;
    
    -- Create history entry
    INSERT INTO bankroll_history (
        player_id, amount, balance_before, balance_after, 
        transaction_type, description, game_id, metadata
    ) VALUES (
        p_player_id, p_amount, v_current_balance, v_new_balance,
        p_transaction_type, p_description, p_game_id, p_metadata
    ) RETURNING id INTO v_history_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'previous_balance', v_current_balance,
        'new_balance', v_new_balance,
        'transaction_id', v_history_id
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get player summary with stats
CREATE OR REPLACE FUNCTION get_player_summary(p_player_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_player_data JSONB;
    v_total_hands INTEGER;
    v_total_profit DECIMAL(15,2);
    v_recent_activity JSONB;
BEGIN
    -- Get basic player info
    SELECT jsonb_build_object(
        'id', id,
        'username', username,
        'email', email,
        'avatar_url', avatar_url,
        'bankroll', bankroll,
        'created_at', created_at,
        'last_login', last_login,
        'stats', stats
    ) INTO v_player_data
    FROM players 
    WHERE id = p_player_id;
    
    IF v_player_data IS NULL THEN
        RETURN jsonb_build_object('error', 'Player not found');
    END IF;
    
    -- Get aggregated game stats
    SELECT 
        COALESCE(SUM(hands_played), 0),
        COALESCE(SUM(total_profit), 0)
    INTO v_total_hands, v_total_profit
    FROM player_game_stats 
    WHERE player_id = p_player_id;
    
    -- Get recent bankroll activity
    SELECT jsonb_agg(
        jsonb_build_object(
            'amount', amount,
            'transaction_type', transaction_type,
            'description', description,
            'created_at', created_at
        )
    ) INTO v_recent_activity
    FROM (
        SELECT amount, transaction_type, description, created_at
        FROM bankroll_history 
        WHERE player_id = p_player_id 
        ORDER BY created_at DESC 
        LIMIT 10
    ) recent;
    
    -- Combine all data
    RETURN v_player_data || jsonb_build_object(
        'total_hands_played', v_total_hands,
        'total_profit', v_total_profit,
        'recent_activity', COALESCE(v_recent_activity, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql;
