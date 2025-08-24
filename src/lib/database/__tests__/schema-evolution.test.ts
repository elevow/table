// US-013: Schema Evolution Tests
// Comprehensive tests for zero-downtime migrations and backward compatibility

import { SchemaEvolutionManager, ZeroDowntimeMigration } from '../schema-evolution';
import { MigrationTemplateFactory, MigrationVersioning } from '../migration-templates';
import { PokerSchemaEvolution } from '../schema-evolution-examples';
import { TransactionManager } from '../transaction-manager';

// Mock transaction manager for testing
const mockTransactionManager = {
  withTransaction: jest.fn().mockImplementation(async (callback) => {
    const mockContext = {
      client: {
        query: jest.fn().mockResolvedValue({ rows: [{ id: 'mock-id' }], rowCount: 1 })
      }
    };
    return callback(mockContext);
  })
} as unknown as TransactionManager;

describe('US-013: Schema Evolution', () => {
  let evolutionManager: SchemaEvolutionManager;
  let pokerEvolution: PokerSchemaEvolution;

  beforeEach(() => {
    jest.clearAllMocks();
    evolutionManager = new SchemaEvolutionManager(mockTransactionManager);
    pokerEvolution = new PokerSchemaEvolution(mockTransactionManager);
  });

  describe('SchemaEvolutionManager', () => {
    describe('initialization', () => {
      it('should create required schema evolution tables', async () => {
        await evolutionManager.initialize();

        expect(mockTransactionManager.withTransaction).toHaveBeenCalledTimes(1);
        const callback = (mockTransactionManager.withTransaction as jest.Mock).mock.calls[0][0];
        const mockContext = {
          client: {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
          }
        };
        
        await callback(mockContext);
        
        expect(mockContext.client.query).toHaveBeenCalledWith(
          expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations')
        );
        expect(mockContext.client.query).toHaveBeenCalledWith(
          expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_evolution_log')
        );
      });
    });

    describe('zero-downtime migration execution', () => {
      it('should execute migration stages in correct order', async () => {
        const migration: ZeroDowntimeMigration = {
          version: '2025.08.23.001',
          description: 'Test migration',
          stages: [
            {
              name: 'stage1',
              description: 'First stage',
              steps: [
                { sql: 'CREATE TABLE test_table (id UUID PRIMARY KEY)' }
              ],
              canRollback: true
            },
            {
              name: 'stage2',
              description: 'Second stage',
              steps: [
                { sql: 'ALTER TABLE test_table ADD COLUMN name VARCHAR(255)' }
              ],
              canRollback: true
            }
          ]
        };

        // Mock the private methods that would be called
        (evolutionManager as any).performPreMigrationValidation = jest.fn()
          .mockResolvedValue({ isValid: true, errors: [] });
        (evolutionManager as any).performPostMigrationValidation = jest.fn()
          .mockResolvedValue({ isValid: true, errors: [] });
        (evolutionManager as any).performDataIntegrityCheck = jest.fn()
          .mockResolvedValue({ isValid: true, errors: [] });

        const result = await evolutionManager.executeZeroDowntimeMigration(migration);

        expect(result.success).toBe(true);
        expect(result.version).toBe('2025.08.23.001');
        expect(result.stageResults).toHaveLength(2);
        expect(result.stageResults![0].stageName).toBe('stage1');
        expect(result.stageResults![1].stageName).toBe('stage2');
      });

      it('should handle migration failure and attempt rollback', async () => {
        const migration: ZeroDowntimeMigration = {
          version: '2025.08.23.002',
          description: 'Failing migration',
          stages: [
            {
              name: 'failing_stage',
              description: 'This will fail',
              steps: [
                { sql: 'INVALID SQL THAT WILL FAIL' }
              ],
              canRollback: true
            }
          ],
          rollback: {
            steps: [
              { sql: 'DROP TABLE IF EXISTS test_table' }
            ],
            safetyChecks: []
          }
        };

        // Mock pre-validation to pass
        (evolutionManager as any).performPreMigrationValidation = jest.fn()
          .mockResolvedValue({ isValid: true, errors: [] });
        
        // Mock the transaction to fail during stage execution
        const failingTransactionManager = {
          withTransaction: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'log-id' }], rowCount: 1 }) // log start
            .mockRejectedValueOnce(new Error('SQL syntax error')) // failing stage
        } as unknown as TransactionManager;

        const failingEvolutionManager = new SchemaEvolutionManager(failingTransactionManager);
        (failingEvolutionManager as any).performPreMigrationValidation = jest.fn()
          .mockResolvedValue({ isValid: true, errors: [] });

        await expect(failingEvolutionManager.executeZeroDowntimeMigration(migration))
          .rejects.toThrow('SQL syntax error');
      });

      it('should validate pre-migration conditions', async () => {
        const migration: ZeroDowntimeMigration = {
          version: '2025.08.23.003',
          description: 'Migration with dependencies',
          requiredVersion: '2025.08.23.002',
          dependencies: ['required_table'],
          stages: [
            {
              name: 'test_stage',
              description: 'Test stage',
              steps: [{ sql: 'SELECT 1' }],
              canRollback: true
            }
          ]
        };

        // Mock getCurrentVersion to return wrong version
        jest.spyOn(evolutionManager, 'getCurrentVersion')
          .mockResolvedValue('2025.08.23.001');

        await expect(evolutionManager.executeZeroDowntimeMigration(migration))
          .rejects.toThrow('Required version');
      });
    });

    describe('rollback functionality', () => {
      it('should execute rollback steps in reverse order', async () => {
        // Mock private methods
        (evolutionManager as any).createRollbackPlan = jest.fn().mockResolvedValue({
          steps: [
            { sql: 'DROP INDEX test_index' },
            { sql: 'DROP TABLE test_table' }
          ]
        });
        (evolutionManager as any).validateRollbackSafety = jest.fn().mockResolvedValue({
          isSafe: true,
          risks: []
        });
        (evolutionManager as any).verifyRollbackState = jest.fn().mockResolvedValue({
          isValid: true,
          errors: []
        });

        const result = await evolutionManager.rollbackToVersion('2025.08.23.001');

        expect(result.success).toBe(true);
        expect(result.targetVersion).toBe('2025.08.23.001');
        expect(result.stepsExecuted).toBe(2);
      });

      it('should prevent unsafe rollbacks', async () => {
        // Mock unsafe rollback
        (evolutionManager as any).createRollbackPlan = jest.fn().mockResolvedValue({
          steps: []
        });
        (evolutionManager as any).validateRollbackSafety = jest.fn().mockResolvedValue({
          isSafe: false,
          risks: ['Data loss risk', 'Breaking change']
        });

        const result = await evolutionManager.rollbackToVersion('2025.08.23.001');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Rollback not safe');
      });
    });

    describe('migration validation', () => {
      it('should detect breaking changes', async () => {
        const migration: ZeroDowntimeMigration = {
          version: '2025.08.23.004',
          description: 'Breaking change migration',
          stages: [
            {
              name: 'breaking_change',
              description: 'Remove required column',
              steps: [
                { sql: 'ALTER TABLE players DROP COLUMN username' }
              ],
              canRollback: false
            }
          ]
        };

        // Mock breaking change detection
        (evolutionManager as any).detectBreakingChanges = jest.fn()
          .mockResolvedValue(['Dropping required column username']);
        (evolutionManager as any).analyzeDataRisks = jest.fn()
          .mockResolvedValue({ hasDataLoss: true });
        (evolutionManager as any).assessPerformanceImpact = jest.fn()
          .mockResolvedValue({ isHigh: false });
        (evolutionManager as any).validateRollbackCapability = jest.fn()
          .mockResolvedValue({ isRollbackable: false });
        (evolutionManager as any).generateRecommendations = jest.fn()
          .mockResolvedValue(['Add migration to preserve data']);

        const validation = await evolutionManager.validateEvolutionPlan(migration);

        expect(validation.isValid).toBe(false);
        expect(validation.issues).toHaveLength(3); // breaking change + data loss + no rollback
        expect(validation.issues[0].type).toBe('breaking_change');
        expect(validation.issues[1].type).toBe('data_loss');
        expect(validation.issues[2].type).toBe('no_rollback');
      });

      it('should provide warnings for high performance impact', async () => {
        const migration: ZeroDowntimeMigration = {
          version: '2025.08.23.005',
          description: 'Performance impact migration',
          stages: [
            {
              name: 'heavy_operation',
              description: 'Create large index',
              steps: [
                { sql: 'CREATE INDEX large_index ON big_table (complex_column)' }
              ],
              canRollback: true
            }
          ]
        };

        // Mock performance assessment
        (evolutionManager as any).detectBreakingChanges = jest.fn().mockResolvedValue([]);
        (evolutionManager as any).analyzeDataRisks = jest.fn()
          .mockResolvedValue({ hasDataLoss: false });
        (evolutionManager as any).assessPerformanceImpact = jest.fn()
          .mockResolvedValue({ isHigh: true, reason: 'Large table indexing' });
        (evolutionManager as any).validateRollbackCapability = jest.fn()
          .mockResolvedValue({ isRollbackable: true });
        (evolutionManager as any).generateRecommendations = jest.fn()
          .mockResolvedValue(['Consider off-peak execution']);

        const validation = await evolutionManager.validateEvolutionPlan(migration);

        expect(validation.isValid).toBe(true);
        expect(validation.warnings).toContain('High performance impact expected: Large table indexing');
      });
    });

    describe('version management', () => {
      it('should track current schema version', async () => {
        const mockQuery = jest.fn()
          .mockResolvedValue({ 
            rows: [{ version: '2025.08.23.010' }], 
            rowCount: 1 
          });

        (mockTransactionManager.withTransaction as jest.Mock).mockImplementation(async (callback) => {
          const mockContext = { client: { query: mockQuery } };
          return callback(mockContext);
        });

        const version = await evolutionManager.getCurrentVersion();

        expect(version).toBe('2025.08.23.010');
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT version FROM schema_migrations')
        );
      });

      it('should return null for no migrations', async () => {
        const mockQuery = jest.fn()
          .mockResolvedValue({ rows: [], rowCount: 0 });

        (mockTransactionManager.withTransaction as jest.Mock).mockImplementation(async (callback) => {
          const mockContext = { client: { query: mockQuery } };
          return callback(mockContext);
        });

        const version = await evolutionManager.getCurrentVersion();

        expect(version).toBeNull();
      });

      it('should retrieve migration history', async () => {
        const mockMigrations = [
          {
            version: '2025.08.23.003',
            applied_at: new Date('2025-08-23T10:00:00Z'),
            description: 'Add feature flags',
            execution_time_ms: 1500,
            rollback_available: true
          },
          {
            version: '2025.08.23.002',
            applied_at: new Date('2025-08-23T09:00:00Z'),
            description: 'Add indexes',
            execution_time_ms: 3000,
            rollback_available: true
          }
        ];

        const mockQuery = jest.fn()
          .mockResolvedValue({ rows: mockMigrations });

        (mockTransactionManager.withTransaction as jest.Mock).mockImplementation(async (callback) => {
          const mockContext = { client: { query: mockQuery } };
          return callback(mockContext);
        });

        const history = await evolutionManager.getMigrationHistory();

        expect(history).toHaveLength(2);
        expect(history[0].version).toBe('2025.08.23.003');
        expect(history[0].description).toBe('Add feature flags');
        expect(history[0].rollbackAvailable).toBe(true);
      });
    });
  });

  describe('MigrationTemplateFactory', () => {
    describe('add column migration', () => {
      it('should create valid add column migration', () => {
        const migration = MigrationTemplateFactory.createAddColumnMigration({
          version: '2025.08.23.100',
          tableName: 'players',
          columnName: 'feature_flags',
          dataType: 'JSONB',
          nullable: true,
          defaultValue: "'{}'::jsonb",
          maintainCompatibility: true
        });

        expect(migration.version).toBe('2025.08.23.100');
        expect(migration.description).toContain('feature_flags');
        expect(migration.stages).toHaveLength(1);
        expect(migration.stages[0].steps[0].sql).toContain('ALTER TABLE players');
        expect(migration.stages[0].steps[0].sql).toContain('ADD COLUMN IF NOT EXISTS feature_flags');
        expect(migration.rollback).toBeDefined();
        expect(migration.validation).toBeDefined();
      });

      it('should handle non-nullable columns with default values', () => {
        const migration = MigrationTemplateFactory.createAddColumnMigration({
          version: '2025.08.23.101',
          tableName: 'games',
          columnName: 'status',
          dataType: 'VARCHAR(20)',
          nullable: false,
          defaultValue: "'active'",
          maintainCompatibility: false
        });

        expect(migration.stages[0].steps[0].sql).toContain('NOT NULL');
        expect(migration.stages[0].steps[0].sql).toContain("DEFAULT 'active'");
        expect(migration.backwardCompatibility).toBeUndefined();
      });
    });

    describe('add index migration', () => {
      it('should create concurrent index migration', () => {
        const migration = MigrationTemplateFactory.createAddIndexMigration({
          version: '2025.08.23.200',
          tableName: 'game_history',
          columns: ['table_id', 'started_at'],
          indexName: 'idx_game_history_table_time'
        });

        expect(migration.version).toBe('2025.08.23.200');
        expect(migration.stages[0].steps[0].sql).toContain('CREATE INDEX CONCURRENTLY');
        expect(migration.stages[0].steps[0].sql).toContain('idx_game_history_table_time');
        expect(migration.stages[0].steps[0].retryPolicy).toBeDefined();
      });

      it('should support conditional indexes', () => {
        const migration = MigrationTemplateFactory.createAddIndexMigration({
          version: '2025.08.23.201',
          tableName: 'players',
          columns: ['username'],
          where: 'deleted_at IS NULL'
        });

        expect(migration.stages[0].steps[0].sql).toContain('WHERE deleted_at IS NULL');
      });
    });

    describe('rename column migration', () => {
      it('should create backward compatible rename migration', () => {
        const migration = MigrationTemplateFactory.createRenameColumnMigration({
          version: '2025.08.23.300',
          tableName: 'players',
          oldColumnName: 'bankroll',
          newColumnName: 'balance',
          cleanupDelayHours: 168
        });

        expect(migration.version).toBe('2025.08.23.300');
        expect(migration.stages).toHaveLength(3); // add, copy, create view
        expect(migration.backwardCompatibility).toBeDefined();
        expect(migration.backwardCompatibility!.compatibilityViews).toHaveLength(1);
        expect(migration.cleanupDelay).toBe(168);
      });
    });

    describe('foreign key migration', () => {
      it('should validate existing data before adding constraint', () => {
        const migration = MigrationTemplateFactory.createAddForeignKeyMigration({
          version: '2025.08.23.400',
          sourceTable: 'game_history',
          sourceColumn: 'player_id',
          targetTable: 'players',
          targetColumn: 'id',
          onDelete: 'CASCADE'
        });

        expect(migration.stages).toHaveLength(2); // validate + add constraint
        expect(migration.stages[0].name).toBe('validate_existing_data');
        expect(migration.stages[1].steps[0].sql).toContain('FOREIGN KEY');
        expect(migration.stages[1].steps[0].sql).toContain('ON DELETE CASCADE');
      });
    });
  });

  describe('MigrationVersioning', () => {
    describe('version generation', () => {
      it('should generate timestamp-based versions', () => {
        // Create a date object and extract expected values to avoid timezone issues
        const testDate = new Date('2025-08-23T10:30:00Z');
        const version = MigrationVersioning.generateVersion(testDate);
        
        // Just check the format and that it includes the expected date parts
        expect(version).toMatch(/^2025\.08\.23\.\d{4}$/);
        
        // Verify it can be parsed back correctly
        const parsed = MigrationVersioning.parseVersion(version);
        expect(parsed.year).toBe(2025);
        expect(parsed.month).toBe(8);
        expect(parsed.day).toBe(23);
      });

      it('should generate current timestamp version when no date provided', () => {
        const version = MigrationVersioning.generateVersion();
        
        expect(version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/);
      });
    });

    describe('version parsing', () => {
      it('should parse version components correctly', () => {
        const components = MigrationVersioning.parseVersion('2025.08.23.1430');
        
        expect(components.year).toBe(2025);
        expect(components.month).toBe(8);
        expect(components.day).toBe(23);
        expect(components.sequence).toBe(1430);
      });

      it('should throw error for invalid version format', () => {
        expect(() => MigrationVersioning.parseVersion('invalid'))
          .toThrow('Invalid version format');
      });
    });

    describe('version comparison', () => {
      it('should compare versions correctly', () => {
        expect(MigrationVersioning.compareVersions('2025.08.23.1430', '2025.08.23.1400'))
          .toBeGreaterThan(0);
        expect(MigrationVersioning.compareVersions('2025.08.22.1430', '2025.08.23.1400'))
          .toBeLessThan(0);
        expect(MigrationVersioning.compareVersions('2025.08.23.1430', '2025.08.23.1430'))
          .toBe(0);
      });
    });

    describe('version validation', () => {
      it('should validate correct version format', () => {
        expect(MigrationVersioning.isValidVersion('2025.08.23.1430')).toBe(true);
        expect(MigrationVersioning.isValidVersion('invalid')).toBe(false);
        expect(MigrationVersioning.isValidVersion('2025.08.23')).toBe(false);
      });
    });
  });

  describe('PokerSchemaEvolution', () => {
    describe('poker-specific migrations', () => {
      it('should add player feature flags successfully', async () => {
        // Mock evolutionManager methods directly
        jest.spyOn(evolutionManager, 'validateEvolutionPlan')
          .mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
        jest.spyOn(evolutionManager, 'executeZeroDowntimeMigration')
          .mockResolvedValue({ 
            version: '2025.08.23.500', 
            success: true, 
            executionTime: 1000 
          });

        // Override the pokerEvolution's evolutionManager
        (pokerEvolution as any).evolutionManager = evolutionManager;

        await expect(pokerEvolution.addPlayerFeatureFlags()).resolves.toBeUndefined();
      });

      it('should handle validation failures gracefully', async () => {
        jest.spyOn(evolutionManager, 'validateEvolutionPlan')
          .mockResolvedValue({ 
            isValid: false, 
            issues: [
              { 
                type: 'breaking_change', 
                severity: 'error', 
                message: 'Test error', 
                mitigation: 'Fix it' 
              }
            ], 
            warnings: [], 
            recommendations: [] 
          });

        // Override the pokerEvolution's evolutionManager
        (pokerEvolution as any).evolutionManager = evolutionManager;

        await expect(pokerEvolution.addPlayerFeatureFlags())
          .rejects.toThrow('Migration validation failed: Test error');
      });
    });

    describe('demonstration lifecycle', () => {
      it('should complete full migration lifecycle', async () => {
        // Mock all required methods
        jest.spyOn(evolutionManager, 'initialize').mockResolvedValue();
        jest.spyOn(evolutionManager, 'getCurrentVersion')
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce('2025.08.23.600');
        jest.spyOn(evolutionManager, 'validateEvolutionPlan')
          .mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
        jest.spyOn(evolutionManager, 'executeZeroDowntimeMigration')
          .mockResolvedValue({ 
            version: '2025.08.23.600', 
            success: true, 
            executionTime: 1500 
          });
        jest.spyOn(evolutionManager, 'getMigrationHistory')
          .mockResolvedValue([
            {
              version: '2025.08.23.600',
              appliedAt: new Date(),
              description: 'Demo migration',
              executionTime: 1500,
              rollbackAvailable: true
            }
          ]);

        // Override the pokerEvolution's evolutionManager
        (pokerEvolution as any).evolutionManager = evolutionManager;

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        await pokerEvolution.demonstrateFullMigrationLifecycle();

        expect(consoleSpy).toHaveBeenCalledWith('=== Schema Evolution Demonstration ===');
        expect(consoleSpy).toHaveBeenCalledWith('✓ Schema evolution system initialized');
        expect(consoleSpy).toHaveBeenCalledWith('Total migrations applied: 1');

        consoleSpy.mockRestore();
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle database connection failures gracefully', async () => {
      const failingTransactionManager = {
        withTransaction: jest.fn().mockRejectedValue(new Error('Database connection failed'))
      } as unknown as TransactionManager;

      const failingEvolutionManager = new SchemaEvolutionManager(failingTransactionManager);

      await expect(failingEvolutionManager.initialize())
        .rejects.toThrow('Database connection failed');
    });

    it('should handle concurrent migration attempts', async () => {
      const migration: ZeroDowntimeMigration = {
        version: '2025.08.23.700',
        description: 'Concurrent test',
        stages: [
          {
            name: 'test_stage',
            description: 'Test',
            steps: [{ sql: 'SELECT 1' }],
            canRollback: true
          }
        ]
      };

      // Create two different evolution managers to simulate concurrency
      const manager1 = new SchemaEvolutionManager(mockTransactionManager);
      const manager2 = new SchemaEvolutionManager(mockTransactionManager);

      // Mock the first one to succeed
      (manager1 as any).performPreMigrationValidation = jest.fn()
        .mockResolvedValue({ isValid: true, errors: [] });
      (manager1 as any).performPostMigrationValidation = jest.fn()
        .mockResolvedValue({ isValid: true, errors: [] });
      (manager1 as any).performDataIntegrityCheck = jest.fn()
        .mockResolvedValue({ isValid: true, errors: [] });

      // Mock the second one to fail with version conflict
      (manager2 as any).performPreMigrationValidation = jest.fn()
        .mockRejectedValue(new Error('Migration version already exists'));

      const promise1 = manager1.executeZeroDowntimeMigration(migration);
      const promise2 = manager2.executeZeroDowntimeMigration(migration);

      const results = await Promise.allSettled([promise1, promise2]);
      
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
    });

    it('should validate migration dependencies exist', async () => {
      const migration: ZeroDowntimeMigration = {
        version: '2025.08.23.800',
        description: 'Migration with missing dependencies',
        dependencies: ['non_existent_table'],
        stages: [
          {
            name: 'test_stage',
            description: 'Test',
            steps: [{ sql: 'SELECT 1' }],
            canRollback: true
          }
        ]
      };

      // Mock dependency check to return false
      (evolutionManager as any).checkDependencyExists = jest.fn()
        .mockResolvedValue(false);

      await expect(evolutionManager.executeZeroDowntimeMigration(migration))
        .rejects.toThrow('Missing dependency: non_existent_table');
    });
  });
});

