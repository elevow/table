// Schema Evolution (Config-driven)
// Provides a config-driven orchestrator that maps MigrationConfig into
// ZeroDowntimeMigration and executes it via SchemaEvolutionManager.

import { SchemaEvolutionManager, ZeroDowntimeMigration, EvolutionStage, EvolutionStep, ValidationConfiguration, BackwardCompatibilitySetup, RollbackConfiguration, DataMigrationPlan } from './schema-evolution';
import { DataTransformationService, DataTransformation } from './data-transformation-service';

// Technical Notes: MigrationConfig and related interfaces
export interface MigrationConfig {
  version: string;
  dependencies: string[];
  preChecks: MigrationCheck[];
  steps: MigrationStep[];
  postChecks: MigrationCheck[];
  rollback: RollbackStep[];
  description?: string;
  backwardCompatibility?: BackwardCompatibilitySetup;
}

export interface MigrationCheck {
  name: string;
  sql: string;
  expected?: Record<string, any>;
  errorMessage?: string;
}

export type StepType = 'addColumn' | 'dropColumn' | 'modifyColumn' | 'addIndex' | 'custom' | 'dataTransformation';

export interface MigrationStep {
  type: StepType;
  table: string;
  details: any; // shape varies per type
}

export interface RollbackStep {
  sql: string;
}

/**
 * Maps generic MigrationConfig into a concrete ZeroDowntimeMigration and runs it
 */
export class ConfigDrivenMigrationManager {
  constructor(private evolution: SchemaEvolutionManager, private transformer?: DataTransformationService) {}

  /** Build a ZeroDowntimeMigration from a generic config */
  buildFromConfig(cfg: MigrationConfig): ZeroDowntimeMigration {
    const stages: EvolutionStage[] = [];
    const stageSteps: EvolutionStep[] = [];
    const validations: ValidationConfiguration = {
      validators: [],
      dataIntegrityChecks: []
    };

  const dataMigrationOps: DataMigrationPlan['operations'] = [];
  let dataBatchSize: number | undefined;

    // Pre-checks become validators (soft gate before execution)
    for (const c of cfg.preChecks || []) {
      validations.validators.push({
        name: c.name,
        sql: c.sql,
        expectedResult: c.expected ?? {},
        errorMessage: c.errorMessage ?? `Pre-check failed: ${c.name}`
      });
    }

    for (const s of cfg.steps || []) {
      switch (s.type) {
        case 'addColumn': {
          const { columnName, dataType, nullable, defaultValue } = s.details;
          const sql = `ALTER TABLE ${s.table} ADD COLUMN IF NOT EXISTS ${columnName} ${dataType}${nullable ? '' : ' NOT NULL'}${defaultValue ? ` DEFAULT ${defaultValue}` : ''}`;
          stageSteps.push({ sql });
          break;
        }
        case 'dropColumn': {
          const { columnName } = s.details;
          stageSteps.push({ sql: `ALTER TABLE ${s.table} DROP COLUMN IF EXISTS ${columnName}` });
          break;
        }
        case 'modifyColumn': {
          const { columnName, newType, notNull, dropNotNull, defaultValue } = s.details;
          if (newType) stageSteps.push({ sql: `ALTER TABLE ${s.table} ALTER COLUMN ${columnName} TYPE ${newType}` });
          if (notNull) stageSteps.push({ sql: `ALTER TABLE ${s.table} ALTER COLUMN ${columnName} SET NOT NULL` });
          if (dropNotNull) stageSteps.push({ sql: `ALTER TABLE ${s.table} ALTER COLUMN ${columnName} DROP NOT NULL` });
          if (defaultValue !== undefined) stageSteps.push({ sql: `ALTER TABLE ${s.table} ALTER COLUMN ${columnName} SET DEFAULT ${defaultValue}` });
          break;
        }
        case 'addIndex': {
          const { columns, indexName, where } = s.details as { columns: string[]; indexName?: string; where?: string };
          const idx = indexName || `idx_${s.table}_${columns.join('_')}`;
          stageSteps.push({
            sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx} ON ${s.table} (${columns.join(', ')})${where ? ` WHERE ${where}` : ''}`,
            retryPolicy: { maxAttempts: 3, delayMs: 5000 }
          });
          break;
        }
        case 'custom': {
          const { sql, batch } = s.details as { sql: string; batch?: boolean };
          if (batch && sql.includes('{LIMIT}') && sql.includes('{OFFSET}')) {
            dataMigrationOps.push({ sql, description: 'Config-driven batched operation' });
          } else {
            stageSteps.push({ sql });
          }
          break;
        }
        case 'dataTransformation': {
          if (!this.transformer) {
            throw new Error('DataTransformationService not provided to ConfigDrivenMigrationManager');
          }
          const { transformation, batchSize, description } = s.details as { transformation: DataTransformation; batchSize?: number; description?: string };
          const plan = this.transformer.plan(transformation);
          // Schema changes from the transformation plan become evolution steps
          for (const sc of plan.schemaChanges) {
            stageSteps.push({ sql: sc.sql });
          }
          // Data steps become data migration operations with batching handled by SchemaEvolutionManager
          for (const ds of plan.dataSteps) {
            dataMigrationOps.push({ sql: ds.sql, description: description || ds.description || 'Data transformation step' });
          }
          if (typeof batchSize === 'number') {
            dataBatchSize = batchSize;
          }
          break;
        }
        default:
          const neverType: never = (s as any).type;
          throw new Error(`Unsupported step type: ${neverType}`);
      }
    }

    if (stageSteps.length) {
      stages.push({ name: 'apply_steps', description: 'Apply configured schema steps', steps: stageSteps, canRollback: true });
    }

    // Post-checks become validators to run after execution as part of post-migration validation
    for (const c of cfg.postChecks || []) {
      validations.validators.push({
        name: c.name,
        sql: c.sql,
        expectedResult: c.expected ?? {},
        errorMessage: c.errorMessage ?? `Post-check failed: ${c.name}`
      });
    }

    const rollback: RollbackConfiguration | undefined = (cfg.rollback && cfg.rollback.length)
      ? { steps: cfg.rollback.map(r => ({ sql: r.sql })), safetyChecks: [] }
      : undefined;

    const zero: ZeroDowntimeMigration = {
      version: cfg.version,
      description: cfg.description || 'Config-driven schema migration',
      dependencies: cfg.dependencies || [],
      stages,
      dataMigration: dataMigrationOps.length ? { operations: dataMigrationOps, batchSize: dataBatchSize } : undefined,
      backwardCompatibility: cfg.backwardCompatibility,
      rollback,
      validation: validations
    };

    return zero;
  }

  /** Validate and execute the migration based on the config */
  async run(cfg: MigrationConfig) {
    const migration = this.buildFromConfig(cfg);
    const validation = await this.evolution.validateEvolutionPlan(migration);
    if (!validation.isValid) {
      const msgs = validation.issues.map(i => i.message).join(', ');
      throw new Error(`Migration validation failed: ${msgs}`);
    }
    return this.evolution.executeZeroDowntimeMigration(migration);
  }

  /** Delegate rollback to SchemaEvolutionManager */
  async rollbackTo(version: string) {
    return this.evolution.rollbackToVersion(version);
  }
}
