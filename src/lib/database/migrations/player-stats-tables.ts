import type { MigrationConfig } from '../config-driven-migration';

// US-055: Player Statistics — player_statistics and achievements tables
export const PLAYER_STATS_TABLES: MigrationConfig = {
  version: '2025.09.02.1006',
  description: 'Create player_statistics and achievements tables',
  dependencies: ['2025.09.02.1001'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'player_statistics',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS player_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  hands_played INTEGER DEFAULT 0,
  hands_won INTEGER DEFAULT 0,
  total_profit DECIMAL(15,2) DEFAULT 0,
  biggest_pot DECIMAL(15,2) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  game_specific_stats JSONB
)`
      }
    },
    {
      type: 'custom',
      table: 'achievements',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  achievement_type VARCHAR(50) NOT NULL,
  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
)`
      }
    }
  ],
  postChecks: [
    { name: 'player_statistics_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='player_statistics'`, expected: { cnt: 1 } },
    { name: 'achievements_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='achievements'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS achievements CASCADE' },
    { sql: 'DROP TABLE IF EXISTS player_statistics CASCADE' }
  ]
};
