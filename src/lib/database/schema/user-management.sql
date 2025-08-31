-- US-017: Core User Profile
-- Schema for users and auth tokens supporting multiple auth providers and password reset tokens

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Policy: Users can view their own data
-- Note: We use current_setting('app.current_user_id', true) to support app-managed session context.
-- If you're using a Postgres auth extension that provides auth.uid(), you can swap the USING clause accordingly.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_self_select'
    ) THEN
        EXECUTE $$
            CREATE POLICY users_self_select
            ON users FOR SELECT
            USING ((current_setting('app.current_user_id', true))::uuid = id)
        $$;
    END IF;
END$$;

-- Policy: Users can update their own data
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_self_update'
    ) THEN
        EXECUTE $$
            CREATE POLICY users_self_update
            ON users FOR UPDATE
            USING ((current_setting('app.current_user_id', true))::uuid = id)
        $$;
    END IF;
END$$;

