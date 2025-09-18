import type { MigrationConfig } from '../config-driven-migration';

// Change game_rooms.id from UUID to VARCHAR(8) to support short alphanumeric room codes
export const ROOM_CODE_MIGRATION: MigrationConfig = {
  version: '2025.09.16.1001',
  description: 'Change game_rooms.id from UUID to VARCHAR(8) for short alphanumeric room codes',
  dependencies: ['2025.09.02.1004'], // depends on game-management-tables
  preChecks: [
    { 
      name: 'game_rooms_table_exists', 
      sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_name='game_rooms'`, 
      expected: { cnt: 1 } 
    }
  ],
  steps: [
    // First, we need to drop foreign key references to game_rooms.id
    {
      type: 'custom',
      table: 'active_games',
      details: {
        sql: `ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey`
      }
    },
    {
      type: 'custom', 
      table: 'chat_messages',
      details: {
        sql: `ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey`
      }
    },
    {
      type: 'custom',
      table: 'friend_game_invites', 
      details: {
        sql: `ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey`
      }
    },
    // Change the data type of the id column
    {
      type: 'custom',
      table: 'game_rooms',
      details: {
        sql: `ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8)`
      }
    },
    // Remove the default UUID generation since we'll generate codes in the application
    {
      type: 'custom',
      table: 'game_rooms', 
      details: {
        sql: `ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT`
      }
    },
    // Update active_games.room_id to match
    {
      type: 'custom',
      table: 'active_games',
      details: {
        sql: `ALTER TABLE active_games ALTER COLUMN room_id SET DATA TYPE VARCHAR(8)`
      }
    },
    // Update chat_messages.room_id to match
    {
      type: 'custom',
      table: 'chat_messages',
      details: {
        sql: `ALTER TABLE chat_messages ALTER COLUMN room_id SET DATA TYPE VARCHAR(8)`
      }
    },
    // Update friend_game_invites.room_id to match  
    {
      type: 'custom',
      table: 'friend_game_invites',
      details: {
        sql: `ALTER TABLE friend_game_invites ALTER COLUMN room_id SET DATA TYPE VARCHAR(8)`
      }
    },
    // Re-add foreign key constraints with the new data type
    {
      type: 'custom',
      table: 'active_games',
      details: {
        sql: `ALTER TABLE active_games ADD CONSTRAINT active_games_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE`
      }
    },
    {
      type: 'custom',
      table: 'chat_messages',
      details: {
        sql: `ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE`
      }
    },
    {
      type: 'custom',
      table: 'friend_game_invites',
      details: {
        sql: `ALTER TABLE friend_game_invites ADD CONSTRAINT friend_game_invites_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE`
      }
    }
  ],
  postChecks: [
    { 
      name: 'game_rooms_id_is_varchar', 
      sql: `SELECT data_type FROM information_schema.columns WHERE table_name='game_rooms' AND column_name='id'`, 
      expected: { data_type: 'character varying' } 
    }
  ],
  rollback: [
    // Rollback steps would revert to UUID, but this would be complex due to data conversion
    // For now, we'll document that this migration is not easily reversible
    { sql: `-- WARNING: This migration is not easily reversible due to data type conversion` },
    { sql: `-- Manual intervention required to convert room codes back to UUIDs` }
  ]
};
