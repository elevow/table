-- US-044: Data Archival Infrastructure
-- Creates archive tables and job tracking for archival and restoration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Job tracking table
CREATE TABLE IF NOT EXISTS archive_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type VARCHAR(50) NOT NULL, -- 'archive' | 'restore'
  category VARCHAR(50) NOT NULL, -- 'gameHistory' | 'playerActions' | 'chatLogs' | 'systemLogs'
  start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  end_time TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  affected_records INTEGER NOT NULL DEFAULT 0,
  errors TEXT[] DEFAULT '{}',
  details JSONB DEFAULT '{}'
);

-- Generic structure for archived rows storing the original record as JSONB or compressed bytea
CREATE TABLE IF NOT EXISTS archived_game_history (
  original_id UUID NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  data JSONB,
  compressed BOOLEAN NOT NULL DEFAULT false,
  compression VARCHAR(20), -- e.g., 'gzip'
  compressed_data BYTEA,
  PRIMARY KEY(original_id)
);
CREATE INDEX IF NOT EXISTS idx_archived_game_history_time ON archived_game_history(archived_at);

CREATE TABLE IF NOT EXISTS archived_player_actions (
  original_id UUID NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  data JSONB,
  compressed BOOLEAN NOT NULL DEFAULT false,
  compression VARCHAR(20),
  compressed_data BYTEA,
  PRIMARY KEY(original_id)
);
CREATE INDEX IF NOT EXISTS idx_archived_player_actions_time ON archived_player_actions(archived_at);

-- Optional categories; created if used by deployment
CREATE TABLE IF NOT EXISTS archived_chat_logs (
  original_id UUID NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  data JSONB,
  compressed BOOLEAN NOT NULL DEFAULT false,
  compression VARCHAR(20),
  compressed_data BYTEA,
  PRIMARY KEY(original_id)
);
CREATE INDEX IF NOT EXISTS idx_archived_chat_logs_time ON archived_chat_logs(archived_at);

CREATE TABLE IF NOT EXISTS archived_system_logs (
  original_id UUID NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  data JSONB,
  compressed BOOLEAN NOT NULL DEFAULT false,
  compression VARCHAR(20),
  compressed_data BYTEA,
  PRIMARY KEY(original_id)
);
CREATE INDEX IF NOT EXISTS idx_archived_system_logs_time ON archived_system_logs(archived_at);

COMMENT ON TABLE archive_jobs IS 'US-044: Tracks archival and restoration jobs for auditing and recovery';
COMMENT ON TABLE archived_game_history IS 'US-044: Archived rows from game_history';
COMMENT ON TABLE archived_player_actions IS 'US-044: Archived rows from player_actions';
