// US-012: Data Consistency - Comprehensive Test Suite

import { 
  TransactionManager, 
  TransactionManagerFactory,
  TransactionError,
  TransactionConfig,
  IsolationLevel
} from '../transaction-manager';
import { ACIDCompliance, BusinessRuleValidators, OptimisticConcurrencyControl } from '../acid-compliance';
import { DatabasePool } from '../database-connection';
import { getCacheManager } from '../../../utils/cache-manager';

// Mock database for testing
class MockDatabaseClient {
  private static queryCount = 0;
  private static mockData = new Map<string, any[]>();
  private static transactionState = 'none'; // 'none', 'active', 'committed', 'aborted'

  constructor() {}

  async query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    MockDatabaseClient.queryCount++;
    console.log('Mock Query:', text, params);

    // Simulate transaction control
    if (text.trim().toUpperCase() === 'BEGIN') {
      MockDatabaseClient.transactionState = 'active';
      return { rows: [], rowCount: 0 };
    }

    if (text.trim().toUpperCase() === 'COMMIT') {
      MockDatabaseClient.transactionState = 'committed';
      return { rows: [], rowCount: 0 };
    }

    if (text.trim().toUpperCase() === 'ROLLBACK') {
      MockDatabaseClient.transactionState = 'aborted';
      return { rows: [], rowCount: 0 };
    }

    // Simulate isolation level setting
    if (text.includes('SET TRANSACTION ISOLATION LEVEL')) {
      return { rows: [], rowCount: 0 };
    }

    // Simulate timeout setting
    if (text.includes('SET statement_timeout')) {
      return { rows: [], rowCount: 0 };
    }

    // Simulate read-only setting
    if (text.includes('SET TRANSACTION READ ONLY')) {
      return { rows: [], rowCount: 0 };
    }

    // Simulate savepoint operations
    if (text.includes('SAVEPOINT')) {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes('ROLLBACK TO SAVEPOINT')) {
      return { rows: [], rowCount: 0 };
    }

    // Simulate SHOW queries
    if (text.includes('SHOW transaction_isolation')) {
      return { rows: [{ transaction_isolation: 'read committed' }], rowCount: 1 };
    }

    // Simulate WAL queries
    if (text.includes('pg_walfile_name') || text.includes('pg_current_wal_lsn')) {
      return { rows: [{ pg_walfile_name: 'mock_wal_file' }], rowCount: 1 };
    }

    // Simulate advisory lock functions
    if (text.includes('pg_try_advisory_lock')) {
      return { rows: [{ pg_try_advisory_lock: true }], rowCount: 1 };
    }

    if (text.includes('pg_advisory_unlock')) {
      return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
    }

    // Simulate deadlock error for testing
    if (text.includes('DEADLOCK_TEST')) {
      throw new Error('deadlock detected');
    }

    // Simulate serialization failure for testing
    if (text.includes('SERIALIZATION_TEST')) {
      throw new Error('could not serialize access due to concurrent update');
    }

    // Simulate timeout error for testing
    if (text.includes('TIMEOUT_TEST')) {
      throw new Error('canceling statement due to statement timeout');
    }

    // Simulate business rule violations
    if (text.includes('SELECT id, username, bankroll FROM players WHERE bankroll < 0')) {
      return { rows: [], rowCount: 0 }; // No negative bankrolls
    }

    if (text.includes('SELECT id, username, bankroll FROM players WHERE bankroll >')) {
      return { rows: [], rowCount: 0 }; // No excessive bankrolls
    }

    // Simulate referential integrity checks
    if (text.includes('LEFT JOIN')) {
      return { rows: [], rowCount: 0 }; // No orphaned records
    }

    // Simulate version-based updates
    if (text.includes('version = version + 1')) {
      return { rows: [{ version: 2 }], rowCount: 1 };
    }

    // Default response for other queries
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    // Mock release - no-op
  }

  static getQueryCount(): number {
    return this.queryCount;
  }

  static resetQueryCount(): void {
    this.queryCount = 0;
  }

  static getTransactionState(): string {
    return this.transactionState;
  }

  static resetTransactionState(): void {
    this.transactionState = 'none';
  }
}

class MockDatabasePool implements DatabasePool {
  async connect(): Promise<MockDatabaseClient> {
    return new MockDatabaseClient();
  }

  async end(): Promise<void> {
    // Mock end - no-op
  }
}

