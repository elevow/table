import type { MigrationConfig } from '../config-driven-migration';

// Ensure unique upsert on feature_cooldowns by adding a concurrent unique index
// Covers acceptance from DB schema doc: add unique index on (user_id, feature_type)
// to support ON CONFLICT upserts without long locks.
export const FEATURE_COOLDOWNS_UNIQUE_INDEX: MigrationConfig = {
  version: '2025.08.31.1001',
  description: 'Add concurrent unique index on feature_cooldowns (user_id, feature_type) to support safe upserts',
  dependencies: [],
  preChecks: [
    {
      name: 'no_duplicate_feature_cooldowns',
      sql: `WITH dups AS (
        SELECT user_id, feature_type, COUNT(*) AS cnt
        FROM feature_cooldowns
        GROUP BY user_id, feature_type
        HAVING COUNT(*) > 1
      ) SELECT COUNT(*) AS duplicates FROM dups`,
      expected: { duplicates: 0 },
      errorMessage: 'Duplicate (user_id, feature_type) rows exist in feature_cooldowns; resolve before applying unique index.'
    }
  ],
  steps: [
    {
      type: 'custom',
      table: 'feature_cooldowns',
      details: {
        // Use custom SQL to create a UNIQUE index concurrently
        sql: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS feature_cooldowns_user_feature_uidx ON feature_cooldowns (user_id, feature_type)'
      }
    }
    // Optional: Attach as table constraint using the created index (PostgreSQL lacks IF NOT EXISTS for ADD CONSTRAINT prior to v16)
    // A safe pattern would wrap in DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$; which we omit here.
  ],
  postChecks: [
    {
      name: 'unique_index_exists',
      sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'feature_cooldowns_user_feature_uidx'`,
      expected: { '1': 1 }
    }
  ],
  rollback: [
    { sql: 'DROP INDEX CONCURRENTLY IF EXISTS feature_cooldowns_user_feature_uidx' }
  ]
};
