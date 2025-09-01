import { ConfigDrivenMigrationManager } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import type { TransactionManager } from '../transaction-manager';
import { ROOM_CONFIGURATION_COLUMNS as cfg } from '../migrations/room-configuration-columns';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('game_rooms room configuration migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('defines columns, constraints and checks', () => {
    expect(cfg.version).toMatch(/\d{4}\.\d{2}\.\d{2}\./);
    expect(cfg.description).toMatch(/room configuration/i);

    const cols = cfg.steps.filter(s => s.type === 'addColumn').map(s => (s as any).details.columnName);
    expect(cols).toEqual(expect.arrayContaining(['small_blind','big_blind','min_buy_in','max_buy_in','updated_at']));

    const hasConstraintBlock = cfg.steps.some(s => s.type === 'custom' && (s as any).details.sql.includes('valid_blinds'));
    expect(hasConstraintBlock).toBe(true);

    // Post checks cover columns and constraints
    expect(cfg.postChecks.find(c => c.name.includes('col_small_blind_exists'))).toBeTruthy();
    expect(cfg.postChecks.find(c => c.name.includes('constraint_valid_blinds_exists'))).toBeTruthy();
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
