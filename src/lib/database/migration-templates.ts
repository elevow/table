// US-013: Migration Templates for Schema Evolution
// Provides templates and utilities for creating safe schema migrations

import { ZeroDowntimeMigration, EvolutionStage, BackwardCompatibilitySetup } from './schema-evolution';

/**
 * Migration template factory for common schema evolution patterns
 */
export class MigrationTemplateFactory {
  
  /**
   * Create a template for adding a new column with backward compatibility
   */
  static createAddColumnMigration(config: AddColumnConfig): ZeroDowntimeMigration {
    return {
      version: config.version,
      description: `Add column ${config.columnName} to ${config.tableName}`,
      stages: [
        {
          name: 'add_column',
          description: `Add ${config.columnName} column`,
          steps: [
            {
              sql: `ALTER TABLE ${config.tableName} ADD COLUMN IF NOT EXISTS ${config.columnName} ${config.dataType}${config.nullable ? '' : ' NOT NULL'}${config.defaultValue ? ` DEFAULT ${config.defaultValue}` : ''}`,
              condition: `
                SELECT 1 WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.columns 
                  WHERE table_name = '${config.tableName}' 
                  AND column_name = '${config.columnName}'
                )
              `
            }
          ],
          canRollback: true
        }
      ],
      backwardCompatibility: config.maintainCompatibility ? {
        deprecationWarnings: [`Column ${config.columnName} added to ${config.tableName}`]
      } : undefined,
      rollback: {
        steps: [
          {
            sql: `ALTER TABLE ${config.tableName} DROP COLUMN IF EXISTS ${config.columnName}`,
            condition: `
              SELECT 1 WHERE EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = '${config.tableName}' 
                AND column_name = '${config.columnName}'
              )
            `
          }
        ],
        safetyChecks: [
          `SELECT COUNT(*) as count FROM ${config.tableName} WHERE ${config.columnName} IS NOT NULL`
        ]
      },
      validation: {
        validators: [
          {
            name: 'column_exists',
            sql: `
              SELECT COUNT(*) as count FROM information_schema.columns 
              WHERE table_name = '${config.tableName}' 
              AND column_name = '${config.columnName}'
            `,
            expectedResult: { count: 1 },
            errorMessage: `Column ${config.columnName} was not created in ${config.tableName}`
          }
        ],
        dataIntegrityChecks: [
          `SELECT COUNT(*) as total_rows FROM ${config.tableName}`
        ]
      }
    };
  }

