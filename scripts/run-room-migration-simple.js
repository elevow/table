const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function runMigration() {
  const connectionString = process.env.POOL_DATABASE_URL || process.env.DATABASE_URL;
  console.log('Using connection string:', connectionString ? 'Found' : 'Not found');
  
  const pool = new Pool({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false,
      ca: false,
      checkServerIdentity: () => undefined
    }
  });

  try {
    console.log('🔄 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection established');

    console.log('🔍 Checking current schema...');
    
    // Check current data type of game_rooms.id
    const currentTypeResult = await pool.query(`
      SELECT data_type, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'game_rooms' 
        AND column_name = 'id'
    `);
    
    if (currentTypeResult.rows.length === 0) {
      throw new Error('game_rooms table or id column not found');
    }
    
    const currentType = currentTypeResult.rows[0].data_type;
    const currentDefault = currentTypeResult.rows[0].column_default;
    
    console.log(`Current game_rooms.id type: ${currentType}`);
    console.log(`Current default: ${currentDefault}`);
    
    if (currentType === 'character varying') {
      console.log('✅ Migration already applied! game_rooms.id is already VARCHAR');
      return;
    }
    
    console.log('🔄 Starting migration...');
    
    // Begin transaction
    await pool.query('BEGIN');
    
    try {
      // Step 1: Drop foreign key constraints
      console.log('🔄 Dropping foreign key constraints...');
      
      await pool.query('ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey');
      await pool.query('ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey');  
      await pool.query('ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey');
      
      // Step 2: Check for existing data
      const existingDataResult = await pool.query('SELECT COUNT(*) as count FROM game_rooms');
      const existingCount = parseInt(existingDataResult.rows[0].count);
      
      if (existingCount > 0) {
        console.log(`⚠️  Found ${existingCount} existing rows in game_rooms`);
        console.log('🗑️  Clearing existing data to avoid UUID conversion issues...');
        
        // Clear related tables first
        await pool.query('DELETE FROM active_games');
        await pool.query('DELETE FROM chat_messages WHERE room_id IS NOT NULL');
        await pool.query('DELETE FROM friend_game_invites');
        await pool.query('DELETE FROM game_rooms');
        
        console.log('✅ Existing data cleared');
      }
      
      // Step 3: Change column type
      console.log('🔄 Changing column type from UUID to VARCHAR(8)...');
      await pool.query('ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8)');
      
      // Step 4: Remove UUID default
      console.log('🔄 Removing UUID default...');
      await pool.query('ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT');
      
      // Step 5: Re-add foreign key constraints
      console.log('🔄 Re-adding foreign key constraints...');
      await pool.query(`
        ALTER TABLE active_games 
        ADD CONSTRAINT active_games_room_id_fkey 
        FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE
      `);
      
      await pool.query(`
        ALTER TABLE chat_messages 
        ADD CONSTRAINT chat_messages_room_id_fkey 
        FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE
      `);
      
      await pool.query(`
        ALTER TABLE friend_game_invites 
        ADD CONSTRAINT friend_game_invites_room_id_fkey 
        FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE
      `);
      
      // Commit transaction
      await pool.query('COMMIT');
      console.log('✅ Transaction committed successfully');
      
    } catch (error) {
      // Rollback on error
      await pool.query('ROLLBACK');
      console.error('❌ Transaction rolled back due to error');
      throw error;
    }
    
    // Verify the migration
    console.log('🔍 Verifying migration...');
    const verifyResult = await pool.query(`
      SELECT data_type, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'game_rooms' 
        AND column_name = 'id'
    `);
    
    const newType = verifyResult.rows[0].data_type;
    const newDefault = verifyResult.rows[0].column_default;
    
    console.log(`✅ New game_rooms.id type: ${newType}`);
    console.log(`✅ New default: ${newDefault || 'None'}`);
    
    if (newType !== 'character varying') {
      throw new Error(`Verification failed: expected 'character varying', got '${newType}'`);
    }
    
    console.log('🎉 Room code migration completed successfully!');
    console.log('🚀 You can now create rooms with alphanumeric codes like "WGDcNU4t"');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});