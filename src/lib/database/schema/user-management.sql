-- US-017: Core User Profile
-- Schema for users and auth tokens supporting multiple auth providers and password reset tokens

-- Use pgcrypto for UUIDs (compatible with Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    auth_provider VARCHAR(50),
    auth_provider_id TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(50) NOT NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);

-- US-066: User Data Privacy (Row Level Security)
-- Enable RLS so that users can only access their own row
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent via DROP IF EXISTS)
DROP POLICY IF EXISTS users_self_select ON users;
CREATE POLICY users_self_select
ON users FOR SELECT
USING ((current_setting('app.current_user_id', true))::uuid = id);

DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_update
ON users FOR UPDATE
USING ((current_setting('app.current_user_id', true))::uuid = id);

