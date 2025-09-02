import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { CHAT_MESSAGES_TABLE as cfg } from '../migrations/chat-messages-table';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('chat messages table migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines chat_messages table and indexes', () => {
    const tbl = cfg.steps.find(s => s.type === 'custom' && s.table === 'chat_messages') as any;
    expect(tbl.details.sql).toContain('CREATE TABLE IF NOT EXISTS chat_messages');
    const idxRoom = cfg.steps.find(s => s.type === 'addIndex' && (s as any).details.indexName === 'chat_messages_room_id_idx');
    const idxSender = cfg.steps.find(s => s.type === 'addIndex' && (s as any).details.indexName === 'chat_messages_sender_id_idx');
    expect(idxRoom).toBeTruthy();
    expect(idxSender).toBeTruthy();
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 5 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
