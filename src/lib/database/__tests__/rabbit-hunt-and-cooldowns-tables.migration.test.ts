import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { RABBIT_HUNT_AND_COOLDOWNS_TABLES as cfg } from '../migrations/rabbit-hunt-and-cooldowns-tables';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('rabbit hunt and feature cooldowns tables migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines rabbit_hunt_history and feature_cooldowns', () => {
    const rabbit = cfg.steps.find(s => s.type === 'custom' && s.table === 'rabbit_hunt_history') as any;
    const cool = cfg.steps.find(s => s.type === 'custom' && s.table === 'feature_cooldowns') as any;
    expect(rabbit.details.sql).toContain('CREATE TABLE IF NOT EXISTS rabbit_hunt_history');
    expect(cool.details.sql).toContain('CREATE TABLE IF NOT EXISTS feature_cooldowns');
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
