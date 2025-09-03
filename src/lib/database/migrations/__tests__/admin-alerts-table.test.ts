import { ADMIN_ALERTS_TABLE } from '../admin-alerts-table';
import { ConfigDrivenMigrationManager } from '../../config-driven-migration';

describe('ADMIN_ALERTS_TABLE migration config', () => {
  test('exports expected metadata and steps', () => {
    expect(ADMIN_ALERTS_TABLE.version).toBe('2025.09.02.1101');
    expect(ADMIN_ALERTS_TABLE.description).toMatch(/admin_alerts/i);
    expect(Array.isArray(ADMIN_ALERTS_TABLE.dependencies)).toBe(true);
    expect(ADMIN_ALERTS_TABLE.dependencies).toHaveLength(0);
    expect(ADMIN_ALERTS_TABLE.preChecks).toHaveLength(0);

    // Steps
    expect(ADMIN_ALERTS_TABLE.steps).toHaveLength(3);
    const [first, second, third] = ADMIN_ALERTS_TABLE.steps;

    // Step 1: create table via custom SQL
    expect(first.type).toBe('custom');
    expect(first.table).toBe('admin_alerts');
    expect(typeof first.details.sql).toBe('string');
    expect(first.details.sql).toContain('CREATE TABLE IF NOT EXISTS admin_alerts');
    expect(first.details.sql).toContain('id UUID PRIMARY KEY');
    expect(first.details.sql).toContain('created_at TIMESTAMPTZ');

    // Step 2: index on created_at
    expect(second.type).toBe('addIndex');
    expect(second.table).toBe('admin_alerts');
    expect(second.details.columns).toEqual(['created_at']);
    expect(second.details.indexName).toBe('idx_admin_alerts_created_at');

    // Step 3: index on status
    expect(third.type).toBe('addIndex');
    expect(third.table).toBe('admin_alerts');
    expect(third.details.columns).toEqual(['status']);
    expect(third.details.indexName).toBe('idx_admin_alerts_status');

    // Post-checks
    expect(ADMIN_ALERTS_TABLE.postChecks).toHaveLength(1);
    const pc = ADMIN_ALERTS_TABLE.postChecks[0];
    expect(pc.name).toBe('admin_alerts_exists');
    expect(pc.sql).toContain("table_name='admin_alerts'");
    expect(pc.expected).toEqual({ cnt: 1 });

    // Rollback
    expect(ADMIN_ALERTS_TABLE.rollback).toHaveLength(1);
    expect(ADMIN_ALERTS_TABLE.rollback[0].sql).toBe('DROP TABLE IF EXISTS admin_alerts CASCADE');
  });

  test('buildFromConfig maps to ZeroDowntimeMigration with correct SQL', () => {
    const mgr = new ConfigDrivenMigrationManager({} as any);
    const zero = mgr.buildFromConfig(ADMIN_ALERTS_TABLE);

    // Basic shape
    expect(zero.version).toBe(ADMIN_ALERTS_TABLE.version);
    expect(Array.isArray(zero.stages)).toBe(true);
    expect(zero.stages?.length).toBe(1);
    const stage = zero.stages![0];
    expect(stage.name).toBe('apply_steps');
    expect(stage.steps.length).toBe(3);

    // Steps include one CREATE TABLE and two CREATE INDEX statements
    const sqls = stage.steps.map(s => s.sql);
    const createTable = sqls.find(s => /CREATE TABLE IF NOT EXISTS admin_alerts/.test(s));
    const idxCreatedAt = sqls.find(s => /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_alerts_created_at ON admin_alerts \(created_at\)/.test(s));
    const idxStatus = sqls.find(s => /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_alerts_status ON admin_alerts \(status\)/.test(s));

    expect(createTable).toBeTruthy();
    expect(idxCreatedAt).toBeTruthy();
    expect(idxStatus).toBeTruthy();

    // Ensure retry policy applied to index steps (as per manager implementation)
    const indexSteps = stage.steps.filter(s => /CREATE INDEX CONCURRENTLY/.test(s.sql));
    expect(indexSteps.length).toBe(2);
    for (const step of indexSteps as any[]) {
      expect(step.retryPolicy).toBeDefined();
      expect(step.retryPolicy.maxAttempts).toBeGreaterThan(0);
    }

    // Validation includes post-checks mapped
    expect(zero.validation?.validators?.some(v => v.name === 'admin_alerts_exists')).toBe(true);
  });
});
