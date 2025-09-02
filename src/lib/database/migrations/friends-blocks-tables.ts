import type { MigrationConfig } from '../config-driven-migration';

// US-055: Friend Relationships and Blocked Users tables
export const FRIENDS_BLOCKS_TABLES: MigrationConfig = {
  version: '2025.09.02.1003',
  description: 'Create friend_relationships and blocked_users with uniqueness',
  dependencies: ['2025.09.02.1001'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'friend_relationships',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS friend_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  friend_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
)`
      }
    },
    {
      type: 'custom',
      table: 'blocked_users',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  blocked_id UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, blocked_id)
)`
      }
    }
  ],
  postChecks: [
    { name: 'friend_relationships_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='friend_relationships'`, expected: { cnt: 1 } },
    { name: 'blocked_users_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='blocked_users'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS blocked_users CASCADE' },
    { sql: 'DROP TABLE IF EXISTS friend_relationships CASCADE' }
  ]
};
