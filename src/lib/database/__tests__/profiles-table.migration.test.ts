import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { PROFILES_TABLE as cfg } from '../migrations/profiles-table';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('profiles table migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines table creation and checks', () => {
    expect(cfg.version).toMatch(/\d{4}\.\d{2}\.\d{2}\./);
    expect(cfg.description).toMatch(/profiles table/i);

    const createTable = cfg.steps.find(s => s.type === 'custom' && s.table === 'profiles');
    expect(createTable).toBeTruthy();
    expect((createTable as any).details.sql).toContain('CREATE TABLE IF NOT EXISTS profiles');
    expect((createTable as any).details.sql).toContain('user_id UUID PRIMARY KEY REFERENCES users(id)');
    expect((createTable as any).details.sql).toContain('preferences JSONB');
    expect((createTable as any).details.sql).toContain('statistics JSONB');

    expect(cfg.postChecks[0].sql).toContain('information_schema.tables');
    expect(cfg.postChecks[1].sql).toContain('information_schema.columns');
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
