import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { AVATARS_TABLES as cfg } from '../migrations/avatars-tables';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('avatars tables migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines avatars and avatar_versions tables', () => {
    const avatars = cfg.steps.find(s => s.type === 'custom' && s.table === 'avatars') as any;
    const versions = cfg.steps.find(s => s.type === 'custom' && s.table === 'avatar_versions') as any;
    expect(avatars.details.sql).toContain('CREATE TABLE IF NOT EXISTS avatars');
    expect(versions.details.sql).toContain('CREATE TABLE IF NOT EXISTS avatar_versions');
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
