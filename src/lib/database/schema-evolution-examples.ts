// US-013: Schema Evolution Examples
// Demonstrates how to use the schema evolution system for the poker application

import { SchemaEvolutionManager, ZeroDowntimeMigration } from './schema-evolution';
import { MigrationTemplateFactory, MigrationVersioning } from './migration-templates';
import { TransactionManager } from './transaction-manager';

/**
 * Example migrations for the poker application demonstrating US-013 features
 */
export class PokerSchemaEvolution {
  private evolutionManager: SchemaEvolutionManager;
  
  constructor(transactionManager: TransactionManager) {
    this.evolutionManager = new SchemaEvolutionManager(transactionManager);
  }

  /**
   * Initialize the schema evolution system
   */
  async initialize(): Promise<void> {
    await this.evolutionManager.initialize();
  }

  /**
   * Example: Add feature flags to players table
   */
  async addPlayerFeatureFlags(): Promise<void> {
    const version = MigrationVersioning.generateVersion();
    
    const migration = MigrationTemplateFactory.createAddColumnMigration({
      version,
      tableName: 'players',
      columnName: 'feature_flags',
      dataType: 'JSONB',
      nullable: true,
      defaultValue: "'{}'::jsonb",
      maintainCompatibility: true
    });

    // Validate the migration plan
    const validation = await this.evolutionManager.validateEvolutionPlan(migration);
    if (!validation.isValid) {
      throw new Error(`Migration validation failed: ${validation.issues.map(i => i.message).join(', ')}`);
    }

    // Execute the migration
    const result = await this.evolutionManager.executeZeroDowntimeMigration(migration);
    console.log(`Migration ${version} completed in ${result.executionTime}ms`);
  }

  /**
   * Example: Add performance indexes for game queries
   */
  async addGamePerformanceIndexes(): Promise<void> {
    const version = MigrationVersioning.generateVersion();
    
    // Create index on game_history for efficient querying
    const indexMigration = MigrationTemplateFactory.createAddIndexMigration({
      version,
      tableName: 'game_history',
      columns: ['table_id', 'started_at'],
      indexName: 'idx_game_history_table_time'
    });

    await this.evolutionManager.executeZeroDowntimeMigration(indexMigration);
  }

  /**
   * Example: Partition game_history table by date for better performance
   */
  async partitionGameHistoryTable(): Promise<void> {
    const version = MigrationVersioning.generateVersion();
    
    const partitionMigration = MigrationTemplateFactory.createPartitioningMigration({
      version,
      tableName: 'game_history',
      partitionType: 'range',
      partitionColumn: 'started_at',
      partitions: [
        {
          name: 'game_history_2024',
          condition: "FROM ('2024-01-01') TO ('2025-01-01')"
        },
        {
          name: 'game_history_2025',
          condition: "FROM ('2025-01-01') TO ('2026-01-01')"
        },
        {
          name: 'game_history_default',
          condition: 'DEFAULT'
        }
      ],
      batchSize: 5000
    });

    await this.evolutionManager.executeZeroDowntimeMigration(partitionMigration);
  }

