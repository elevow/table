import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { US069_FEATURE_COOLDOWNS_UNIQUE_INDEX as cfg } from '../migrations/feature-cooldowns-unique-index';

// Reuse a simple in-memory TransactionManager mock pattern
const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('feature-cooldowns unique index migration config', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines concurrent unique index creation and sanity checks', () => {
    // Validate config fields
    expect(cfg.version).toContain('US-069');
    expect(cfg.description).toMatch(/unique index/i);

    // Pre-check queries for duplicates
    expect(cfg.preChecks[0].sql).toContain('FROM feature_cooldowns');
    expect(cfg.preChecks[0].sql).toContain('GROUP BY user_id, feature_type');
    expect(cfg.preChecks[0].sql).toContain('HAVING COUNT(*) > 1');

    // Step creates index concurrently with IF NOT EXISTS
    const createIdx = cfg.steps[0];
    expect(createIdx.type).toBe('custom');
    expect((createIdx.details as any).sql).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS feature_cooldowns_user_feature_uidx');

    // Post-check confirms index presence
    expect(cfg.postChecks[0].sql).toContain('pg_indexes');

    // Rollback drops the index concurrently
    expect(cfg.rollback[0].sql).toContain('DROP INDEX CONCURRENTLY IF EXISTS feature_cooldowns_user_feature_uidx');
  });

  it('runs through the config-driven migration manager pipeline', async () => {
    const spyValidate = jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    const spyExecute = jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });

    const result = await manager.run(cfg);

    expect(spyValidate).toHaveBeenCalledTimes(1);
    expect(spyExecute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
