import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { FRIENDS_BLOCKS_TABLES as cfg } from '../migrations/friends-blocks-tables';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('friends & blocks tables migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines friend_relationships and blocked_users tables', () => {
    const friends = cfg.steps.find(s => s.type === 'custom' && s.table === 'friend_relationships') as any;
    const blocks = cfg.steps.find(s => s.type === 'custom' && s.table === 'blocked_users') as any;
    expect(friends.details.sql).toContain('CREATE TABLE IF NOT EXISTS friend_relationships');
    expect(blocks.details.sql).toContain('CREATE TABLE IF NOT EXISTS blocked_users');
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
