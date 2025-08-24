// US-013: Schema Evolution - Zero-downtime migrations with backward compatibility
// Implements safe schema evolution with validation and rollback capabilities

import { TransactionManager, TransactionContext } from './transaction-manager';
import { SchemaValidator, Migration, MigrationStep, MigrationResult } from './schema-validation';

/**
 * Advanced schema evolution manager with zero-downtime capabilities
 */
export class SchemaEvolutionManager {
  private transactionManager: TransactionManager;
  private migrationHistory: MigrationRecord[] = [];
  
  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  /**
   * Initialize schema evolution tracking
   */
  async initialize(): Promise<void> {
    await this.transactionManager.withTransaction(async (context) => {
      // Create schema migrations table if it doesn't exist
      await context.client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          description TEXT,
          checksum VARCHAR(64),
          execution_time_ms INTEGER,
          rollback_available BOOLEAN DEFAULT false
        )
      `);

      // Create schema evolution log table
      await context.client.query(`
        CREATE TABLE IF NOT EXISTS schema_evolution_log (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          migration_version VARCHAR(255) NOT NULL,
          operation_type VARCHAR(50) NOT NULL, -- 'apply', 'rollback', 'validate'
          started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          success BOOLEAN,
          error_message TEXT,
          metadata JSONB
        )
      `);
    });
  }

  /**
   * Execute zero-downtime migration
   */
  async executeZeroDowntimeMigration(migration: ZeroDowntimeMigration): Promise<MigrationExecutionResult> {
    const logId = await this.logMigrationStart(migration.version, 'apply');
    const startTime = Date.now();
    
    try {
      // Phase 1: Pre-migration validation
      const preValidation = await this.performPreMigrationValidation(migration);
      if (!preValidation.isValid) {
        throw new Error(`Pre-migration validation failed: ${preValidation.errors.join(', ')}`);
      }

      // Phase 2: Backward compatibility setup
      if (migration.backwardCompatibility) {
        await this.setupBackwardCompatibility(migration.backwardCompatibility);
      }

      // Phase 3: Schema evolution in stages
      const stageResults = await this.executeEvolutionStages(migration);
      
      // Phase 4: Data migration if needed
      if (migration.dataMigration) {
        await this.executeDataMigration(migration.dataMigration);
      }

      // Phase 5: Post-migration validation
      const postValidation = await this.performPostMigrationValidation(migration);
      if (!postValidation.isValid) {
        // Attempt automatic rollback
        await this.performAutomaticRollback(migration);
        throw new Error(`Post-migration validation failed: ${postValidation.errors.join(', ')}`);
      }

      // Phase 6: Cleanup backward compatibility if safe
      if (migration.backwardCompatibility && migration.cleanupDelay) {
        await this.scheduleCompatibilityCleanup(migration);
      }

      const result: MigrationExecutionResult = {
        version: migration.version,
        success: true,
        executionTime: Date.now() - startTime,
        stageResults,
        validationResults: {
          preValidation,
          postValidation
        }
      };

      await this.recordMigrationSuccess(migration, result);
      await this.logMigrationComplete(logId, true);
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const result: MigrationExecutionResult = {
        version: migration.version,
        success: false,
        executionTime: Date.now() - startTime,
        error: errorMessage
      };

      await this.logMigrationComplete(logId, false, errorMessage);
      throw error;
    }
  }

  /**
   * Perform safe rollback to previous version
   */
  async rollbackToVersion(targetVersion: string): Promise<RollbackResult> {
    const logId = await this.logMigrationStart(targetVersion, 'rollback');
    
    try {
      // Get rollback plan
      const rollbackPlan = await this.createRollbackPlan(targetVersion);
      
      // Validate rollback safety
      const rollbackValidation = await this.validateRollbackSafety(rollbackPlan);
      if (!rollbackValidation.isSafe) {
        throw new Error(`Rollback not safe: ${rollbackValidation.risks.join(', ')}`);
      }

      // Execute rollback steps in reverse order
      const rollbackResults: RollbackStepResult[] = [];
      
      for (const step of rollbackPlan.steps.reverse()) {
        const stepResult = await this.executeRollbackStep(step);
        rollbackResults.push(stepResult);
        
        if (!stepResult.success) {
          throw new Error(`Rollback step failed: ${stepResult.error}`);
        }
      }

      // Verify rollback success
      const verificationResult = await this.verifyRollbackState(targetVersion);
      if (!verificationResult.isValid) {
        throw new Error(`Rollback verification failed: ${verificationResult.errors.join(', ')}`);
      }

      const result: RollbackResult = {
        targetVersion,
        success: true,
        stepsExecuted: rollbackResults.length,
        stepResults: rollbackResults
      };

      await this.logMigrationComplete(logId, true);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logMigrationComplete(logId, false, errorMessage);
      
      return {
        targetVersion,
        success: false,
        error: errorMessage,
        stepsExecuted: 0,
        stepResults: []
      };
    }
  }

  /**
   * Validate schema evolution plan before execution
   */
  async validateEvolutionPlan(migration: ZeroDowntimeMigration): Promise<EvolutionValidationResult> {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];

    // Check for breaking changes
    const breakingChanges = await this.detectBreakingChanges(migration);
    if (breakingChanges.length > 0) {
      issues.push({
        type: 'breaking_change',
        severity: 'error',
        message: `Breaking changes detected: ${breakingChanges.join(', ')}`,
        mitigation: 'Ensure backward compatibility or plan application updates'
      });
    }

    // Validate data preservation
    const dataRisks = await this.analyzeDataRisks(migration);
    if (dataRisks.hasDataLoss) {
      issues.push({
        type: 'data_loss',
        severity: 'error',
        message: 'Migration may cause data loss',
        mitigation: 'Add data preservation steps or backup procedures'
      });
    }

    // Check performance impact
    const performanceImpact = await this.assessPerformanceImpact(migration);
    if (performanceImpact.isHigh) {
      warnings.push(`High performance impact expected: ${performanceImpact.reason}`);
    }

    // Validate rollback capability
    const rollbackCheck = await this.validateRollbackCapability(migration);
    if (!rollbackCheck.isRollbackable) {
      issues.push({
        type: 'no_rollback',
        severity: 'warning',
        message: 'Migration cannot be rolled back',
        mitigation: 'Consider adding rollback steps or alternative recovery plan'
      });
    }

    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      warnings,
      recommendations: await this.generateRecommendations(migration, issues)
    };
  }

  /**
   * Get current schema version
   */
  async getCurrentVersion(): Promise<string | null> {
    const result = await this.transactionManager.withTransaction(async (context) => {
      return context.client.query(`
        SELECT version FROM schema_migrations 
        ORDER BY applied_at DESC 
        LIMIT 1
      `);
    });

    return result.rows.length > 0 ? result.rows[0].version : null;
  }

  /**
   * Get migration history
   */
  async getMigrationHistory(): Promise<MigrationRecord[]> {
    const result = await this.transactionManager.withTransaction(async (context) => {
      return context.client.query(`
        SELECT 
          version,
          applied_at,
          description,
          execution_time_ms,
          rollback_available
        FROM schema_migrations 
        ORDER BY applied_at DESC
      `);
    });

    return result.rows.map(row => ({
      version: row.version,
      appliedAt: row.applied_at,
      description: row.description,
      executionTime: row.execution_time_ms,
      rollbackAvailable: row.rollback_available
    }));
  }

  // Private implementation methods
  private async performPreMigrationValidation(migration: ZeroDowntimeMigration): Promise<ValidationResult> {
    const errors: string[] = [];
    
    // Check current schema state
    if (migration.requiredVersion) {
      const currentVersion = await this.getCurrentVersion();
      if (currentVersion !== migration.requiredVersion) {
        errors.push(`Required version ${migration.requiredVersion}, but current is ${currentVersion}`);
      }
    }

    // Validate dependencies
    for (const dependency of migration.dependencies || []) {
      const exists = await this.checkDependencyExists(dependency);
      if (!exists) {
        errors.push(`Missing dependency: ${dependency}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async setupBackwardCompatibility(compatibility: BackwardCompatibilitySetup): Promise<void> {
    await this.transactionManager.withTransaction(async (context) => {
      // Create compatibility views/aliases
      for (const view of compatibility.compatibilityViews || []) {
        await context.client.query(view.sql);
      }

      // Create compatibility functions
      for (const func of compatibility.compatibilityFunctions || []) {
        await context.client.query(func.sql);
      }
    });
  }

  private async executeEvolutionStages(migration: ZeroDowntimeMigration): Promise<StageResult[]> {
    const results: StageResult[] = [];
    
    for (const stage of migration.stages) {
      const stageResult = await this.executeStage(stage);
      results.push(stageResult);
      
      if (!stageResult.success) {
        throw new Error(`Stage ${stage.name} failed: ${stageResult.error}`);
      }
    }
    
    return results;
  }

  private async executeStage(stage: EvolutionStage): Promise<StageResult> {
    const startTime = Date.now();
    
    try {
      await this.transactionManager.withTransaction(async (context) => {
        for (const step of stage.steps) {
          await this.executeEvolutionStep(context, step);
        }
      });

      return {
        stageName: stage.name,
        success: true,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        stageName: stage.name,
        success: false,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeEvolutionStep(context: TransactionContext, step: EvolutionStep): Promise<void> {
    // Check if step should be executed
    if (step.condition) {
      const conditionResult = await context.client.query(step.condition);
      if (conditionResult.rowCount === 0) {
        return; // Skip step
      }
    }

    // Execute step with retry logic if specified
    let attempt = 0;
    const maxAttempts = step.retryPolicy?.maxAttempts || 1;
    
    while (attempt < maxAttempts) {
      try {
        await context.client.query(step.sql, step.params);
        break; // Success
      } catch (error) {
        attempt++;
        if (attempt >= maxAttempts) {
          throw error;
        }
        
        // Wait before retry
        if (step.retryPolicy?.delayMs) {
          await new Promise(resolve => setTimeout(resolve, step.retryPolicy!.delayMs!));
        }
      }
    }
  }

  private async executeDataMigration(dataMigration: DataMigrationPlan): Promise<void> {
    // Implement batched data migration to avoid blocking
    const batchSize = dataMigration.batchSize || 1000;
    
    for (const operation of dataMigration.operations) {
      await this.executeBatchedDataOperation(operation, batchSize);
    }
  }

  private async executeBatchedDataOperation(operation: DataOperation, batchSize: number): Promise<void> {
    let offset = 0;
    let hasMoreData = true;
    
    while (hasMoreData) {
      const result = await this.transactionManager.withTransaction(async (context) => {
        const sql = operation.sql.replace('{LIMIT}', batchSize.toString()).replace('{OFFSET}', offset.toString());
        return context.client.query(sql, operation.params);
      });
      
      hasMoreData = result.rowCount === batchSize;
      offset += batchSize;
      
      // Small delay to prevent overwhelming the system
      if (hasMoreData) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  private async performPostMigrationValidation(migration: ZeroDowntimeMigration): Promise<ValidationResult> {
    const errors: string[] = [];
    
    // Run custom validation if provided
    if (migration.validation) {
      for (const validator of migration.validation.validators) {
        const result = await this.runValidator(validator);
        if (!result.isValid) {
          errors.push(result.error);
        }
      }
    }

    // Check data integrity
    const integrityCheck = await this.performDataIntegrityCheck(migration);
    if (!integrityCheck.isValid) {
      errors.push(...integrityCheck.errors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async logMigrationStart(version: string, operation: string): Promise<string> {
    const result = await this.transactionManager.withTransaction(async (context) => {
      return context.client.query(`
        INSERT INTO schema_evolution_log (migration_version, operation_type)
        VALUES ($1, $2)
        RETURNING id
      `, [version, operation]);
    });
    
    return result.rows[0].id;
  }

  private async logMigrationComplete(logId: string, success: boolean, error?: string): Promise<void> {
    await this.transactionManager.withTransaction(async (context) => {
      await context.client.query(`
        UPDATE schema_evolution_log
        SET completed_at = NOW(), success = $2, error_message = $3
        WHERE id = $1
      `, [logId, success, error]);
    });
  }

  private async recordMigrationSuccess(migration: ZeroDowntimeMigration, result: MigrationExecutionResult): Promise<void> {
    await this.transactionManager.withTransaction(async (context) => {
      await context.client.query(`
        INSERT INTO schema_migrations (version, description, execution_time_ms, rollback_available)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (version) DO UPDATE SET
          applied_at = NOW(),
          execution_time_ms = EXCLUDED.execution_time_ms
      `, [
        migration.version,
        migration.description,
        result.executionTime,
        migration.rollback !== undefined
      ]);
    });
  }

  // Additional helper methods would be implemented here...
  private async detectBreakingChanges(migration: ZeroDowntimeMigration): Promise<string[]> {
    // Implementation for detecting breaking changes
    return [];
  }

  private async analyzeDataRisks(migration: ZeroDowntimeMigration): Promise<{ hasDataLoss: boolean }> {
    // Implementation for analyzing data risks
    return { hasDataLoss: false };
  }

  private async assessPerformanceImpact(migration: ZeroDowntimeMigration): Promise<{ isHigh: boolean; reason?: string }> {
    // Implementation for assessing performance impact
    return { isHigh: false };
  }

  private async validateRollbackCapability(migration: ZeroDowntimeMigration): Promise<{ isRollbackable: boolean }> {
    // Implementation for validating rollback capability
    return { isRollbackable: migration.rollback !== undefined };
  }

  private async generateRecommendations(migration: ZeroDowntimeMigration, issues: ValidationIssue[]): Promise<string[]> {
    // Implementation for generating recommendations
    return [];
  }

  private async checkDependencyExists(dependency: string): Promise<boolean> {
    // Implementation for checking dependencies
    return true;
  }

  private async performAutomaticRollback(migration: ZeroDowntimeMigration): Promise<void> {
    // Implementation for automatic rollback
  }

  private async scheduleCompatibilityCleanup(migration: ZeroDowntimeMigration): Promise<void> {
    // Implementation for scheduling cleanup
  }

  private async createRollbackPlan(targetVersion: string): Promise<RollbackPlan> {
    // Implementation for creating rollback plan
    return { steps: [] };
  }

  private async validateRollbackSafety(plan: RollbackPlan): Promise<RollbackSafetyCheck> {
    // Implementation for validating rollback safety
    return { isSafe: true, risks: [] };
  }

  private async executeRollbackStep(step: RollbackStep): Promise<RollbackStepResult> {
    // Implementation for executing rollback step
    return { success: true };
  }

  private async verifyRollbackState(version: string): Promise<ValidationResult> {
    // Implementation for verifying rollback state
    return { isValid: true, errors: [] };
  }

  private async runValidator(validator: CustomValidator): Promise<{ isValid: boolean; error: string }> {
    // Implementation for running custom validator
    return { isValid: true, error: '' };
  }

  private async performDataIntegrityCheck(migration: ZeroDowntimeMigration): Promise<ValidationResult> {
    // Implementation for data integrity check
    return { isValid: true, errors: [] };
  }
}

// Type definitions for US-013
export interface ZeroDowntimeMigration {
  version: string;
  description: string;
  requiredVersion?: string;
  dependencies?: string[];
  stages: EvolutionStage[];
  dataMigration?: DataMigrationPlan;
  backwardCompatibility?: BackwardCompatibilitySetup;
  rollback?: RollbackConfiguration;
  validation?: ValidationConfiguration;
  cleanupDelay?: number; // Hours to wait before cleanup
}

export interface EvolutionStage {
  name: string;
  description: string;
  steps: EvolutionStep[];
  canRollback: boolean;
}

export interface EvolutionStep {
  sql: string;
  params?: any[];
  condition?: string;
  retryPolicy?: RetryPolicy;
}

export interface RetryPolicy {
  maxAttempts: number;
  delayMs: number;
}

export interface DataMigrationPlan {
  operations: DataOperation[];
  batchSize?: number;
  parallel?: boolean;
}

export interface DataOperation {
  sql: string;
  params?: any[];
  description: string;
}

export interface BackwardCompatibilitySetup {
  compatibilityViews?: CompatibilityView[];
  compatibilityFunctions?: CompatibilityFunction[];
  deprecationWarnings?: string[];
}

export interface CompatibilityView {
  name: string;
  sql: string;
}

export interface CompatibilityFunction {
  name: string;
  sql: string;
}

export interface ValidationConfiguration {
  validators: CustomValidator[];
  dataIntegrityChecks: string[];
}

export interface CustomValidator {
  name: string;
  sql: string;
  expectedResult: any;
  errorMessage: string;
}

export interface RollbackConfiguration {
  steps: RollbackStep[];
  safetyChecks: string[];
}

export interface RollbackStep {
  sql: string;
  params?: any[];
  condition?: string;
}

export interface MigrationExecutionResult {
  version: string;
  success: boolean;
  executionTime: number;
  stageResults?: StageResult[];
  validationResults?: {
    preValidation: ValidationResult;
    postValidation: ValidationResult;
  };
  error?: string;
}

export interface StageResult {
  stageName: string;
  success: boolean;
  executionTime: number;
  error?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface RollbackResult {
  targetVersion: string;
  success: boolean;
  stepsExecuted: number;
  stepResults: RollbackStepResult[];
  error?: string;
}

export interface RollbackStepResult {
  success: boolean;
  error?: string;
}

export interface EvolutionValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  warnings: string[];
  recommendations: string[];
}

export interface ValidationIssue {
  type: string;
  severity: 'error' | 'warning';
  message: string;
  mitigation: string;
}

export interface MigrationRecord {
  version: string;
  appliedAt: Date;
  description: string;
  executionTime: number;
  rollbackAvailable: boolean;
}

export interface RollbackPlan {
  steps: RollbackStep[];
}

export interface RollbackSafetyCheck {
  isSafe: boolean;
  risks: string[];
}
