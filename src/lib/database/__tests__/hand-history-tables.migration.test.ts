import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { HAND_HISTORY_TABLES as cfg } from '../migrations/hand-history-tables';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('hand history tables migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines hand_history and run_it_twice_outcomes', () => {
    const hh = cfg.steps.find(s => s.type === 'custom' && s.table === 'hand_history') as any;
    const rit = cfg.steps.find(s => s.type === 'custom' && s.table === 'run_it_twice_outcomes') as any;
    expect(hh.details.sql).toContain('CREATE TABLE IF NOT EXISTS hand_history');
    expect(rit.details.sql).toContain('CREATE TABLE IF NOT EXISTS run_it_twice_outcomes');
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
