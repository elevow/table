import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { FRIEND_GAME_INVITES_TABLE as cfg } from '../migrations/friend-game-invites-table';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('friend_game_invites table migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines friend_game_invites table with expected columns', () => {
    const tbl = cfg.steps.find(s => s.type === 'custom' && s.table === 'friend_game_invites') as any;
    expect(tbl).toBeTruthy();
    expect(tbl.details.sql).toContain('CREATE TABLE IF NOT EXISTS friend_game_invites');
    // sanity check a few important columns/constraints
    expect(tbl.details.sql).toContain('inviter_id UUID NOT NULL');
    expect(tbl.details.sql).toContain('invitee_id UUID NOT NULL');
    expect(tbl.details.sql).toContain('room_id UUID NOT NULL');
    expect(tbl.details.sql).toContain("status VARCHAR(20) NOT NULL DEFAULT 'pending'");
  });

  it('adds indexes for inviter_id, invitee_id, and room_id', () => {
    const idxInviter = cfg.steps.find(s => s.type === 'addIndex' && (s as any).details.indexName === 'idx_friend_invites_inviter');
    const idxInvitee = cfg.steps.find(s => s.type === 'addIndex' && (s as any).details.indexName === 'idx_friend_invites_invitee');
    const idxRoom = cfg.steps.find(s => s.type === 'addIndex' && (s as any).details.indexName === 'idx_friend_invites_room');
    expect(idxInviter).toBeTruthy();
    expect(idxInvitee).toBeTruthy();
    expect(idxRoom).toBeTruthy();
  });

  it('includes a post-check for table existence', () => {
    const check = cfg.postChecks.find(pc => pc.name === 'table_friend_game_invites_exists');
    expect(check).toBeTruthy();
    expect(check?.sql).toContain("table_name='friend_game_invites'");
  });

  it('executes via config-driven manager', async () => {
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 3 });
    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });
});
