-- Full database schema for Supabase/PostgreSQL
-- This script creates all required tables and indexes for the application.
-- Run as a superuser or a role with privileges to create extensions, tables, and indexes.

-- UUID generation extension (pgcrypto provides gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

SET search_path TO public;

-- =====================
-- Core auth and profile
-- =====================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  auth_provider VARCHAR(50),
  auth_provider_id TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  type VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  biography TEXT,
  location TEXT,
  timezone TEXT,
  preferences JSONB DEFAULT '{}'::jsonb,
  statistics JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =======
-- Avatars
-- =======

CREATE TABLE IF NOT EXISTS avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  original_url TEXT NOT NULL,
  variants JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  moderator_id UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS avatar_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id UUID REFERENCES avatars(id),
  version INTEGER NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- Friends and block list
-- ======================

CREATE TABLE IF NOT EXISTS friend_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  friend_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  blocked_id UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, blocked_id)
);

-- =================
-- Game management
-- =================

CREATE TABLE IF NOT EXISTS game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  game_type VARCHAR(50) NOT NULL,
  max_players INTEGER NOT NULL,
  blind_levels JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'waiting',
  configuration JSONB
);

CREATE TABLE IF NOT EXISTS active_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES game_rooms(id),
  current_hand_id UUID,
  dealer_position INTEGER,
  current_player_position INTEGER,
  pot DECIMAL(15,2) DEFAULT 0,
  state JSONB,
  last_action_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_games (
  game_id UUID NOT NULL REFERENCES active_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  stack INTEGER NOT NULL,
  current_bet INTEGER DEFAULT 0,
  folded BOOLEAN DEFAULT FALSE,
  all_in BOOLEAN DEFAULT FALSE,
  cards JSONB DEFAULT '[]',
  last_action TEXT,
  last_action_time TIMESTAMPTZ,
  PRIMARY KEY (game_id, user_id),
  CONSTRAINT valid_position CHECK (position >= 0 AND position < 9)
);

CREATE INDEX IF NOT EXISTS idx_player_games_user ON player_games(user_id);
CREATE INDEX IF NOT EXISTS idx_player_games_game ON player_games(game_id);

-- =============
-- Hand history
-- =============

CREATE TABLE IF NOT EXISTS hand_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES active_games(id),
  hand_number INTEGER NOT NULL,
  community_cards TEXT[],
  player_cards JSONB,
  actions JSONB[],
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  winners JSONB,
  pot_distribution JSONB
);

CREATE TABLE IF NOT EXISTS run_it_twice_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id UUID REFERENCES hand_history(id),
  board_number INTEGER NOT NULL,
  community_cards TEXT[],
  winners JSONB,
  pot_amount DECIMAL(15,2)
);

-- ==============================
-- Player stats and achievements
-- ==============================

CREATE TABLE IF NOT EXISTS player_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  hands_played INTEGER DEFAULT 0,
  hands_won INTEGER DEFAULT 0,
  total_profit DECIMAL(15,2) DEFAULT 0,
  biggest_pot DECIMAL(15,2) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  game_specific_stats JSONB
);

CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  achievement_type VARCHAR(50) NOT NULL,
  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

-- =====
-- Chat
-- =====

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES game_rooms(id),
  sender_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  is_private BOOLEAN DEFAULT FALSE,
  recipient_id UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  is_moderated BOOLEAN DEFAULT FALSE,
  moderated_at TIMESTAMPTZ,
  moderator_id UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS chat_messages_room_id_idx ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS chat_messages_sender_id_idx ON chat_messages(sender_id);

CREATE TABLE IF NOT EXISTS chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS chat_reactions_message_id_idx ON chat_reactions(message_id);
CREATE INDEX IF NOT EXISTS chat_reactions_user_id_idx ON chat_reactions(user_id);

-- ============================
-- Rabbit hunt and cooldowns
-- ============================

CREATE TABLE IF NOT EXISTS rabbit_hunt_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id UUID REFERENCES hand_history(id),
  requested_by UUID REFERENCES users(id),
  revealed_cards TEXT[],
  remaining_deck TEXT[],
  revealed_at TIMESTAMPTZ DEFAULT NOW(),
  street VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_cooldowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  feature_type VARCHAR(50) NOT NULL,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  next_available TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, feature_type)
);

-- =======
-- Invites
-- =======

CREATE TABLE IF NOT EXISTS friend_game_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_friend_invites_inviter ON friend_game_invites(inviter_id);
CREATE INDEX IF NOT EXISTS idx_friend_invites_invitee ON friend_game_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_friend_invites_room ON friend_game_invites(room_id);

-- ==============
-- Admin alerts
-- ==============

CREATE TABLE IF NOT EXISTS admin_alerts (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  involved TEXT[] NOT NULL DEFAULT '{}',
  source VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_created_at ON admin_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_status ON admin_alerts(status);

-- ======
-- Social
-- ======

CREATE TABLE IF NOT EXISTS social_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  kind VARCHAR(20) NOT NULL,
  ref_id TEXT,
  visibility VARCHAR(10) DEFAULT 'public',
  message TEXT,
  platforms TEXT[] DEFAULT ARRAY[]::TEXT[],
  share_slug TEXT UNIQUE,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_shares_user_id ON social_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_social_shares_kind ON social_shares(kind);

CREATE TABLE IF NOT EXISTS social_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID REFERENCES social_shares(id) ON DELETE CASCADE,
  metric VARCHAR(20) NOT NULL,
  count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(share_id, metric)
);

-- End of schema