  /**
   * Example: Complex migration - Add player statistics table with relationships
   */
  async addPlayerStatisticsTable(): Promise<void> {
    const version = MigrationVersioning.generateVersion();
    
    const migration: ZeroDowntimeMigration = {
      version,
      description: 'Add comprehensive player statistics tracking',
      stages: [
        {
          name: 'create_statistics_table',
          description: 'Create player_statistics table',
          steps: [
            {
              sql: `
                CREATE TABLE IF NOT EXISTS player_statistics (
                  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                  player_id UUID NOT NULL,
                  hands_played INTEGER DEFAULT 0,
                  hands_won INTEGER DEFAULT 0,
                  total_winnings DECIMAL(15,2) DEFAULT 0,
                  total_losses DECIMAL(15,2) DEFAULT 0,
                  biggest_win DECIMAL(15,2) DEFAULT 0,
                  biggest_loss DECIMAL(15,2) DEFAULT 0,
                  average_pot_size DECIMAL(15,2) DEFAULT 0,
                  vpip_percentage DECIMAL(5,2) DEFAULT 0, -- Voluntarily Put In Pot
                  pfr_percentage DECIMAL(5,2) DEFAULT 0,  -- Pre-Flop Raise
                  aggression_factor DECIMAL(5,2) DEFAULT 0,
                  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
              `
            },
            {
              sql: `CREATE INDEX IF NOT EXISTS idx_player_statistics_player_id ON player_statistics(player_id)`
            },
            {
              sql: `CREATE INDEX IF NOT EXISTS idx_player_statistics_updated ON player_statistics(last_updated)`
            }
          ],
          canRollback: true
        },
        {
          name: 'add_foreign_key',
          description: 'Add foreign key to players table',
          steps: [
            {
              sql: `
                ALTER TABLE player_statistics 
                ADD CONSTRAINT fk_player_statistics_player_id 
                FOREIGN KEY (player_id) REFERENCES players(id) 
                ON DELETE CASCADE
              `,
              condition: `
                SELECT 1 WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.table_constraints 
                  WHERE table_name = 'player_statistics' 
                  AND constraint_name = 'fk_player_statistics_player_id'
                )
              `
            }
          ],
          canRollback: true
        },
        {
          name: 'populate_initial_data',
          description: 'Populate statistics for existing players',
          steps: [
            {
              sql: `
                INSERT INTO player_statistics (player_id, hands_played, last_updated)
                SELECT id, 0, NOW() FROM players
                ON CONFLICT DO NOTHING
              `
            }
          ],
          canRollback: false
        }
      ],
      backwardCompatibility: {
        compatibilityViews: [
          {
            name: 'players_with_stats',
            sql: `
              CREATE OR REPLACE VIEW players_with_stats AS
              SELECT 
                p.*,
                COALESCE(ps.hands_played, 0) as hands_played,
                COALESCE(ps.hands_won, 0) as hands_won,
                COALESCE(ps.total_winnings, 0) as total_winnings
              FROM players p
              LEFT JOIN player_statistics ps ON p.id = ps.player_id
            `
          }
        ]
      },
      rollback: {
        steps: [
          {
            sql: 'DROP TABLE IF EXISTS player_statistics CASCADE'
          }
        ],
        safetyChecks: [
          'SELECT COUNT(*) FROM player_statistics'
        ]
      },
      validation: {
        validators: [
          {
            name: 'statistics_table_exists',
            sql: `
              SELECT COUNT(*) as count FROM information_schema.tables 
              WHERE table_name = 'player_statistics'
            `,
            expectedResult: { count: 1 },
            errorMessage: 'player_statistics table was not created'
          },
          {
            name: 'all_players_have_statistics',
            sql: `
              SELECT COUNT(*) as missing_stats 
              FROM players p 
              LEFT JOIN player_statistics ps ON p.id = ps.player_id 
              WHERE ps.player_id IS NULL
            `,
            expectedResult: { missing_stats: 0 },
            errorMessage: 'Some players are missing statistics records'
          }
        ],
        dataIntegrityChecks: [
          'SELECT COUNT(*) FROM players',
          'SELECT COUNT(*) FROM player_statistics'
        ]
      }
    };

    const result = await this.evolutionManager.executeZeroDowntimeMigration(migration);
    console.log(`Statistics table migration completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  }

  /**
   * Example: Safe column rename with backward compatibility
   */
  async renamePlayerBankrollColumn(): Promise<void> {
    const version = MigrationVersioning.generateVersion();
    
    const migration = MigrationTemplateFactory.createRenameColumnMigration({
      version,
      tableName: 'players',
      oldColumnName: 'bankroll',
      newColumnName: 'balance',
      cleanupDelayHours: 168 // 1 week
    });

    await this.evolutionManager.executeZeroDowntimeMigration(migration);
  }

  /**
   * Example: Add comprehensive audit trail
   */
  async addAuditTrail(): Promise<void> {
    const version = MigrationVersioning.generateVersion();
    
    const migration: ZeroDowntimeMigration = {
      version,
      description: 'Add comprehensive audit trail for data protection compliance',
      stages: [
        {
          name: 'create_audit_tables',
          description: 'Create audit trail tables',
          steps: [
            {
              sql: `
                CREATE TABLE IF NOT EXISTS audit_log (
                  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                  table_name VARCHAR(255) NOT NULL,
                  operation VARCHAR(10) NOT NULL, -- INSERT, UPDATE, DELETE
                  record_id UUID,
                  old_values JSONB,
                  new_values JSONB,
                  changed_by UUID,
                  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                  ip_address INET,
                  user_agent TEXT
                )
              `
            },
            {
              sql: `CREATE INDEX IF NOT EXISTS idx_audit_log_table_operation ON audit_log(table_name, operation)`
            },
            {
              sql: `CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log(changed_at)`
            },
            {
              sql: `CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON audit_log(record_id)`
            }
          ],
          canRollback: true
        },
        {
          name: 'create_audit_functions',
          description: 'Create audit trigger functions',
          steps: [
            {
              sql: `
                CREATE OR REPLACE FUNCTION audit_trigger_function()
                RETURNS TRIGGER AS $$
                BEGIN
                  IF TG_OP = 'DELETE' THEN
                    INSERT INTO audit_log (table_name, operation, record_id, old_values)
                    VALUES (TG_TABLE_NAME, TG_OP, OLD.id, row_to_json(OLD));
                    RETURN OLD;
                  ELSIF TG_OP = 'UPDATE' THEN
                    INSERT INTO audit_log (table_name, operation, record_id, old_values, new_values)
                    VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(OLD), row_to_json(NEW));
                    RETURN NEW;
                  ELSIF TG_OP = 'INSERT' THEN
                    INSERT INTO audit_log (table_name, operation, record_id, new_values)
                    VALUES (TG_TABLE_NAME, TG_OP, NEW.id, row_to_json(NEW));
                    RETURN NEW;
                  END IF;
                  RETURN NULL;
                END;
                $$ LANGUAGE plpgsql
              `
            }
          ],
          canRollback: true
        },
        {
          name: 'add_audit_triggers',
          description: 'Add audit triggers to key tables',
          steps: [
            {
              sql: `
                CREATE TRIGGER players_audit_trigger
                AFTER INSERT OR UPDATE OR DELETE ON players
                FOR EACH ROW EXECUTE FUNCTION audit_trigger_function()
              `,
              condition: `
                SELECT 1 WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.triggers 
                  WHERE trigger_name = 'players_audit_trigger'
                )
              `
            },
            {
              sql: `
                CREATE TRIGGER game_history_audit_trigger
                AFTER INSERT OR UPDATE OR DELETE ON game_history
                FOR EACH ROW EXECUTE FUNCTION audit_trigger_function()
              `,
              condition: `
                SELECT 1 WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.triggers 
                  WHERE trigger_name = 'game_history_audit_trigger'
                )
              `
            }
          ],
          canRollback: true
        }
      ],
      rollback: {
        steps: [
          {
            sql: 'DROP TRIGGER IF EXISTS players_audit_trigger ON players'
          },
          {
            sql: 'DROP TRIGGER IF EXISTS game_history_audit_trigger ON game_history'
          },
          {
            sql: 'DROP FUNCTION IF EXISTS audit_trigger_function()'
          },
          {
            sql: 'DROP TABLE IF EXISTS audit_log'
          }
        ],
        safetyChecks: []
      },
      validation: {
        validators: [
          {
            name: 'audit_table_exists',
            sql: `
              SELECT COUNT(*) as count FROM information_schema.tables 
              WHERE table_name = 'audit_log'
            `,
            expectedResult: { count: 1 },
            errorMessage: 'Audit log table was not created'
          },
          {
            name: 'audit_triggers_exist',
            sql: `
              SELECT COUNT(*) as count FROM information_schema.triggers 
              WHERE trigger_name LIKE '%_audit_trigger'
            `,
            expectedResult: { count: 2 },
            errorMessage: 'Audit triggers were not created'
          }
        ],
        dataIntegrityChecks: []
      }
    };

    await this.evolutionManager.executeZeroDowntimeMigration(migration);
  }

  /**
   * Get current schema version
   */
  async getCurrentSchemaVersion(): Promise<string | null> {
    return await this.evolutionManager.getCurrentVersion();
  }

  /**
   * Get migration history
   */
  async getMigrationHistory() {
    return await this.evolutionManager.getMigrationHistory();
  }

  /**
   * Rollback to a specific version
   */
  async rollbackToVersion(version: string) {
    return await this.evolutionManager.rollbackToVersion(version);
  }

  /**
   * Example usage demonstrating the full migration lifecycle
   */
  async demonstrateFullMigrationLifecycle(): Promise<void> {
    console.log('=== Schema Evolution Demonstration ===');
    
    // 1. Initialize
    await this.initialize();
    console.log('✓ Schema evolution system initialized');

    // 2. Check current version
    const currentVersion = await this.getCurrentSchemaVersion();
    console.log(`Current schema version: ${currentVersion || 'None'}`);

    // 3. Plan a migration
    const version = MigrationVersioning.generateVersion();
    const migration = MigrationTemplateFactory.createAddColumnMigration({
      version,
      tableName: 'players',
      columnName: 'demo_feature',
      dataType: 'BOOLEAN',
      nullable: true,
      defaultValue: 'false',
      maintainCompatibility: true
    });

    // 4. Validate migration plan
    const validation = await this.evolutionManager.validateEvolutionPlan(migration);
    console.log(`Migration validation: ${validation.isValid ? 'PASSED' : 'FAILED'}`);
    
    if (validation.warnings.length > 0) {
      console.log('Warnings:', validation.warnings);
    }

    // 5. Execute migration if valid
    if (validation.isValid) {
      const result = await this.evolutionManager.executeZeroDowntimeMigration(migration);
      console.log(`Migration ${version}: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.executionTime}ms)`);
      
      // 6. Verify new version
      const newVersion = await this.getCurrentSchemaVersion();
      console.log(`New schema version: ${newVersion}`);
      
      // 7. Show migration history
      const history = await this.getMigrationHistory();
      console.log(`Total migrations applied: ${history.length}`);
    }
  }
}

/**
 * Schema evolution CLI utilities for developers
 */
export class SchemaEvolutionCLI {
  private poker: PokerSchemaEvolution;
  
  constructor(poker: PokerSchemaEvolution) {
    this.poker = poker;
  }

  /**
   * Generate a new migration template
   */
  generateMigrationTemplate(type: string, options: any): string {
    const version = MigrationVersioning.generateVersion();
    
    switch (type) {
      case 'add-column':
        return this.generateAddColumnTemplate(version, options);
      case 'add-index':
        return this.generateAddIndexTemplate(version, options);
      case 'rename-column':
        return this.generateRenameColumnTemplate(version, options);
      default:
        throw new Error(`Unknown migration type: ${type}`);
    }
  }

  private generateAddColumnTemplate(version: string, options: any): string {
    return `
