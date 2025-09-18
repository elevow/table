const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.POOL_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection established');

    // Check current state
    console.log('🔍 Checking current state...');
    const currentState = await pool.query(`
      SELECT data_type, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name='game_rooms' AND column_name='id'
    `);
    
    console.log('Current game_rooms.id type:', currentState.rows[0]);

    if (currentState.rows[0]?.data_type === 'character varying') {
      console.log('✅ Migration already applied! game_rooms.id is already VARCHAR');
      return;
    }

    // Check if there are existing rooms
    const roomCount = await pool.query('SELECT COUNT(*) as count FROM game_rooms');
    console.log(`Found ${roomCount.rows[0].count} existing rooms`);

    if (parseInt(roomCount.rows[0].count) > 0) {
      console.log('⚠️  Warning: There are existing rooms. They will be lost during migration.');
      console.log('If you want to proceed, this script will clear existing rooms first.');
      
      // Clear existing rooms for simplicity
      console.log('🧹 Clearing existing rooms...');
      await pool.query('DELETE FROM game_rooms');
      console.log('✅ Existing rooms cleared');
    }

    console.log('🔄 Running migration...');

    // Read and execute the SQL migration
    const sqlContent = fs.readFileSync(path.join(__dirname, 'room-code-migration.sql'), 'utf8');
    await pool.query(sqlContent);

    console.log('✅ Migration completed successfully!');

    // Verify the result
    const newState = await pool.query(`
      SELECT data_type, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name='game_rooms' AND column_name='id'
    `);
    
    console.log('New game_rooms.id type:', newState.rows[0]);

    if (newState.rows[0]?.data_type === 'character varying') {
      console.log('🎉 Verification passed: Migration successful!');
    } else {
      console.log('❌ Verification failed: Migration did not complete properly');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration().catch(console.error);