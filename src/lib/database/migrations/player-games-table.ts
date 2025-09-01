import type { MigrationConfig } from '../config-driven-migration';

// US-070: Active Game State — player-specific state within active games
// Tracks positions, stacks, current bets, fold/all-in flags, and securely stored hole cards
export const PLAYER_GAMES_TABLE: MigrationConfig = {
  version: '2025.08.31.US-070',
  description: 'Create player_games table for per-player active game state with supporting indexes',
  dependencies: [],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'player_games',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS player_games (
  game_id UUID NOT NULL REFERENCES active_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  stack INTEGER NOT NULL,
  current_bet INTEGER DEFAULT 0,
  folded BOOLEAN DEFAULT FALSE,
  all_in BOOLEAN DEFAULT FALSE,
  cards JSONB DEFAULT '[]',
  last_action TEXT,
  last_action_time TIMESTAMPTZ,
  PRIMARY KEY (game_id, user_id),
  CONSTRAINT valid_position CHECK (position >= 0 AND position < 9)
)`
      }
    },
    {
      type: 'addIndex',
      table: 'player_games',
      details: {
        columns: ['user_id'],
        indexName: 'idx_player_games_user'
      }
    },
    {
      type: 'addIndex',
      table: 'player_games',
      details: {
        columns: ['game_id'],
        indexName: 'idx_player_games_game'
      }
    }
  ],
  postChecks: [
    {
      name: 'table_player_games_exists',
      sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'player_games'`,
      expected: { cnt: 1 }
    },
    {
      name: 'index_user_exists',
      sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_player_games_user'`,
      expected: { '1': 1 }
    },
    {
      name: 'index_game_exists',
      sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_player_games_game'`,
      expected: { '1': 1 }
    }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS player_games CASCADE' }
  ]
};
