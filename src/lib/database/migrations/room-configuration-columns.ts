import type { MigrationConfig } from '../config-driven-migration';

// Room Configuration — add buy-in ranges, blinds, and updated_at to game_rooms
// Aligns with docs (rooms) using existing table name game_rooms in this codebase
export const ROOM_CONFIGURATION_COLUMNS: MigrationConfig = {
  version: '2025.08.31.1003',
  description: 'Add room configuration fields (buy-ins, blinds, updated_at) and constraints to game_rooms',
  dependencies: [],
  preChecks: [],
  steps: [
    // Add required columns
    { type: 'addColumn', table: 'game_rooms', details: { columnName: 'small_blind', dataType: 'INTEGER', nullable: false } },
    { type: 'addColumn', table: 'game_rooms', details: { columnName: 'big_blind', dataType: 'INTEGER', nullable: false } },
    { type: 'addColumn', table: 'game_rooms', details: { columnName: 'min_buy_in', dataType: 'INTEGER', nullable: false } },
    { type: 'addColumn', table: 'game_rooms', details: { columnName: 'max_buy_in', dataType: 'INTEGER', nullable: false } },
    { type: 'addColumn', table: 'game_rooms', details: { columnName: 'updated_at', dataType: 'TIMESTAMPTZ', nullable: true, defaultValue: 'NOW()' } },
  // Ensure max_players has a reasonable default (9)
    { type: 'modifyColumn', table: 'game_rooms', details: { columnName: 'max_players', defaultValue: 9 } },
    // Add constraints safely (IF NOT EXISTS using pg_constraint guard)
    {
      type: 'custom',
      table: 'game_rooms',
      details: {
        sql: `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_blinds'
  ) THEN
    ALTER TABLE game_rooms ADD CONSTRAINT valid_blinds CHECK (small_blind < big_blind);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_buy_ins'
  ) THEN
    ALTER TABLE game_rooms ADD CONSTRAINT valid_buy_ins CHECK (min_buy_in < max_buy_in);
  END IF;
END$$;`
      }
    }
  ],
  postChecks: [
    { name: 'col_small_blind_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='small_blind'`, expected: { cnt: 1 } },
    { name: 'col_big_blind_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='big_blind'`, expected: { cnt: 1 } },
    { name: 'col_min_buy_in_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='min_buy_in'`, expected: { cnt: 1 } },
    { name: 'col_max_buy_in_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='max_buy_in'`, expected: { cnt: 1 } },
    { name: 'col_updated_at_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='updated_at'`, expected: { cnt: 1 } },
    { name: 'constraint_valid_blinds_exists', sql: `SELECT 1 FROM pg_constraint WHERE conname = 'valid_blinds'`, expected: { '1': 1 } },
    { name: 'constraint_valid_buy_ins_exists', sql: `SELECT 1 FROM pg_constraint WHERE conname = 'valid_buy_ins'`, expected: { '1': 1 } }
  ],
  rollback: [
    { sql: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_blinds') THEN ALTER TABLE game_rooms DROP CONSTRAINT valid_blinds; END IF; END$$;` },
    { sql: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_buy_ins') THEN ALTER TABLE game_rooms DROP CONSTRAINT valid_buy_ins; END IF; END$$;` },
    { sql: 'ALTER TABLE game_rooms DROP COLUMN IF EXISTS small_blind' },
    { sql: 'ALTER TABLE game_rooms DROP COLUMN IF EXISTS big_blind' },
    { sql: 'ALTER TABLE game_rooms DROP COLUMN IF EXISTS min_buy_in' },
    { sql: 'ALTER TABLE game_rooms DROP COLUMN IF EXISTS max_buy_in' },
    { sql: 'ALTER TABLE game_rooms DROP COLUMN IF EXISTS updated_at' },
    { sql: 'ALTER TABLE game_rooms ALTER COLUMN max_players DROP DEFAULT' }
  ]
};
