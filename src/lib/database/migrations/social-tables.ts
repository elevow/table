import type { MigrationConfig } from '../config-driven-migration';

// US-065: Social Integration — social_shares and social_engagement tables
export const SOCIAL_TABLES: MigrationConfig = {
  version: '2025.09.03.1065',
  description: 'Create social_shares and social_engagement tables for social integration',
  dependencies: ['2025.09.02.1006'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'social_shares',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS social_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  kind VARCHAR(20) NOT NULL, -- 'hand' | 'achievement' | 'stats'
  ref_id TEXT, -- id of hand/achievement or stats key
  visibility VARCHAR(10) DEFAULT 'public', -- 'public' | 'unlisted' | 'private'
  message TEXT,
  platforms TEXT[] DEFAULT ARRAY[]::TEXT[], -- platforms this was shared to
  share_slug TEXT UNIQUE, -- optional human-friendly slug
  payload JSONB, -- snapshot to render when viewing share
  created_at TIMESTAMPTZ DEFAULT NOW()
)`
      }
    },
    {
      type: 'custom',
      table: 'social_engagement',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS social_engagement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  share_id UUID REFERENCES social_shares(id) ON DELETE CASCADE,
  metric VARCHAR(20) NOT NULL, -- 'click' | 'like' | 'reshare'
  count INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(share_id, metric)
)`
      }
    },
    {
      type: 'index',
      table: 'social_shares',
      details: { columns: ['user_id'] }
    },
    {
      type: 'index',
      table: 'social_shares',
      details: { columns: ['kind'] }
    }
  ],
  postChecks: [
    { name: 'social_shares_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='social_shares'`, expected: { cnt: 1 } },
    { name: 'social_engagement_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='social_engagement'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS social_engagement CASCADE' },
    { sql: 'DROP TABLE IF EXISTS social_shares CASCADE' }
  ]
};
