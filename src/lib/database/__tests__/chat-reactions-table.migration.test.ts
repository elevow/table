import { SchemaEvolutionManager } from '../../database/schema-evolution';
import { ConfigDrivenMigrationManager } from '../../database/config-driven-migration';
import type { TransactionManager } from '../../database/transaction-manager';
import { CHAT_REACTIONS_TABLE as cfg } from '../../database/migrations/chat-reactions-table';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('chat reactions table migration config (US-063)', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines table and indexes', () => {
    const tbl = cfg.steps.find((s) => s.type === 'custom' && s.table === 'chat_reactions') as any;
    expect(tbl.details.sql).toContain('CREATE TABLE IF NOT EXISTS chat_reactions');
    expect(cfg.steps.find((s: any) => s.details?.indexName === 'chat_reactions_message_id_idx')).toBeTruthy();
    expect(cfg.steps.find((s: any) => s.details?.indexName === 'chat_reactions_user_id_idx')).toBeTruthy();
  });

  it('runs through pipeline', async () => {
    const spyValidate = jest
      .spyOn(evolution, 'validateEvolutionPlan')
      .mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    const spyExecute = jest
      .spyOn(evolution, 'executeZeroDowntimeMigration')
      .mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(spyValidate).toHaveBeenCalled();
    expect(spyExecute).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
