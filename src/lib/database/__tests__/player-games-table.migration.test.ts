import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { PLAYER_GAMES_TABLE as cfg } from '../migrations/player-games-table';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('player_games table migration (US-070)', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines table creation and indexes with validations', () => {
    expect(cfg.version).toContain('US-070');
    expect(cfg.description).toMatch(/player_games table/i);

    // Create table step present
    const createTable = cfg.steps.find(s => s.type === 'custom' && s.table === 'player_games');
    expect(createTable).toBeTruthy();
    expect((createTable as any).details.sql).toContain('CREATE TABLE IF NOT EXISTS player_games');
    expect((createTable as any).details.sql).toContain('PRIMARY KEY (game_id, user_id)');

    // Indexes
    const idxUser = cfg.steps.find(s => s.type === 'addIndex' && s.table === 'player_games' && (s as any).details.indexName === 'idx_player_games_user');
    const idxGame = cfg.steps.find(s => s.type === 'addIndex' && s.table === 'player_games' && (s as any).details.indexName === 'idx_player_games_game');
    expect(idxUser).toBeTruthy();
    expect(idxGame).toBeTruthy();

    // Post checks
    expect(cfg.postChecks[0].sql).toContain("information_schema.tables");
    expect(cfg.postChecks[1].sql).toContain("pg_indexes");
    expect(cfg.postChecks[2].sql).toContain("pg_indexes");

    // Rollback
    expect(cfg.rollback[0].sql).toContain('DROP TABLE IF EXISTS player_games');
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
