import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { USERS_AUTH_TABLES as cfg } from '../migrations/users-auth-tables';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('users & auth_tokens tables migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines table creation for users and auth_tokens', () => {
    const users = cfg.steps.find(s => s.type === 'custom' && s.table === 'users') as any;
    const tokens = cfg.steps.find(s => s.type === 'custom' && s.table === 'auth_tokens') as any;
    expect(users.details.sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(users.details.sql).toContain('id UUID PRIMARY KEY');
    expect(tokens.details.sql).toContain('CREATE TABLE IF NOT EXISTS auth_tokens');
  });

  it('runs through config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