  /**
   * Create a template for adding an index with online creation
   */
  static createAddIndexMigration(config: AddIndexConfig): ZeroDowntimeMigration {
    const indexName = config.indexName || `idx_${config.tableName}_${config.columns.join('_')}`;
    
    return {
      version: config.version,
      description: `Add index ${indexName} on ${config.tableName}(${config.columns.join(', ')})`,
      stages: [
        {
          name: 'create_index',
          description: 'Create index concurrently',
          steps: [
            {
              sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${config.tableName} (${config.columns.join(', ')})${config.where ? ` WHERE ${config.where}` : ''}`,
              retryPolicy: {
                maxAttempts: 3,
                delayMs: 5000
              }
            }
          ],
          canRollback: true
        }
      ],
      rollback: {
        steps: [
          {
            sql: `DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`
          }
        ],
        safetyChecks: []
      },
      validation: {
        validators: [
          {
            name: 'index_exists',
            sql: `
              SELECT COUNT(*) as count FROM pg_indexes 
              WHERE tablename = '${config.tableName}' 
              AND indexname = '${indexName}'
            `,
            expectedResult: { count: 1 },
            errorMessage: `Index ${indexName} was not created`
          }
        ],
        dataIntegrityChecks: []
      }
    };
  }

  /**
   * Create a template for renaming a column with backward compatibility
   */
  static createRenameColumnMigration(config: RenameColumnConfig): ZeroDowntimeMigration {
    return {
      version: config.version,
      description: `Rename column ${config.oldColumnName} to ${config.newColumnName} in ${config.tableName}`,
      stages: [
        {
          name: 'add_new_column',
          description: 'Add new column with same type',
          steps: [
            {
              sql: `
                ALTER TABLE ${config.tableName} 
                ADD COLUMN IF NOT EXISTS ${config.newColumnName} 
                (SELECT data_type FROM information_schema.columns 
                 WHERE table_name = '${config.tableName}' 
                 AND column_name = '${config.oldColumnName}')
              `
            }
          ],
          canRollback: true
        },
        {
          name: 'copy_data',
          description: 'Copy data from old to new column',
          steps: [
            {
              sql: `UPDATE ${config.tableName} SET ${config.newColumnName} = ${config.oldColumnName} WHERE ${config.newColumnName} IS NULL`
            }
          ],
          canRollback: false
        },
        {
          name: 'create_compatibility_view',
          description: 'Create view for backward compatibility',
          steps: [
            {
              sql: `
                CREATE OR REPLACE VIEW ${config.tableName}_compat AS 
                SELECT *, ${config.newColumnName} as ${config.oldColumnName} 
                FROM ${config.tableName}
              `
            }
          ],
          canRollback: true
        }
      ],
      backwardCompatibility: {
        compatibilityViews: [
          {
            name: `${config.tableName}_compat`,
            sql: `
              CREATE OR REPLACE VIEW ${config.tableName}_compat AS 
              SELECT *, ${config.newColumnName} as ${config.oldColumnName} 
              FROM ${config.tableName}
            `
          }
        ],
        deprecationWarnings: [
          `Column ${config.oldColumnName} in ${config.tableName} has been renamed to ${config.newColumnName}. Please update your queries.`
        ]
      },
      cleanupDelay: config.cleanupDelayHours || 72, // 3 days default
      validation: {
        validators: [
          {
            name: 'new_column_exists',
            sql: `
              SELECT COUNT(*) as count FROM information_schema.columns 
              WHERE table_name = '${config.tableName}' 
              AND column_name = '${config.newColumnName}'
            `,
            expectedResult: { count: 1 },
            errorMessage: `New column ${config.newColumnName} was not created`
          },
          {
            name: 'data_copied',
            sql: `
              SELECT COUNT(*) as count FROM ${config.tableName} 
              WHERE ${config.oldColumnName} != ${config.newColumnName} 
              OR (${config.oldColumnName} IS NULL AND ${config.newColumnName} IS NOT NULL)
              OR (${config.oldColumnName} IS NOT NULL AND ${config.newColumnName} IS NULL)
            `,
            expectedResult: { count: 0 },
            errorMessage: 'Data was not copied correctly between columns'
          }
        ],
        dataIntegrityChecks: [
          `SELECT COUNT(*) as total_rows FROM ${config.tableName}`
        ]
      }
    };
  }

  /**
   * Create a template for table partitioning migration
   */
  static createPartitioningMigration(config: PartitioningConfig): ZeroDowntimeMigration {
    return {
      version: config.version,
      description: `Partition table ${config.tableName} by ${config.partitionType}`,
      stages: [
        {
          name: 'create_partitioned_table',
          description: 'Create new partitioned table structure',
          steps: [
            {
              sql: `
                CREATE TABLE ${config.tableName}_partitioned (
                  LIKE ${config.tableName} INCLUDING ALL
                ) PARTITION BY ${config.partitionType.toUpperCase()} (${config.partitionColumn})
              `
            }
          ],
          canRollback: true
        },
        {
          name: 'create_partitions',
          description: 'Create initial partitions',
          steps: config.partitions.map(partition => ({
            sql: `
              CREATE TABLE ${partition.name} 
              PARTITION OF ${config.tableName}_partitioned 
              FOR VALUES ${partition.condition}
            `
          })),
          canRollback: true
        },
        {
          name: 'migrate_data',
          description: 'Migrate data to partitioned table',
          steps: [
            {
              sql: `INSERT INTO ${config.tableName}_partitioned SELECT * FROM ${config.tableName}`
            }
          ],
          canRollback: false
        },
        {
          name: 'swap_tables',
          description: 'Atomically swap tables',
          steps: [
            {
              sql: `ALTER TABLE ${config.tableName} RENAME TO ${config.tableName}_old`
            },
            {
              sql: `ALTER TABLE ${config.tableName}_partitioned RENAME TO ${config.tableName}`
            }
          ],
          canRollback: true
        }
      ],
      dataMigration: {
        operations: [
          {
            sql: `
              INSERT INTO ${config.tableName}_partitioned 
              SELECT * FROM ${config.tableName}_old 
              LIMIT {LIMIT} OFFSET {OFFSET}
            `,
            description: 'Batch copy data to partitioned table'
          }
        ],
        batchSize: config.batchSize || 10000
      },
      validation: {
        validators: [
          {
            name: 'row_count_match',
            sql: `
              SELECT 
                (SELECT COUNT(*) FROM ${config.tableName}_old) as old_count,
                (SELECT COUNT(*) FROM ${config.tableName}) as new_count
            `,
            expectedResult: { old_count: 'new_count' },
            errorMessage: 'Row counts do not match after partitioning'
          }
        ],
        dataIntegrityChecks: [
          `SELECT COUNT(*) as total_rows FROM ${config.tableName}`,
          `SELECT COUNT(DISTINCT ${config.partitionColumn}) as partition_values FROM ${config.tableName}`
        ]
      }
    };
  }

  /**
   * Create a template for adding foreign key constraint
   */
  static createAddForeignKeyMigration(config: AddForeignKeyConfig): ZeroDowntimeMigration {
    const constraintName = config.constraintName || `fk_${config.sourceTable}_${config.sourceColumn}`;
    
    return {
      version: config.version,
      description: `Add foreign key constraint ${constraintName}`,
      stages: [
        {
          name: 'validate_existing_data',
          description: 'Validate existing data meets constraint',
          steps: [
            {
              sql: `
                DO $$
                BEGIN
                  IF EXISTS (
                    SELECT 1 FROM ${config.sourceTable} s
                    LEFT JOIN ${config.targetTable} t ON s.${config.sourceColumn} = t.${config.targetColumn}
                    WHERE s.${config.sourceColumn} IS NOT NULL AND t.${config.targetColumn} IS NULL
                  ) THEN
                    RAISE EXCEPTION 'Existing data violates foreign key constraint';
                  END IF;
                END $$
              `
            }
          ],
          canRollback: false
        },
        {
          name: 'add_constraint',
          description: 'Add foreign key constraint',
          steps: [
            {
              sql: `
                ALTER TABLE ${config.sourceTable} 
                ADD CONSTRAINT ${constraintName} 
                FOREIGN KEY (${config.sourceColumn}) 
                REFERENCES ${config.targetTable}(${config.targetColumn})
                ${config.onDelete ? `ON DELETE ${config.onDelete}` : ''}
                ${config.onUpdate ? `ON UPDATE ${config.onUpdate}` : ''}
                ${config.deferrable ? 'DEFERRABLE' : ''}
              `
            }
          ],
          canRollback: true
        }
      ],
      rollback: {
        steps: [
          {
            sql: `ALTER TABLE ${config.sourceTable} DROP CONSTRAINT IF EXISTS ${constraintName}`
          }
        ],
        safetyChecks: []
      },
      validation: {
        validators: [
          {
            name: 'constraint_exists',
            sql: `
              SELECT COUNT(*) as count FROM information_schema.table_constraints 
              WHERE table_name = '${config.sourceTable}' 
              AND constraint_name = '${constraintName}'
              AND constraint_type = 'FOREIGN KEY'
            `,
            expectedResult: { count: 1 },
            errorMessage: `Foreign key constraint ${constraintName} was not created`
          },
          {
            name: 'no_orphaned_records',
            sql: `
              SELECT COUNT(*) as count FROM ${config.sourceTable} s
              LEFT JOIN ${config.targetTable} t ON s.${config.sourceColumn} = t.${config.targetColumn}
              WHERE s.${config.sourceColumn} IS NOT NULL AND t.${config.targetColumn} IS NULL
            `,
            expectedResult: { count: 0 },
            errorMessage: 'Orphaned records found after foreign key creation'
          }
        ],
        dataIntegrityChecks: []
      }
    };
  }
}

// Configuration interfaces for migration templates
export interface AddColumnConfig {
  version: string;
  tableName: string;
  columnName: string;
  dataType: string;
  nullable?: boolean;
  defaultValue?: string;
  maintainCompatibility?: boolean;
}

export interface AddIndexConfig {
  version: string;
  tableName: string;
  columns: string[];
  indexName?: string;
  unique?: boolean;
  where?: string;
}

export interface RenameColumnConfig {
  version: string;
  tableName: string;
  oldColumnName: string;
  newColumnName: string;
  cleanupDelayHours?: number;
}

export interface PartitioningConfig {
  version: string;
  tableName: string;
  partitionType: 'range' | 'list' | 'hash';
  partitionColumn: string;
  partitions: PartitionDefinition[];
  batchSize?: number;
}

export interface PartitionDefinition {
  name: string;
  condition: string;
}

export interface AddForeignKeyConfig {
  version: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  constraintName?: string;
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  deferrable?: boolean;
}

/**
 * Migration version utilities
 */
export class MigrationVersioning {
  /**
   * Generate a timestamp-based version
   */
  static generateVersion(date?: Date): string {
    const d = date || new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    
    return `${year}.${month}.${day}.${hour}${minute}`;
  }

  /**
   * Parse version into components
   */
  static parseVersion(version: string): VersionComponents {
    const parts = version.split('.');
    if (parts.length < 4) {
      throw new Error(`Invalid version format: ${version}`);
    }

    return {
      year: parseInt(parts[0]),
      month: parseInt(parts[1]),
      day: parseInt(parts[2]),
      sequence: parseInt(parts[3])
    };
  }

  /**
   * Compare two versions
   */
  static compareVersions(version1: string, version2: string): number {
    const v1 = this.parseVersion(version1);
    const v2 = this.parseVersion(version2);

    if (v1.year !== v2.year) return v1.year - v2.year;
    if (v1.month !== v2.month) return v1.month - v2.month;
    if (v1.day !== v2.day) return v1.day - v2.day;
    return v1.sequence - v2.sequence;
  }

  /**
   * Check if version is valid
   */
  static isValidVersion(version: string): boolean {
    try {
      this.parseVersion(version);
      return true;
    } catch {
      return false;
    }
  }
}

export interface VersionComponents {
  year: number;
  month: number;
  day: number;
  sequence: number;
}
