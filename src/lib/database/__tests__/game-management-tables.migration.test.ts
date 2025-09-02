import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { GAME_MANAGEMENT_TABLES as cfg } from '../migrations/game-management-tables';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('game management tables migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines game_rooms and active_games tables', () => {
    const rooms = cfg.steps.find(s => s.type === 'custom' && s.table === 'game_rooms') as any;
    const active = cfg.steps.find(s => s.type === 'custom' && s.table === 'active_games') as any;
    expect(rooms.details.sql).toContain('CREATE TABLE IF NOT EXISTS game_rooms');
    expect(active.details.sql).toContain('CREATE TABLE IF NOT EXISTS active_games');
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
