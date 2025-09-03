import type { MigrationConfig } from '../config-driven-migration';

// US-062: Admin Alerts persistence
export const ADMIN_ALERTS_TABLE: MigrationConfig = {
  version: '2025.09.02.1101',
  description: 'Create admin_alerts table for persisted security/admin alerts',
  dependencies: [],
  preChecks: [],
  steps: [
    {
      type: 'custom',
      table: 'admin_alerts',
      details: {
        sql: `CREATE TABLE IF NOT EXISTS admin_alerts (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  involved TEXT[] NOT NULL DEFAULT '{}',
  source VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`
      }
    },
    {
      type: 'addIndex',
      table: 'admin_alerts',
      details: { columns: ['created_at'], indexName: 'idx_admin_alerts_created_at' }
    },
    {
      type: 'addIndex',
      table: 'admin_alerts',
      details: { columns: ['status'], indexName: 'idx_admin_alerts_status' }
    }
  ],
  postChecks: [
    { name: 'admin_alerts_exists', sql: `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_name='admin_alerts'`, expected: { cnt: 1 } }
  ],
  rollback: [
    { sql: 'DROP TABLE IF EXISTS admin_alerts CASCADE' }
  ]
};
