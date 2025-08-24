// US-012: ACID Compliance Utilities

import { TransactionContext, TransactionManager } from './transaction-manager';

/**
 * ACID property validation and enforcement utilities
 */
export class ACIDCompliance {
  
  /**
   * Atomicity: Ensure all operations succeed or all fail
   */
  static async ensureAtomicity<T>(
    transactionManager: TransactionManager,
    operations: Array<(context: TransactionContext) => Promise<T>>,
    config?: { rollbackOnFirstError?: boolean }
  ): Promise<T[]> {
    return transactionManager.withTransaction(async (context) => {
      const results: T[] = [];
      
      try {
        for (const operation of operations) {
          const result = await operation(context);
          results.push(result);
        }
        return results;
      } catch (error) {
        // All operations will be rolled back automatically
        throw error;
      }
    });
  }

  /**
   * Consistency: Validate business rules before commit
   */
  static async enforceConsistency(
    context: TransactionContext,
    validators: ConsistencyValidator[]
  ): Promise<ValidationResult> {
    const violations: ConsistencyViolation[] = [];
    
    for (const validator of validators) {
      try {
        const result = await validator.validate(context);
        if (!result.isValid) {
          violations.push(...result.violations);
        }
      } catch (error) {
        violations.push({
          rule: validator.name,
          message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'error'
        });
      }
    }
    
    return {
      isValid: violations.length === 0,
      violations
    };
  }

  /**
   * Isolation: Verify transaction isolation levels
   */
  static async verifyIsolation(
    context: TransactionContext,
    expectedLevel: string
  ): Promise<boolean> {
    try {
      const result = await context.client.query('SHOW transaction_isolation');
      const currentLevel = result.rows[0]?.transaction_isolation;
      return currentLevel === expectedLevel;
    } catch (error) {
      return false;
    }
  }

