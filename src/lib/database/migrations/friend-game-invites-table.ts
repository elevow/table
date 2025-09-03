import type { MigrationConfig } from '../config-driven-migration';

// US-064: Friend game invites table
export const FRIEND_GAME_INVITES_TABLE: MigrationConfig = {
  version: '2025.09.03.0001',
  description: 'Create friend_game_invites table for inviting friends to games',
  dependencies: [],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'friend_game_invites',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS friend_game_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
)`
      }
    },
    {
      type: 'addIndex',
      table: 'friend_game_invites',
      details: {
        columns: ['inviter_id'],
        indexName: 'idx_friend_invites_inviter'
      }
    },
    {
      type: 'addIndex',
      table: 'friend_game_invites',
      details: {
        columns: ['invitee_id'],
        indexName: 'idx_friend_invites_invitee'
      }
    },
    {
      type: 'addIndex',
      table: 'friend_game_invites',
      details: {
        columns: ['room_id'],
        indexName: 'idx_friend_invites_room'
      }
    }
  ],
  postChecks: [
    { name: 'table_friend_game_invites_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_name='friend_game_invites'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS friend_game_invites CASCADE' }
  ]
};
