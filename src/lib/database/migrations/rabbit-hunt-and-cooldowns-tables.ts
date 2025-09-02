import type { MigrationConfig } from '../config-driven-migration';

// US-055: Rabbit Hunt history and feature_cooldowns tables
export const RABBIT_HUNT_AND_COOLDOWNS_TABLES: MigrationConfig = {
  version: '2025.09.02.1008',
  description: 'Create rabbit_hunt_history and feature_cooldowns tables',
  dependencies: ['2025.09.02.1005'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'rabbit_hunt_history',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS rabbit_hunt_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hand_id UUID REFERENCES hand_history(id),
  requested_by UUID REFERENCES users(id),
  revealed_cards TEXT[],
  remaining_deck TEXT[],
  revealed_at TIMESTAMPTZ DEFAULT NOW(),
  street VARCHAR(20) NOT NULL
)`
      }
    },
    {
      type: 'custom',
      table: 'feature_cooldowns',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS feature_cooldowns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  feature_type VARCHAR(50) NOT NULL,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  next_available TIMESTAMPTZ NOT NULL
)`
      }
    }
  ],
  postChecks: [
    { name: 'rabbit_hunt_history_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='rabbit_hunt_history'`, expected: { cnt: 1 } },
    { name: 'feature_cooldowns_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='feature_cooldowns'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS feature_cooldowns CASCADE' },
    { sql: 'DROP TABLE IF EXISTS rabbit_hunt_history CASCADE' }
  ]
};
