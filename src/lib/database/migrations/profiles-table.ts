import type { MigrationConfig } from '../config-driven-migration';

// Profile Management — player profile with preferences, statistics, and settings
export const PROFILES_TABLE: MigrationConfig = {
  version: '2025.08.31.1004',
  description: 'Create profiles table for player profile, preferences, and statistics',
  dependencies: [],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'profiles',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  biography TEXT,
  location TEXT,
  timezone TEXT,
  preferences JSONB DEFAULT '{}'::jsonb,
  statistics JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`
      }
    }
  ],
  postChecks: [
    {
      name: 'table_profiles_exists',
      sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles'`,
      expected: { cnt: 1 }
    },
    {
      name: 'profiles_columns_preferences_statistics_exist',
      sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name='profiles' AND column_name IN ('preferences','statistics')`,
      expected: { cnt: 2 }
    }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS profiles CASCADE' }
  ]
};
