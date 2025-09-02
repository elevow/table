import type { MigrationConfig } from '../config-driven-migration';

// US-055: Hand History — hand_history and run_it_twice_outcomes tables
export const HAND_HISTORY_TABLES: MigrationConfig = {
  version: '2025.09.02.1005',
  description: 'Create hand_history and run_it_twice_outcomes tables',
  dependencies: ['2025.09.02.1004'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'hand_history',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS hand_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID REFERENCES active_games(id),
  hand_number INTEGER NOT NULL,
  community_cards TEXT[],
  player_cards JSONB,
  actions JSONB[],
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  winners JSONB,
  pot_distribution JSONB
)`
      }
    },
    {
      type: 'custom',
      table: 'run_it_twice_outcomes',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS run_it_twice_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hand_id UUID REFERENCES hand_history(id),
  board_number INTEGER NOT NULL,
  community_cards TEXT[],
  winners JSONB,
  pot_amount DECIMAL(15,2)
)`
      }
    }
  ],
  postChecks: [
    { name: 'hand_history_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='hand_history'`, expected: { cnt: 1 } },
    { name: 'rit_outcomes_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='run_it_twice_outcomes'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS run_it_twice_outcomes CASCADE' },
    { sql: 'DROP TABLE IF EXISTS hand_history CASCADE' }
  ]
};