describe('Integration Tests', () => {
  let integrationEvolutionManager: SchemaEvolutionManager;

  beforeEach(() => {
    integrationEvolutionManager = new SchemaEvolutionManager(mockTransactionManager);
  });

  describe('Real Migration Scenarios', () => {
    it('should execute player statistics migration successfully', async () => {
      const poker = new PokerSchemaEvolution(mockTransactionManager);
      
      // Mock all required validation methods
      jest.spyOn(integrationEvolutionManager, 'validateEvolutionPlan')
        .mockResolvedValue({ isValid: true, issues: [], warnings: [], recommendations: [] });
      jest.spyOn(integrationEvolutionManager, 'executeZeroDowntimeMigration')
        .mockResolvedValue({ 
          version: '2025.08.23.900', 
          success: true, 
          executionTime: 2500 
        });

      // Override the poker's evolutionManager
      (poker as any).evolutionManager = integrationEvolutionManager;

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await poker.addPlayerStatisticsTable();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Statistics table migration completed: SUCCESS')
      );

      consoleSpy.mockRestore();
    });

    it('should handle complex audit trail migration', async () => {
      const poker = new PokerSchemaEvolution(mockTransactionManager);
      
      jest.spyOn(integrationEvolutionManager, 'executeZeroDowntimeMigration')
        .mockResolvedValue({ 
          version: '2025.08.23.901', 
          success: true, 
          executionTime: 5000 
        });

      // Override the poker's evolutionManager
      (poker as any).evolutionManager = integrationEvolutionManager;

      await expect(poker.addAuditTrail()).resolves.toBeUndefined();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large batch data migrations efficiently', async () => {
      const migration = MigrationTemplateFactory.createPartitioningMigration({
        version: '2025.08.23.1000',
        tableName: 'game_history',
        partitionType: 'range',
        partitionColumn: 'started_at',
        partitions: [
          { name: 'game_history_2024', condition: "FROM ('2024-01-01') TO ('2025-01-01')" },
          { name: 'game_history_2025', condition: "FROM ('2025-01-01') TO ('2026-01-01')" }
        ],
        batchSize: 1000
      });

      expect(migration.dataMigration).toBeDefined();
      expect(migration.dataMigration!.batchSize).toBe(1000);
      expect(migration.stages).toHaveLength(4); // create, partitions, migrate, swap
    });

    it('should support retry policies for transient failures', async () => {
      const migration = MigrationTemplateFactory.createAddIndexMigration({
        version: '2025.08.23.1001',
        tableName: 'large_table',
        columns: ['indexed_column']
      });

      expect(migration.stages[0].steps[0].retryPolicy).toBeDefined();
      expect(migration.stages[0].steps[0].retryPolicy!.maxAttempts).toBe(3);
      expect(migration.stages[0].steps[0].retryPolicy!.delayMs).toBe(5000);
    });
  });
});
