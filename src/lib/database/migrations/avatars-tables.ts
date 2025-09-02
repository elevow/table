import type { MigrationConfig } from '../config-driven-migration';

// US-055: Avatar Management — avatars and avatar_versions tables
export const AVATARS_TABLES: MigrationConfig = {
  version: '2025.09.02.1002',
  description: 'Create avatars and avatar_versions tables with moderation workflow',
  dependencies: ['2025.09.02.1001'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'avatars',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS avatars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  original_url TEXT NOT NULL,
  variants JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  moderator_id UUID REFERENCES users(id)
)`
      }
    },
    {
      type: 'custom',
      table: 'avatar_versions',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS avatar_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  avatar_id UUID REFERENCES avatars(id),
  version INTEGER NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`
      }
    }
  ],
  postChecks: [
    { name: 'avatars_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='avatars'`, expected: { cnt: 1 } },
    { name: 'avatar_versions_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='avatar_versions'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS avatar_versions CASCADE' },
    { sql: 'DROP TABLE IF EXISTS avatars CASCADE' }
  ]
};
