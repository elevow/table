import type { MigrationConfig } from '../config-driven-migration';

// US-055: Chat System — chat_messages table and indexes
export const CHAT_MESSAGES_TABLE: MigrationConfig = {
  version: '2025.09.02.1007',
  description: 'Create chat_messages table with indexes',
  dependencies: ['2025.09.02.1004'],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'chat_messages',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES game_rooms(id),
  sender_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  is_private BOOLEAN DEFAULT FALSE,
  recipient_id UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  is_moderated BOOLEAN DEFAULT FALSE,
  moderated_at TIMESTAMPTZ,
  moderator_id UUID REFERENCES users(id)
)`
      }
    },
    { type: 'addIndex', table: 'chat_messages', details: { columns: ['room_id'], indexName: 'chat_messages_room_id_idx' } },
    { type: 'addIndex', table: 'chat_messages', details: { columns: ['sender_id'], indexName: 'chat_messages_sender_id_idx' } }
  ],
  postChecks: [
    { name: 'chat_messages_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='chat_messages'`, expected: { cnt: 1 } },
    { name: 'idx_room_exists', sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'chat_messages_room_id_idx'`, expected: { '1': 1 } },
    { name: 'idx_sender_exists', sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'chat_messages_sender_id_idx'`, expected: { '1': 1 } }
  ],
  rollback: [
    { sql: 'DROP INDEX IF EXISTS chat_messages_sender_id_idx' },
    { sql: 'DROP INDEX IF EXISTS chat_messages_room_id_idx' },
    { sql: 'DROP TABLE IF EXISTS chat_messages CASCADE' }
  ]
};
