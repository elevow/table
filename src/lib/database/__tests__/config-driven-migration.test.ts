import { ConfigDrivenMigrationManager, MigrationConfig } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import { TransactionManager } from '../transaction-manager';

// Reuse a simple in-memory TransactionManager mock used elsewhere
const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('Config-driven Schema Migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('builds and runs a simple add column + index migration', async () => {
    const cfg: MigrationConfig = {
      version: '2025.08.27.1000',
      dependencies: [],
      preChecks: [
        { name: 'players_table_exists', sql: "SELECT 1 FROM information_schema.tables WHERE table_name = 'players'", expected: {}, errorMessage: 'Players table missing' }
      ],
      steps: [
        { type: 'addColumn', table: 'players', details: { columnName: 'is_vip', dataType: 'BOOLEAN', nullable: false, defaultValue: 'false' } },
        { type: 'addIndex', table: 'players', details: { columns: ['username'], indexName: 'idx_players_username' } }
      ],
      postChecks: [
        { name: 'column_exists', sql: "SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'is_vip'", expected: {} }
      ],
      rollback: [{ sql: 'ALTER TABLE players DROP COLUMN IF EXISTS is_vip' }],
      description: 'Add VIP flag and index on username'
    };

    const zero = manager.buildFromConfig(cfg);
    expect(zero.version).toBe(cfg.version);
    expect(zero.stages[0].steps[0].sql).toContain('ADD COLUMN IF NOT EXISTS is_vip BOOLEAN');
    expect(zero.stages[0].steps[1].sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_username');
    expect(zero.rollback?.steps[0].sql).toContain('DROP COLUMN IF EXISTS is_vip');

    // Execute path - mock validation and migration success
    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 10 });

    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });

  it('supports custom batched data transformations via {LIMIT}/{OFFSET}', async () => {
    const cfg: MigrationConfig = {
      version: '2025.08.27.1001',
      dependencies: [],
      preChecks: [],
      steps: [
        { type: 'custom', table: 'players', details: { sql: 'UPDATE players SET username = LOWER(username) LIMIT {LIMIT} OFFSET {OFFSET}', batch: true } }
      ],
      postChecks: [],
      rollback: []
    };

    const zero = manager.buildFromConfig(cfg);
    expect(zero.dataMigration).toBeDefined();
    expect(zero.dataMigration!.operations[0].sql).toContain('LIMIT {LIMIT} OFFSET {OFFSET}');
  });

  it('fails fast when validation detects issues', async () => {
    const cfg: MigrationConfig = {
      version: '2025.08.27.1002',
      dependencies: [],
      preChecks: [ { name: 'pre', sql: 'SELECT 0', expected: { count: 1 } } ],
      steps: [ { type: 'custom', table: 'x', details: { sql: 'SELECT 1' } } ],
      postChecks: [],
      rollback: []
    };

    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: false, issues: [ { type: 'pre', severity: 'error', message: 'bad', mitigation: '' } ], warnings: [], recommendations: [] });

    await expect(manager.run(cfg)).rejects.toThrow('Migration validation failed: bad');
  });
});
import { ConfigDrivenMigrationManager, MigrationConfig } from '../config-driven-migration';
import { SchemaEvolutionManager } from '../schema-evolution';
import { TransactionManager } from '../transaction-manager';

const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = { client: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('Config-driven Schema Migration', () => {
  let evolution: SchemaEvolutionManager;
  let manager: ConfigDrivenMigrationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    evolution = new SchemaEvolutionManager(mockTransactionManager);
    manager = new ConfigDrivenMigrationManager(evolution);
  });

  it('builds and runs a simple add column + index migration', async () => {
    const cfg: MigrationConfig = {
      version: '2025.08.27.1000',
      dependencies: [],
      preChecks: [
        { name: 'players_table_exists', sql: "SELECT 1 FROM information_schema.tables WHERE table_name = 'players'", expected: {}, errorMessage: 'Players table missing' }
      ],
      steps: [
        { type: 'addColumn', table: 'players', details: { columnName: 'is_vip', dataType: 'BOOLEAN', nullable: false, defaultValue: 'false' } },
        { type: 'addIndex', table: 'players', details: { columns: ['username'], indexName: 'idx_players_username' } }
      ],
      postChecks: [
        { name: 'column_exists', sql: "SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'is_vip'", expected: {} }
      ],
      rollback: [{ sql: 'ALTER TABLE players DROP COLUMN IF EXISTS is_vip' }],
      description: 'Add VIP flag and index on username'
    };

    const zero = manager.buildFromConfig(cfg);
    expect(zero.version).toBe(cfg.version);
    expect(zero.stages[0].steps[0].sql).toContain('ADD COLUMN IF NOT EXISTS is_vip BOOLEAN');
    expect(zero.stages[0].steps[1].sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_username');
    expect(zero.rollback?.steps[0].sql).toContain('DROP COLUMN IF EXISTS is_vip');

    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
    jest.spyOn(evolution, 'executeZeroDowntimeMigration').mockResolvedValue({ version: cfg.version, success: true, executionTime: 10 });

    const result = await manager.run(cfg);
    expect(result.success).toBe(true);
  });

  it('supports custom batched data transformations via {LIMIT}/{OFFSET}', async () => {
    const cfg: MigrationConfig = {
      version: '2025.08.27.1001',
      dependencies: [],
      preChecks: [],
      steps: [
        { type: 'custom', table: 'players', details: { sql: 'UPDATE players SET username = LOWER(username) LIMIT {LIMIT} OFFSET {OFFSET}', batch: true } }
      ],
      postChecks: [],
      rollback: []
    };

    const zero = manager.buildFromConfig(cfg);
    expect(zero.dataMigration).toBeDefined();
    expect(zero.dataMigration!.operations[0].sql).toContain('LIMIT {LIMIT} OFFSET {OFFSET}');
  });

  it('fails fast when validation detects issues', async () => {
    const cfg: MigrationConfig = {
      version: '2025.08.27.1002',
      dependencies: [],
      preChecks: [ { name: 'pre', sql: 'SELECT 0', expected: { count: 1 } } ],
      steps: [ { type: 'custom', table: 'x', details: { sql: 'SELECT 1' } } ],
      postChecks: [],
      rollback: []
    };

    jest.spyOn(evolution, 'validateEvolutionPlan').mockResolvedValue({ isValid: false, issues: [ { type: 'pre', severity: 'error', message: 'bad', mitigation: '' } ], warnings: [], recommendations: [] });

    await expect(manager.run(cfg)).rejects.toThrow('Migration validation failed: bad');
  });
});