// Migration: ${version} - Add ${options.column} to ${options.table}
import { MigrationTemplateFactory } from './migration-templates';

export const migration_${version.replace(/\./g, '_')} = MigrationTemplateFactory.createAddColumnMigration({
  version: '${version}',
  tableName: '${options.table}',
  columnName: '${options.column}',
  dataType: '${options.type}',
  nullable: ${options.nullable || false},
  defaultValue: ${options.default ? `'${options.default}'` : 'undefined'},
  maintainCompatibility: true
});
`;
  }

  private generateAddIndexTemplate(version: string, options: any): string {
    return `
// Migration: ${version} - Add index on ${options.table}(${options.columns.join(', ')})
import { MigrationTemplateFactory } from './migration-templates';

export const migration_${version.replace(/\./g, '_')} = MigrationTemplateFactory.createAddIndexMigration({
  version: '${version}',
  tableName: '${options.table}',
  columns: [${options.columns.map((c: string) => `'${c}'`).join(', ')}],
  indexName: '${options.name || `idx_${options.table}_${options.columns.join('_')}`}'
});
`;
  }

  private generateRenameColumnTemplate(version: string, options: any): string {
    return `
// Migration: ${version} - Rename ${options.oldColumn} to ${options.newColumn} in ${options.table}
import { MigrationTemplateFactory } from './migration-templates';

export const migration_${version.replace(/\./g, '_')} = MigrationTemplateFactory.createRenameColumnMigration({
  version: '${version}',
  tableName: '${options.table}',
  oldColumnName: '${options.oldColumn}',
  newColumnName: '${options.newColumn}',
  cleanupDelayHours: ${options.cleanupDelay || 72}
});
`;
  }
}