describe('US-012: Data Consistency', () => {
  let transactionManager: TransactionManager;
  let mockDbPool: MockDatabasePool;

  beforeEach(() => {
    mockDbPool = new MockDatabasePool();
    transactionManager = TransactionManagerFactory.create(mockDbPool);
    MockDatabaseClient.resetQueryCount();
    MockDatabaseClient.resetTransactionState();
  });

  afterEach(async () => {
    await transactionManager.cleanup();
  });

  describe('Transaction Management', () => {
    it('should begin a transaction with default configuration', async () => {
      const context = await transactionManager.beginTransaction();

      expect(context.id).toBeDefined();
      expect(context.status).toBe('active');
      expect(context.config.isolationLevel).toBe('read_committed');
      expect(context.config.timeout).toBe(30000);
      expect(MockDatabaseClient.getTransactionState()).toBe('active');

      await transactionManager.rollbackTransaction(context);
    });

    it('should begin a transaction with custom configuration', async () => {
      const config: Partial<TransactionConfig> = {
        isolationLevel: 'serializable',
        timeout: 10000,
        readOnly: true
      };

      const context = await transactionManager.beginTransaction(config);

      expect(context.config.isolationLevel).toBe('serializable');
      expect(context.config.timeout).toBe(10000);
      expect(context.config.readOnly).toBe(true);

      await transactionManager.rollbackTransaction(context);
    });

    it('should execute queries within a transaction', async () => {
      const context = await transactionManager.beginTransaction();

      const result = await transactionManager.executeInTransaction(
        context,
        'SELECT * FROM players WHERE id = $1',
        ['player-1']
      );

      expect(result).toBeDefined();
      expect(context.operations).toHaveLength(1);
      expect(context.operations[0].sql).toContain('SELECT * FROM players');

      await transactionManager.rollbackTransaction(context);
    });

    it('should commit a transaction successfully', async () => {
      const context = await transactionManager.beginTransaction();

      await transactionManager.executeInTransaction(
        context,
        'INSERT INTO players (id, username) VALUES ($1, $2)',
        ['test-id', 'testuser']
      );

      await transactionManager.commitTransaction(context);

      expect(context.status).toBe('committed');
      expect(MockDatabaseClient.getTransactionState()).toBe('committed');
    });

    it('should rollback a transaction', async () => {
      const context = await transactionManager.beginTransaction();

      await transactionManager.executeInTransaction(
        context,
        'INSERT INTO players (id, username) VALUES ($1, $2)',
        ['test-id', 'testuser']
      );

      await transactionManager.rollbackTransaction(context);

      expect(context.status).toBe('aborted');
      expect(MockDatabaseClient.getTransactionState()).toBe('aborted');
    });

    it('should create and rollback to savepoints', async () => {
      const context = await transactionManager.beginTransaction();

      await transactionManager.executeInTransaction(
        context,
        'INSERT INTO players (id, username) VALUES ($1, $2)',
        ['test-id-1', 'testuser1']
      );

      await transactionManager.createSavepoint(context, 'sp1');
      expect(context.savepoints.has('sp1')).toBe(true);

      await transactionManager.executeInTransaction(
        context,
        'INSERT INTO players (id, username) VALUES ($1, $2)',
        ['test-id-2', 'testuser2']
      );

      expect(context.operations).toHaveLength(2);

      await transactionManager.rollbackToSavepoint(context, 'sp1');
      expect(context.operations).toHaveLength(1);

      await transactionManager.rollbackTransaction(context);
    });

    it('should handle transaction timeout', async () => {
      const config: Partial<TransactionConfig> = {
        timeout: 100 // Very short timeout
      };

      const context = await transactionManager.beginTransaction(config);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Transaction should be aborted due to timeout
      expect(context.status).toBe('aborted');
    });
  });

  describe('withTransaction Helper', () => {
    it('should execute operations within a transaction and commit', async () => {
      const result = await transactionManager.withTransaction(async (context) => {
        await transactionManager.executeInTransaction(
          context,
          'INSERT INTO players (id, username) VALUES ($1, $2)',
          ['test-id', 'testuser']
        );

        return 'success';
      });

      expect(result).toBe('success');
      expect(MockDatabaseClient.getTransactionState()).toBe('committed');
    });

    it('should rollback on error', async () => {
      await expect(
        transactionManager.withTransaction(async (context) => {
          await transactionManager.executeInTransaction(
            context,
            'INSERT INTO players (id, username) VALUES ($1, $2)',
            ['test-id', 'testuser']
          );

          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(MockDatabaseClient.getTransactionState()).toBe('aborted');
    });

    it('should retry on deadlock errors', async () => {
      let attempt = 0;
      const result = await transactionManager.withTransaction(async (context) => {
        attempt++;
        
        if (attempt === 1) {
          // Simulate deadlock on first attempt
          await transactionManager.executeInTransaction(context, 'DEADLOCK_TEST');
        } else {
          // Succeed on retry
          await transactionManager.executeInTransaction(
            context,
            'INSERT INTO players (id, username) VALUES ($1, $2)',
            ['test-id', 'testuser']
          );
        }

        return 'success';
      });

      expect(result).toBe('success');
      expect(attempt).toBe(2); // Should have retried once
    });
  });

  describe('Conflict Resolution', () => {
    it('should handle serialization conflicts with retry strategy', async () => {
      const context = await transactionManager.beginTransaction({
        isolationLevel: 'serializable'
      });

      // This should trigger conflict resolution
      await expect(
        transactionManager.executeInTransaction(
          context,
          'SERIALIZATION_TEST',
          [],
          {
            conflictStrategy: { type: 'retry', maxRetries: 2 }
          }
        )
      ).rejects.toThrow();

      await transactionManager.rollbackTransaction(context);
    });

    it('should handle conflicts with abort strategy', async () => {
      const context = await transactionManager.beginTransaction();

      await expect(
        transactionManager.executeInTransaction(
          context,
          'SERIALIZATION_TEST',
          [],
          {
            conflictStrategy: { type: 'abort' }
          }
        )
      ).rejects.toThrow('Conflict detected - aborting');

      await transactionManager.rollbackTransaction(context);
    });
  });

  describe('Lock Management', () => {
    it('should acquire and release locks', async () => {
      const context = await transactionManager.beginTransaction();

      // Test row lock
      await transactionManager.executeInTransaction(
        context,
        'SELECT * FROM players WHERE id = $1',
        ['test-id'],
        {
          lockConfig: {
            type: 'row',
            mode: 'exclusive',
            timeout: 5000
          }
        }
      );

      expect(context.operations).toHaveLength(1);

      await transactionManager.commitTransaction(context);
    });
  });

  describe('ACID Compliance', () => {
    it('should ensure atomicity with multiple operations', async () => {
      const operations = [
        async (context: any) => transactionManager.executeInTransaction(
          context,
          'INSERT INTO players (id, username) VALUES ($1, $2)',
          ['player1', 'user1']
        ),
        async (context: any) => transactionManager.executeInTransaction(
          context,
          'INSERT INTO players (id, username) VALUES ($1, $2)',
          ['player2', 'user2']
        )
      ];

      const results = await ACIDCompliance.ensureAtomicity(transactionManager, operations);

      expect(results).toHaveLength(2);
      expect(MockDatabaseClient.getTransactionState()).toBe('committed');
    });

    it('should validate consistency with business rules', async () => {
      const context = await transactionManager.beginTransaction();

      const validators = [
        BusinessRuleValidators.createBankrollValidator(),
        BusinessRuleValidators.createGameStateValidator(),
        BusinessRuleValidators.createReferentialIntegrityValidator()
      ];

      const result = await ACIDCompliance.enforceConsistency(context, validators);

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);

      await transactionManager.rollbackTransaction(context);
    });

    it('should verify isolation level', async () => {
      const context = await transactionManager.beginTransaction({
        isolationLevel: 'read_committed'
      });

      const isCorrectIsolation = await ACIDCompliance.verifyIsolation(context, 'read committed');

      expect(isCorrectIsolation).toBe(true);

      await transactionManager.rollbackTransaction(context);
    });

    it('should ensure durability', async () => {
      const context = await transactionManager.beginTransaction();

      await transactionManager.executeInTransaction(
        context,
        'INSERT INTO players (id, username) VALUES ($1, $2)',
        ['test-id', 'testuser']
      );

      const isDurable = await ACIDCompliance.ensureDurability(context, [
        'SELECT COUNT(*) FROM players WHERE id = \'test-id\''
      ]);

      expect(isDurable).toBe(true);

      await transactionManager.commitTransaction(context);
    });
  });

  describe('Optimistic Concurrency Control', () => {
    it('should update with version checking', async () => {
      const context = await transactionManager.beginTransaction();

      const success = await OptimisticConcurrencyControl.updateWithVersionCheck(
        context,
        'players',
        'test-id',
        { username: 'updated_user' },
        1
      );

      expect(success).toBe(true);

      await transactionManager.rollbackTransaction(context);
    });

    it('should select for update with version tracking', async () => {
      const context = await transactionManager.beginTransaction();

      const result = await OptimisticConcurrencyControl.selectForUpdateWithVersion(
        context,
        'players',
        'test-id'
      );

      // Mock returns empty rows, so result should be null
      expect(result).toBeNull();

      await transactionManager.rollbackTransaction(context);
    });
  });

  describe('Performance and Statistics', () => {
    it('should provide transaction statistics', () => {
      const stats = transactionManager.getTransactionStats();

      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('committed');
      expect(stats).toHaveProperty('aborted');
      expect(stats).toHaveProperty('avgDuration');
      expect(stats).toHaveProperty('deadlocks');
      expect(stats).toHaveProperty('conflicts');
    });

    it('should list active transactions', async () => {
      const context1 = await transactionManager.beginTransaction();
      const context2 = await transactionManager.beginTransaction();

      const activeTransactions = transactionManager.getActiveTransactions();

      expect(activeTransactions).toHaveLength(2);
      expect(activeTransactions[0]).toHaveProperty('id');
      expect(activeTransactions[0]).toHaveProperty('startTime');
      expect(activeTransactions[0]).toHaveProperty('status');

      await transactionManager.rollbackTransaction(context1);
      await transactionManager.rollbackTransaction(context2);
    });

    it('should force abort transactions', async () => {
      const context = await transactionManager.beginTransaction();
      const transactionId = context.id;

      await transactionManager.forceAbortTransaction(transactionId);

      expect(context.status).toBe('aborted');
    });
  });

  describe('Error Handling', () => {
    it('should handle transaction errors gracefully', async () => {
      // TypeScript would prevent this at compile time, but we test runtime behavior
      const invalidConfig = { isolationLevel: 'invalid_level' as any };
      await expect(
        transactionManager.beginTransaction(invalidConfig)
      ).rejects.toMatchObject({
        name: 'TransactionError',
        code: 'INVALID_CONFIG',
        message: expect.stringContaining('Invalid isolation level')
      });
    });

    it('should handle invalid transaction state operations', async () => {
      const context = await transactionManager.beginTransaction();
      await transactionManager.commitTransaction(context);

      // Try to operate on committed transaction
      await expect(
        transactionManager.executeInTransaction(context, 'SELECT 1')
      ).rejects.toMatchObject({
        name: 'TransactionError',
        message: expect.stringContaining('Transaction is not active')
      });
    });

    it('should handle savepoint errors', async () => {
      const context = await transactionManager.beginTransaction();

      await expect(
        transactionManager.rollbackToSavepoint(context, 'non_existent')
      ).rejects.toMatchObject({
        name: 'TransactionError',
        message: expect.stringContaining('Savepoint non_existent does not exist')
      });

      await transactionManager.rollbackTransaction(context);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent transactions', async () => {
      const promises = Array.from({ length: 5 }, async (_, i) => {
        return transactionManager.withTransaction(async (context) => {
          await transactionManager.executeInTransaction(
            context,
            'INSERT INTO players (id, username) VALUES ($1, $2)',
            [`player-${i}`, `user${i}`]
          );
          
          // Simulate some processing time
          await new Promise(resolve => setTimeout(resolve, 10));
          
          return i;
        });
      });

      const results = await Promise.all(promises);

      expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle transaction cleanup properly', async () => {
      const contexts = await Promise.all([
        transactionManager.beginTransaction(),
        transactionManager.beginTransaction(),
        transactionManager.beginTransaction()
      ]);

      expect(transactionManager.getActiveTransactions()).toHaveLength(3);

      await transactionManager.cleanup();

      expect(transactionManager.getActiveTransactions()).toHaveLength(0);
    });
  });

  describe('Factory Pattern', () => {
    it('should create transaction manager with factory', () => {
      const manager = TransactionManagerFactory.create(mockDbPool);

      expect(manager).toBeInstanceOf(TransactionManager);
    });

    it('should create transaction manager with custom config', () => {
      const defaultConfig: Partial<TransactionConfig> = {
        isolationLevel: 'serializable',
        timeout: 60000
      };

      const manager = TransactionManagerFactory.createWithConfig(mockDbPool, defaultConfig);

      expect(manager).toBeInstanceOf(TransactionManager);
    });
  });
});
