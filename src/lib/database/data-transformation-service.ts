// US-048: Data Transformation Service
// Handles complex data transformations with schema changes, mappings, and validation.

import { TransactionManager } from './transaction-manager';

export interface SchemaColumn {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
}

export interface SchemaDefinition {
  name: string; // table name
  columns: SchemaColumn[];
}

export interface FieldMapping {
  source: string; // source column name
  target: string; // target column name
  transform?: string; // SQL expression using source alias 's', e.g., LOWER(s.username)
  typeChange?: string; // optional target type override (e.g., TEXT, INTEGER)
  nullable?: boolean;
}

export interface ValidationRule {
  name: string;
  sql: string;
  expected: Record<string, any>;
  severity?: 'error' | 'warning';
}

export interface DataTransformation {
  source: {
    table: string;
    version: string;
    schema: SchemaDefinition;
  };
  target: {
    table: string;
    version: string;
    schema: SchemaDefinition;
  };
  mapping: FieldMapping[];
  validation: ValidationRule[];
}

export interface DataTransformationPlan {
  schemaChanges: { sql: string; description?: string }[];
  dataSteps: { sql: string; description?: string }[];
}

export interface ExecuteOptions {
  batchSize?: number; // when provided, replaces {LIMIT} and {OFFSET}
  offset?: number;
  dryRun?: boolean; // when true, only returns the plan without executing
  validate?: boolean; // when true, run post-validation rules
}

export class DataTransformationService {
  constructor(private tx: TransactionManager) {}

  plan(transformation: DataTransformation): DataTransformationPlan {
    this.assertDependencies(transformation);

    const schemaChanges: DataTransformationPlan['schemaChanges'] = [];
    const dataSteps: DataTransformationPlan['dataSteps'] = [];

    // Derive schema change steps from mapping.typeChange or nullable flags
    for (const m of transformation.mapping) {
      const targetCol = transformation.target.schema.columns.find(c => c.name === m.target);
      if (!targetCol) continue;
      if (m.typeChange && m.typeChange !== targetCol.type) {
        schemaChanges.push({
          sql: `ALTER TABLE ${transformation.target.table} ALTER COLUMN ${m.target} TYPE ${m.typeChange}`,
          description: `Change type of ${m.target} to ${m.typeChange}`
        });
      }
      if (typeof m.nullable === 'boolean') {
        schemaChanges.push({
          sql: `ALTER TABLE ${transformation.target.table} ALTER COLUMN ${m.target} ${m.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`,
          description: `Set nullability of ${m.target} to ${m.nullable ? 'NULLABLE' : 'NOT NULL'}`
        });
      }
    }

    // Build data movement step (supports partial updates via ON CONFLICT DO NOTHING)
    const selectExprs: string[] = [];
    const targetCols: string[] = [];
    for (const m of transformation.mapping) {
      // ensure source column exists in source schema unless using explicit transform
      if (!m.transform) {
        const exists = transformation.source.schema.columns.some(c => c.name === m.source);
        if (!exists) {
          throw new Error(`Source column not found: ${m.source}`);
        }
      }
      targetCols.push(m.target);
      selectExprs.push(m.transform ? m.transform : `s.${m.source}`);
    }

    const insertSql = `INSERT INTO ${transformation.target.table} (${targetCols.join(', ')})\n` +
      `SELECT ${selectExprs.join(', ')}\n` +
      `FROM ${transformation.source.table} s\n` +
      `LIMIT {LIMIT} OFFSET {OFFSET}\n` +
      `ON CONFLICT DO NOTHING`;

    dataSteps.push({ sql: insertSql, description: 'Apply field mappings' });

    return { schemaChanges, dataSteps };
  }

  async execute(transformation: DataTransformation, options: ExecuteOptions = {}) {
    const plan = this.plan(transformation);
    if (options.dryRun) return { executed: false, plan };

    // Apply schema changes
    for (const step of plan.schemaChanges) {
      await this.tx.withTransaction(async (ctx) => {
        await ctx.client.query(step.sql);
      });
    }

    // Apply data steps (optionally batched)
    const batchSize = options.batchSize ?? 1000;
    const startOffset = options.offset ?? 0;
    for (const step of plan.dataSteps) {
      const sql = step.sql
        .replace('{LIMIT}', String(batchSize))
        .replace('{OFFSET}', String(startOffset));
      await this.tx.withTransaction(async (ctx) => {
        await ctx.client.query(sql);
      });
    }

    if (options.validate) {
      await this.runValidation(transformation);
    }

    return { executed: true, plan };
  }

  private assertDependencies(t: DataTransformation) {
    if (!t.source?.table || !t.target?.table) {
      throw new Error('Source and target must be provided');
    }
    // Ensure mapped columns exist in target schema
    for (const m of t.mapping) {
      const exists = t.target.schema.columns.some(c => c.name === m.target);
      if (!exists) {
        throw new Error(`Target column not found: ${m.target}`);
      }
    }
  }

  private async runValidation(t: DataTransformation) {
    for (const rule of t.validation || []) {
      const res = await this.tx.withTransaction(async (ctx) => ctx.client.query(rule.sql));
      const row = res.rows?.[0] ?? {};
      const ok = Object.entries(rule.expected).every(([k, v]) => String(row[k]) === String(v));
      if (!ok && rule.severity !== 'warning') {
        throw new Error(`Validation failed: ${rule.name}`);
      }
    }
  }
}
