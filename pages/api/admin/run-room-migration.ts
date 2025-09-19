import { NextApiRequest, NextApiResponse } from 'next';
import { ConfigDrivenMigrationManager } from '../../../src/lib/database/config-driven-migration';
import { SchemaEvolutionManager } from '../../../src/lib/database/schema-evolution';
import { TransactionManager } from '../../../src/lib/database/transaction-manager';
import { getDbPool } from '../../../src/lib/database/database-connection';
import { ROOM_CODE_MIGRATION } from '../../../src/lib/database/migrations/room-code-migration';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Starting room code migration...');
    
    // Get database connection
    const pool = getDbPool();
    
    // Test connection
    await pool.query('SELECT NOW()');
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
      WHERE table_schema = 'public' 
        AND table_name = 'game_rooms' 
        AND column_name = 'id'
    `);
    
    const dataType = result.rows[0]?.data_type;
    console.log(`✅ Verification: game_rooms.id is now ${dataType}`);
    
    if (dataType !== 'character varying') {
      throw new Error(`Migration verification failed: expected 'character varying', got '${dataType}'`);
    }

    res.status(200).json({ 
      success: true, 
      message: 'Room code migration completed successfully',
      newDataType: dataType 
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
}