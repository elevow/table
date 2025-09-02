import type { MigrationConfig } from '../config-driven-migration';

// US-055: Game Management — game_rooms and active_games tables
export const GAME_MANAGEMENT_TABLES: MigrationConfig = {
  version: '2025.09.02.1004',
  description: 'Create game_rooms and active_games tables',
  dependencies: ['2025.09.02.1001'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'game_rooms',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS game_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  game_type VARCHAR(50) NOT NULL,
  max_players INTEGER NOT NULL,
  blind_levels JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'waiting',
  configuration JSONB
)`
      }
    },
    {
      type: 'custom',
      table: 'active_games',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS active_games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES game_rooms(id),
  current_hand_id UUID,
  dealer_position INTEGER,
  current_player_position INTEGER,
  pot DECIMAL(15,2) DEFAULT 0,
  state JSONB,
  last_action_at TIMESTAMPTZ DEFAULT NOW()
)`
      }
    }
  ],
  postChecks: [
    { name: 'game_rooms_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='game_rooms'`, expected: { cnt: 1 } },
    { name: 'active_games_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='active_games'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS active_games CASCADE' },
    { sql: 'DROP TABLE IF EXISTS game_rooms CASCADE' }
  ]
};
