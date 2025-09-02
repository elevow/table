import type { MigrationConfig } from '../config-driven-migration';

// US-055: User Management Schema — users and auth_tokens tables
export const USERS_AUTH_TABLES: MigrationConfig = {
  version: '2025.09.02.1001',
  description: 'Create users and auth_tokens tables with UUID PKs and auth fields',
  dependencies: [],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'extensions',
      details: { sql: 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"' }
    },
    {
      type: 'custom',
      table: 'users',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  auth_provider VARCHAR(50),
  auth_provider_id TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  metadata JSONB
)`
      }
    },
    {
      type: 'custom',
      table: 'auth_tokens',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  type VARCHAR(50) NOT NULL
)`
      }
    }
  ],
  postChecks: [
    { name: 'users_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='users'`, expected: { cnt: 1 } },
    { name: 'auth_tokens_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='auth_tokens'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS auth_tokens CASCADE' },
    { sql: 'DROP TABLE IF EXISTS users CASCADE' }
  ]
};
