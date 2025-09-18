import type { MigrationConfig } from '../config-driven-migration';

// Add password_hash column to users table for proper password storage
export const ADD_PASSWORD_HASH_COLUMN: MigrationConfig = {
  version: '2025.09.15.1001',
  description: 'Add password_hash column to users table for secure password storage',
  dependencies: ['2025.09.02.1001'], // Depends on users table creation
  preChecks: [
    { 
      name: 'users_table_exists', 
      sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='users'`, 
      expected: { cnt: 1 } 
    }
  ],
  steps: [
    {
      type: 'custom',
      table: 'users',
      details: {
        sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`
      }
    },
    {
      type: 'custom',
      table: 'users',
      details: {
        sql: `CREATE INDEX IF NOT EXISTS idx_users_email_password ON users(email) WHERE password_hash IS NOT NULL`
      }
    },
    {
      type: 'custom',
      table: 'users',
      details: {
        sql: `COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password for email/password authentication'`
      }
    }
  ],
  postChecks: [
    { 
      name: 'password_hash_column_exists', 
      sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'`, 
      expected: { cnt: 1 } 
    }
  ],
  rollback: [
    {
      sql: 'DROP INDEX IF EXISTS idx_users_email_password'
    },
    {
      sql: 'ALTER TABLE users DROP COLUMN IF EXISTS password_hash'
    }
  ]
};
