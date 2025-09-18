import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { ROOM_CODE_MIGRATION as cfg } from '../migrations/room-code-migration';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('room code migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines schema changes from UUID to VARCHAR(8)', () => {
    expect(cfg.version).toBe('2025.09.16.1001');
    expect(cfg.description).toContain('alphanumeric room codes');
    expect(cfg.dependencies).toContain('2025.09.02.1004');
    
    // Check that it modifies the game_rooms.id column
    const alterIdStep = cfg.steps.find(s => 
      s.type === 'custom' && 
      s.table === 'game_rooms' && 
      (s as any).details.sql.includes('ALTER COLUMN id SET DATA TYPE VARCHAR(8)')
    );
    expect(alterIdStep).toBeTruthy();
    
    // Check that it drops and recreates foreign key constraints
    const dropFkSteps = cfg.steps.filter(s => 
      s.type === 'custom' && 
      (s as any).details.sql.includes('DROP CONSTRAINT IF EXISTS')
    );
    expect(dropFkSteps).toHaveLength(3); // active_games, chat_messages, friend_game_invites
    
    // Check that it adds foreign keys back
    const addFkSteps = cfg.steps.filter(s => 
      s.type === 'custom' && 
      (s as any).details.sql.includes('ADD CONSTRAINT') &&
      (s as any).details.sql.includes('FOREIGN KEY')
    );
    expect(addFkSteps).toHaveLength(3);
  });

  it('has proper pre and post checks', () => {
    // Pre-check for game_rooms table existence
    expect(cfg.preChecks).toHaveLength(1);
    expect(cfg.preChecks[0].name).toBe('game_rooms_table_exists');
    
    // Post-check for VARCHAR data type
    expect(cfg.postChecks).toHaveLength(1);
    expect(cfg.postChecks[0].name).toBe('game_rooms_id_is_varchar');
    expect(cfg.postChecks[0].expected).toEqual({ data_type: 'character varying' });
  });

  it('handles rollback documentation', () => {
    expect(cfg.rollback).toHaveLength(2);
    expect(cfg.rollback[0].sql).toContain('WARNING');
    expect(cfg.rollback[1].sql).toContain('Manual intervention required');
  });

  it('runs through the config-driven migration manager pipeline', async () => {
    const spyValidate = jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ 
      isValid: true, 
      issues: [], 
      warnings: [], 
      recommendations: [] 
    });
    const spyExecute = jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ 
      version: cfg.version, 
      success: true, 
      executionTime: 8 
    });

    const result = await manager.run(cfg);

    expect(spyValidate).toHaveBeenCalledTimes(1);
    expect(spyExecute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
