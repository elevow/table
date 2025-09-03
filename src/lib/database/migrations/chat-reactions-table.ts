import type { MigrationConfig } from '../config-driven-migration';

// US-063: Chat Reactions table
export const CHAT_REACTIONS_TABLE: MigrationConfig = {
  version: '2025.09.03.1001',
  description: 'Create chat_reactions table with uniqueness and indexes',
  dependencies: ['2025.09.02.1007'], // depends on chat_messages
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'chat_reactions',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS chat_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
)`
      }
    },
    { type: 'addIndex', table: 'chat_reactions', details: { columns: ['message_id'], indexName: 'chat_reactions_message_id_idx' } },
    { type: 'addIndex', table: 'chat_reactions', details: { columns: ['user_id'], indexName: 'chat_reactions_user_id_idx' } },
  ],
  postChecks: [
    { name: 'chat_reactions_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='chat_reactions'`, expected: { cnt: 1 } },
  ],
  rollback: [
    { sql: 'DROP INDEX IF EXISTS chat_reactions_user_id_idx' },
    { sql: 'DROP INDEX IF EXISTS chat_reactions_message_id_idx' },
    { sql: 'DROP TABLE IF EXISTS chat_reactions CASCADE' }
  ]
};
