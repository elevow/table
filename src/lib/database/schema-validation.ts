// US-012: Database Schema Validation and Migration Support

import { TransactionContext, TransactionManager } from './transaction-manager';
import { ACIDCompliance, ConsistencyValidator, ValidationResult } from './acid-compliance';

/**
 * Schema validation utilities for maintaining data integrity
 */
export class SchemaValidator {
  
  /**
   * Validate database schema consistency
   */
  static async validateSchema(
    transactionManager: TransactionManager,
    validationRules: SchemaValidationRule[]
  ): Promise<SchemaValidationResult> {
    const violations: SchemaViolation[] = [];
    
    for (const rule of validationRules) {
      try {
        const ruleViolations = await this.executeValidationRule(transactionManager, rule);
        violations.push(...ruleViolations);
      } catch (error) {
        violations.push({
          rule: rule.name,
          type: 'system_error',
          message: `Schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'error',
          table: rule.table
        });
      }
    }
    
    return {
      isValid: violations.filter(v => v.severity === 'error').length === 0,
      violations,
      summary: this.createValidationSummary(violations)
    };
  }

  /**
   * Create foreign key constraint validator
   */
  static createForeignKeyValidator(
    referencingTable: string,
    referencingColumn: string,
    referencedTable: string,
    referencedColumn: string
  ): SchemaValidationRule {
    return {
      name: `fk_${referencingTable}_${referencingColumn}`,
      table: referencingTable,
      type: 'foreign_key',
      query: `
        SELECT COUNT(*) as violation_count
        FROM ${referencingTable} ref
        LEFT JOIN ${referencedTable} parent ON ref.${referencingColumn} = parent.${referencedColumn}
        WHERE ref.${referencingColumn} IS NOT NULL AND parent.${referencedColumn} IS NULL
      `,
      expectedResult: { violation_count: 0 },
      violationMessage: `Foreign key constraint violation: ${referencingTable}.${referencingColumn} references non-existent ${referencedTable}.${referencedColumn}`
    };
  }

  /**
   * Create unique constraint validator
   */
  static createUniqueConstraintValidator(
    table: string,
    columns: string[]
  ): SchemaValidationRule {
    const columnList = columns.join(', ');
    return {
      name: `unique_${table}_${columns.join('_')}`,
      table,
      type: 'unique_constraint',
      query: `
        SELECT ${columnList}, COUNT(*) as duplicate_count
        FROM ${table}
        WHERE ${columns.map(col => `${col} IS NOT NULL`).join(' AND ')}
        GROUP BY ${columnList}
        HAVING COUNT(*) > 1
      `,
      expectedResult: { duplicate_count: 0 },
      violationMessage: `Unique constraint violation: Duplicate values found in ${table}(${columnList})`
    };
  }

  /**
   * Create check constraint validator
   */
  static createCheckConstraintValidator(
    table: string,
    constraintName: string,
    condition: string
  ): SchemaValidationRule {
    return {
      name: `check_${table}_${constraintName}`,
      table,
      type: 'check_constraint',
      query: `
        SELECT COUNT(*) as violation_count
        FROM ${table}
        WHERE NOT (${condition})
      `,
      expectedResult: { violation_count: 0 },
      violationMessage: `Check constraint violation: ${constraintName} failed for table ${table}`
    };
  }

  /**
   * Create data type validator
   */
  static createDataTypeValidator(
    table: string,
    column: string,
    dataType: string
  ): SchemaValidationRule {
    return {
      name: `datatype_${table}_${column}`,
      table,
      type: 'data_type',
      query: `
        SELECT 
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns
        WHERE table_name = '${table}' AND column_name = '${column}'
      `,
      expectedResult: { data_type: dataType },
      violationMessage: `Data type mismatch: ${table}.${column} expected ${dataType}`
    };
  }

  private static async executeValidationRule(
    transactionManager: TransactionManager,
    rule: SchemaValidationRule
  ): Promise<SchemaViolation[]> {
    const violations: SchemaViolation[] = [];
    
    const result = await transactionManager.withTransaction(async (context) => {
      return context.client.query(rule.query);
    });

    if (rule.type === 'foreign_key' || rule.type === 'unique_constraint' || rule.type === 'check_constraint') {
      // These rules expect zero violations
      const violationCount = parseInt(result.rows[0]?.violation_count || '0');
      if (violationCount > 0) {
        violations.push({
          rule: rule.name,
          type: rule.type,
          message: rule.violationMessage,
          severity: 'error',
          table: rule.table,
          details: { violationCount, rows: result.rows }
        });
      }
    } else if (rule.type === 'data_type') {
      // Data type validation
      const actualResult = result.rows[0];
      if (!actualResult || actualResult.data_type !== rule.expectedResult.data_type) {
        violations.push({
          rule: rule.name,
          type: rule.type,
          message: rule.violationMessage,
          severity: 'error',
          table: rule.table,
          details: { expected: rule.expectedResult, actual: actualResult }
        });
      }
    }

    return violations;
  }

  private static createValidationSummary(violations: SchemaViolation[]): ValidationSummary {
    const errorCount = violations.filter(v => v.severity === 'error').length;
    const warningCount = violations.filter(v => v.severity === 'warning').length;
    
    const byType = violations.reduce((acc, violation) => {
      acc[violation.type] = (acc[violation.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byTable = violations.reduce((acc, violation) => {
      if (violation.table) {
        acc[violation.table] = (acc[violation.table] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      totalViolations: violations.length,
      errorCount,
      warningCount,
      violationsByType: byType,
      violationsByTable: byTable
    };
  }
}

/**
 * Migration utilities for safe schema evolution
 */
export class MigrationManager {
  private transactionManager: TransactionManager;
  private migrations: Migration[] = [];

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  /**
   * Add a migration to the queue
   */
  addMigration(migration: Migration): void {
    this.migrations.push(migration);
  }

  /**
   * Execute all pending migrations
   */
  async executeMigrations(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    
    for (const migration of this.migrations) {
      const result = await this.executeMigration(migration);
      results.push(result);
      
      if (!result.success) {
        break; // Stop on first failure
      }
    }
    
    return results;
  }

  /**
   * Execute a single migration
   */
  async executeMigration(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now();
    
    try {
      // Pre-migration validation
      if (migration.preValidation) {
        const validationResult = await migration.preValidation(this.transactionManager);
        if (!validationResult.isValid) {
          return {
            migrationId: migration.id,
            success: false,
            duration: Date.now() - startTime,
            error: `Pre-migration validation failed: ${validationResult.violations.map(v => v.message).join(', ')}`
          };
        }
      }

      // Execute migration in transaction
      await this.transactionManager.withTransaction(async (context) => {
        for (const step of migration.steps) {
          await this.executeMigrationStep(context, step);
        }
      });

      // Post-migration validation
      if (migration.postValidation) {
        const validationResult = await migration.postValidation(this.transactionManager);
        if (!validationResult.isValid) {
          // Attempt rollback if possible
          if (migration.rollback) {
            await this.executeRollback(migration);
          }
          
          return {
            migrationId: migration.id,
            success: false,
            duration: Date.now() - startTime,
            error: `Post-migration validation failed: ${validationResult.violations.map(v => v.message).join(', ')}`
          };
        }
      }

      return {
        migrationId: migration.id,
        success: true,
        duration: Math.max(1, Date.now() - startTime)
      };

    } catch (error) {
      // Attempt rollback on error
      if (migration.rollback) {
        try {
          await this.executeRollback(migration);
        } catch (rollbackError) {
          console.error(`Rollback failed for migration ${migration.id}:`, rollbackError);
        }
      }

      return {
        migrationId: migration.id,
        success: false,
        duration: Math.max(1, Date.now() - startTime),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute migration rollback
   */
  async executeRollback(migration: Migration): Promise<void> {
    if (!migration.rollback) {
      throw new Error(`No rollback defined for migration ${migration.id}`);
    }

    await this.transactionManager.withTransaction(async (context) => {
      for (const step of migration.rollback!) {
        await this.executeMigrationStep(context, step);
      }
    });
  }

  private async executeMigrationStep(
    context: TransactionContext,
    step: MigrationStep
  ): Promise<void> {
    if (step.condition) {
      const conditionResult = await context.client.query(step.condition);
      if (conditionResult.rowCount === 0) {
        return; // Skip step if condition not met
      }
    }

    await context.client.query(step.sql, step.params);
  }
}

/**
 * Business-specific consistency validators
 */
export class PokerGameValidators {
  
  /**
   * Validate poker game business rules
   */
  static createPokerGameValidator(): ConsistencyValidator {
    return {
      name: 'poker_game_rules',
      async validate(context: TransactionContext): Promise<ValidationResult> {
        const violations = [];

        // Validate pot calculations
        const potValidation = await context.client.query(`
          SELECT 
            gh.id,
            gh.results->>'pot_size' as declared_pot,
            (
              SELECT SUM((player_action->>'amount')::decimal)
              FROM jsonb_array_elements(gh.action_sequence) as player_action
              WHERE player_action->>'action' IN ('bet', 'call', 'raise')
            ) as calculated_pot
          FROM game_history gh
          WHERE gh.ended_at > NOW() - INTERVAL '1 hour'
        `);

        for (const game of potValidation.rows) {
          const declaredPot = parseFloat(game.declared_pot || '0');
          const calculatedPot = parseFloat(game.calculated_pot || '0');
          
          if (Math.abs(declaredPot - calculatedPot) > 0.01) {
            violations.push({
              rule: 'pot_calculation_accuracy',
              message: `Game ${game.id}: Pot mismatch. Declared: ${declaredPot}, Calculated: ${calculatedPot}`,
              severity: 'error' as const
            });
          }
        }

        // Validate hand sequences
        const sequenceValidation = await context.client.query(`
          SELECT 
            id,
            action_sequence
          FROM game_history
          WHERE ended_at > NOW() - INTERVAL '1 hour'
        `);

        for (const game of sequenceValidation.rows) {
          const actions = game.action_sequence || [];
          if (!PokerGameValidators.isValidActionSequence(actions)) {
            violations.push({
              rule: 'valid_action_sequence',
              message: `Game ${game.id}: Invalid action sequence detected`,
              severity: 'error' as const
            });
          }
        }

        return {
          isValid: violations.filter(v => v.severity === 'error').length === 0,
          violations
        };
      }
    };
  }

  private static isValidActionSequence(actions: any[]): boolean {
    // Simplified validation - in practice this would be more complex
    if (!Array.isArray(actions) || actions.length === 0) {
      return false;
    }

    // Check that actions have required fields
    for (const action of actions) {
      if (!action.player_id || !action.action || !action.timestamp) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate player bankroll changes
   */
  static createBankrollChangeValidator(): ConsistencyValidator {
    return {
      name: 'bankroll_change_validation',
      async validate(context: TransactionContext): Promise<ValidationResult> {
        const violations = [];

        // Check for suspicious bankroll changes
        const suspiciousChanges = await context.client.query(`
          SELECT 
            bh.player_id,
            p.username,
            bh.change_amount,
            bh.reason,
            bh.created_at
          FROM bankroll_history bh
          JOIN players p ON bh.player_id = p.id
          WHERE 
            bh.created_at > NOW() - INTERVAL '1 hour'
            AND ABS(bh.change_amount) > 10000 -- Large changes
            AND bh.reason NOT IN ('tournament_win', 'cashout', 'deposit')
        `);

        for (const change of suspiciousChanges.rows) {
          violations.push({
            rule: 'suspicious_bankroll_change',
            message: `Large bankroll change for ${change.username}: ${change.change_amount} (${change.reason})`,
            severity: 'warning' as const
          });
        }

        return {
          isValid: true, // Warnings don't invalidate
          violations
        };
      }
    };
  }
}

// Type definitions
export interface SchemaValidationRule {
  name: string;
  table: string;
  type: 'foreign_key' | 'unique_constraint' | 'check_constraint' | 'data_type';
  query: string;
  expectedResult: any;
  violationMessage: string;
}

export interface SchemaViolation {
  rule: string;
  type: string;
  message: string;
  severity: 'error' | 'warning';
  table?: string;
  details?: any;
}

export interface SchemaValidationResult {
  isValid: boolean;
  violations: SchemaViolation[];
  summary: ValidationSummary;
}

export interface ValidationSummary {
  totalViolations: number;
  errorCount: number;
  warningCount: number;
  violationsByType: Record<string, number>;
  violationsByTable: Record<string, number>;
}

export interface Migration {
  id: string;
  description: string;
  version: string;
  steps: MigrationStep[];
  rollback?: MigrationStep[];
  preValidation?: (tm: TransactionManager) => Promise<ValidationResult>;
  postValidation?: (tm: TransactionManager) => Promise<ValidationResult>;
}

export interface MigrationStep {
  sql: string;
  params?: any[];
  condition?: string; // Optional condition to check before executing
}

export interface MigrationResult {
  migrationId: string;
  success: boolean;
  duration: number;
  error?: string;
}
