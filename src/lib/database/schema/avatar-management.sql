-- US-018: Avatar Management Schema

CREATE TABLE IF NOT EXISTS avatars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    original_url TEXT NOT NULL,
    variants JSONB NOT NULL,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    moderated_at TIMESTAMP WITH TIME ZONE,
    moderator_id UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS avatars_user_id_idx ON avatars(user_id);
CREATE INDEX IF NOT EXISTS avatars_status_idx ON avatars(status);

CREATE TABLE IF NOT EXISTS avatar_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    avatar_id UUID REFERENCES avatars(id),
    version INTEGER NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS avatar_versions_avatar_id_idx ON avatar_versions(avatar_id);
CREATE UNIQUE INDEX IF NOT EXISTS avatar_versions_unique ON avatar_versions(avatar_id, version);