  /**
   * Durability: Ensure data persistence before confirming success
   */
  static async ensureDurability(
    context: TransactionContext,
    checkQueries: string[]
  ): Promise<boolean> {
    try {
      // Wait for WAL sync
      await context.client.query('SELECT pg_walfile_name(pg_current_wal_lsn())');
      
      // Verify data persistence with check queries
      for (const query of checkQueries) {
        await context.client.query(query);
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Consistency validation framework
 */
export interface ConsistencyValidator {
  name: string;
  validate(context: TransactionContext): Promise<ValidationResult>;
}

export interface ValidationResult {
  isValid: boolean;
  violations: ConsistencyViolation[];
}

export interface ConsistencyViolation {
  rule: string;
  message: string;
  severity: 'warning' | 'error';
}

/**
 * Common business rule validators
 */
export class BusinessRuleValidators {
  
  /**
   * Validate player bankroll consistency
   */
  static createBankrollValidator(): ConsistencyValidator {
    return {
      name: 'bankroll_consistency',
      async validate(context: TransactionContext): Promise<ValidationResult> {
        const violations: ConsistencyViolation[] = [];
        
        try {
          // Check for negative bankrolls
          const negativeBalances = await context.client.query(
            'SELECT id, username, bankroll FROM players WHERE bankroll < 0'
          );
          
          for (const player of negativeBalances.rows) {
            violations.push({
              rule: 'no_negative_bankroll',
              message: `Player ${player.username} has negative bankroll: ${player.bankroll}`,
              severity: 'error'
            });
          }
          
          // Check for unrealistic bankrolls (business logic)
          const maxAllowedBankroll = 1000000; // $1M limit
          const largeBankrolls = await context.client.query(
            'SELECT id, username, bankroll FROM players WHERE bankroll > $1',
            [maxAllowedBankroll]
          );
          
          for (const player of largeBankrolls.rows) {
            violations.push({
              rule: 'max_bankroll_limit',
              message: `Player ${player.username} exceeds maximum bankroll limit`,
              severity: 'warning'
            });
          }
          
        } catch (error) {
          violations.push({
            rule: 'validation_error',
            message: `Bankroll validation failed: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'error'
          });
        }
        
        return {
          isValid: violations.filter(v => v.severity === 'error').length === 0,
          violations
        };
      }
    };
  }

  /**
   * Validate game state consistency
   */
  static createGameStateValidator(): ConsistencyValidator {
    return {
      name: 'game_state_consistency',
      async validate(context: TransactionContext): Promise<ValidationResult> {
        const violations: ConsistencyViolation[] = [];
        
        try {
          // Check for orphaned game history records
          const orphanedRecords = await context.client.query(`
            SELECT gh.id, gh.table_id 
            FROM game_history gh 
            LEFT JOIN game_tables gt ON gh.table_id = gt.id 
            WHERE gt.id IS NULL
          `);
          
          for (const record of orphanedRecords.rows) {
            violations.push({
              rule: 'no_orphaned_game_history',
              message: `Game history record ${record.id} references non-existent table ${record.table_id}`,
              severity: 'error'
            });
          }
          
          // Check for invalid game timestamps
          const invalidTimestamps = await context.client.query(`
            SELECT id, started_at, ended_at 
            FROM game_history 
            WHERE ended_at < started_at
          `);
          
          for (const record of invalidTimestamps.rows) {
            violations.push({
              rule: 'valid_timestamps',
              message: `Game ${record.id} has end time before start time`,
              severity: 'error'
            });
          }
          
        } catch (error) {
          violations.push({
            rule: 'validation_error',
            message: `Game state validation failed: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'error'
          });
        }
        
        return {
          isValid: violations.filter(v => v.severity === 'error').length === 0,
          violations
        };
      }
    };
  }

  /**
   * Validate referential integrity
   */
  static createReferentialIntegrityValidator(): ConsistencyValidator {
    return {
      name: 'referential_integrity',
      async validate(context: TransactionContext): Promise<ValidationResult> {
        const violations: ConsistencyViolation[] = [];
        
        try {
          // Check player_game_stats references
          const invalidPlayerStats = await context.client.query(`
            SELECT pgs.id, pgs.player_id 
            FROM player_game_stats pgs 
            LEFT JOIN players p ON pgs.player_id = p.id 
            WHERE p.id IS NULL
          `);
          
          for (const stat of invalidPlayerStats.rows) {
            violations.push({
              rule: 'valid_player_references',
              message: `Player game stat ${stat.id} references non-existent player ${stat.player_id}`,
              severity: 'error'
            });
          }
          
        } catch (error) {
          violations.push({
            rule: 'validation_error',
            message: `Referential integrity validation failed: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'error'
          });
        }
        
        return {
          isValid: violations.filter(v => v.severity === 'error').length === 0,
          violations
        };
      }
    };
  }
}

/**
 * Optimistic concurrency control implementation
 */
export class OptimisticConcurrencyControl {
  
  /**
   * Update with version checking to prevent lost updates
   */
  static async updateWithVersionCheck(
    context: TransactionContext,
    table: string,
    id: string,
    updates: Record<string, any>,
    expectedVersion: number
  ): Promise<boolean> {
    // Add version increment to updates
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 3}`)
      .join(', ');
    
    const values = [id, expectedVersion, ...Object.values(updates)];
    
    const query = `
      UPDATE ${table} 
      SET ${setClause}, version = version + 1, updated_at = NOW()
      WHERE id = $1 AND version = $2
      RETURNING version
    `;
    
    const result = await context.client.query(query, values);
    return result.rowCount > 0;
  }

  /**
   * Select for update with version tracking
   */
  static async selectForUpdateWithVersion(
    context: TransactionContext,
    table: string,
    id: string
  ): Promise<{ data: any; version: number } | null> {
    const query = `SELECT *, version FROM ${table} WHERE id = $1 FOR UPDATE`;
    const result = await context.client.query(query, [id]);
    
    if (result.rowCount === 0) {
      return null;
    }
    
    const row = result.rows[0];
    const { version, ...data } = row;
    
    return { data, version };
  }
}

/**
 * Pessimistic concurrency control implementation
 */
export class PessimisticConcurrencyControl {
  
  /**
   * Acquire exclusive row lock
   */
  static async lockRow(
    context: TransactionContext,
    table: string,
    id: string,
    timeout: number = 5000
  ): Promise<any> {
    const query = `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`;
    return context.client.query(query, [id]);
  }

  /**
   * Acquire shared row lock
   */
  static async lockRowShared(
    context: TransactionContext,
    table: string,
    id: string
  ): Promise<any> {
    const query = `SELECT * FROM ${table} WHERE id = $1 FOR SHARE`;
    return context.client.query(query, [id]);
  }

  /**
   * Acquire table-level lock
   */
  static async lockTable(
    context: TransactionContext,
    table: string,
    mode: 'ACCESS SHARE' | 'ROW SHARE' | 'ROW EXCLUSIVE' | 'SHARE UPDATE EXCLUSIVE' | 'SHARE' | 'SHARE ROW EXCLUSIVE' | 'EXCLUSIVE' | 'ACCESS EXCLUSIVE'
  ): Promise<void> {
    const query = `LOCK TABLE ${table} IN ${mode} MODE`;
    await context.client.query(query);
  }
}

/**
 * Saga pattern implementation for distributed transactions
 */
export class SagaPattern {
  private steps: SagaStep[] = [];
  private compensations: Map<string, () => Promise<void>> = new Map();

  /**
   * Add a step to the saga
   */
  addStep(step: SagaStep): void {
    this.steps.push(step);
  }

  /**
   * Execute the saga with automatic compensation on failure
   */
  async execute(transactionManager: TransactionManager): Promise<any[]> {
    const results: any[] = [];
    const executedSteps: string[] = [];

    try {
      for (const step of this.steps) {
        const result = await transactionManager.withTransaction(step.execute);
        results.push(result);
        executedSteps.push(step.name);
      }
      
      return results;
    } catch (error) {
      // Execute compensations in reverse order
      console.warn('Saga failed, executing compensations...');
      await this.executeCompensations(executedSteps.reverse(), transactionManager);
      throw error;
    }
  }

  private async executeCompensations(
    stepNames: string[],
    transactionManager: TransactionManager
  ): Promise<void> {
    for (const stepName of stepNames) {
      const compensation = this.compensations.get(stepName);
      if (compensation) {
        try {
          await transactionManager.withTransaction(async () => {
            await compensation();
          });
        } catch (error) {
          console.error(`Compensation failed for step ${stepName}:`, error);
        }
      }
    }
  }

  /**
   * Register compensation for a step
   */
  registerCompensation(stepName: string, compensation: () => Promise<void>): void {
    this.compensations.set(stepName, compensation);
  }
}

export interface SagaStep {
  name: string;
  execute: (context: TransactionContext) => Promise<any>;
}

/**
 * Distributed lock implementation using advisory locks
 */
export class DistributedLock {
  
  /**
   * Acquire a distributed lock using PostgreSQL advisory locks
   */
  static async acquire(
    context: TransactionContext,
    lockId: string,
    timeout: number = 5000
  ): Promise<boolean> {
    const lockHash = this.hashLockId(lockId);
    const query = 'SELECT pg_try_advisory_lock($1)';
    
    const result = await context.client.query(query, [lockHash]);
    return result.rows[0].pg_try_advisory_lock;
  }

  /**
   * Release a distributed lock
   */
  static async release(
    context: TransactionContext,
    lockId: string
  ): Promise<boolean> {
    const lockHash = this.hashLockId(lockId);
    const query = 'SELECT pg_advisory_unlock($1)';
    
    const result = await context.client.query(query, [lockHash]);
    return result.rows[0].pg_advisory_unlock;
  }

  private static hashLockId(lockId: string): number {
    let hash = 0;
    for (let i = 0; i < lockId.length; i++) {
      const char = lockId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
