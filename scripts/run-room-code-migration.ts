#!/usr/bin/env ts-node

/**
 * Script to run the room code migration
 * This changes game_rooms.id from UUID to VARCHAR(8) to support alphanumeric room codes
 */

import * as dotenv from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
dotenv.config({ path: '../.env.local' });

import { ConfigDrivenMigrationManager } from '../src/lib/database/config-driven-migration';
import { SchemaEvolutionManager } from '../src/lib/database/schema-evolution';
import { TransactionManager } from '../src/lib/database/transaction-manager';
import { ROOM_CODE_MIGRATION } from '../src/lib/database/migrations/room-code-migration';

async function runRoomCodeMigration() {
  let pool: Pool | undefined;
  
  try {
    // Create database connection
    const databaseUrl = process.env.POOL_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('Database URL not found. Set POOL_DATABASE_URL or DATABASE_URL environment variable.');
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    console.log('🔄 Connecting to database...');
    await pool.query('SELECT NOW()'); // Test connection
    console.log('✅ Database connection established');

    // Create migration manager
    const transactionManager = new TransactionManager(pool);
    const evolutionManager = new SchemaEvolutionManager(transactionManager);
    const migrationManager = new ConfigDrivenMigrationManager(evolutionManager);

    console.log('🔄 Running room code migration...');
    console.log(`Migration: ${ROOM_CODE_MIGRATION.description}`);
    
    // Run the migration
    await migrationManager.run(ROOM_CODE_MIGRATION);
    
    console.log('✅ Room code migration completed successfully!');
    
    // Verify the changes
    console.log('🔍 Verifying migration...');
    const result = await pool.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name='game_rooms' AND column_name='id'
    `);
    
    if (result.rows[0]?.data_type === 'character varying') {
      console.log('✅ Verification passed: game_rooms.id is now VARCHAR');
    } else {
      console.log('❌ Verification failed: game_rooms.id type is', result.rows[0]?.data_type);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  runRoomCodeMigration().then(() => {
    console.log('🎉 Migration script completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Migration script failed:', error);
    process.exit(1);
  });
}

export { runRoomCodeMigration };