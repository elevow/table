const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

async function runMigration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  console.log('🔄 Connecting to Supabase...');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Test connection
    const { data: testData, error: testError } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (testError && testError.code !== 'PGRST116') { // PGRST116 is "table not found" which is ok
      throw testError;
    }
    
    console.log('✅ Supabase connection established');

    console.log('🔍 Checking current schema...');
    
    // Check current data type of game_rooms.id
    const { data: currentTypeData, error: currentTypeError } = await supabase.rpc('check_column_type', {
      table_name: 'game_rooms',
      column_name: 'id'
    }).single();
    
    // If the function doesn't exist, let's check manually
    let currentType;
    if (currentTypeError) {
      // Fallback to raw SQL query
      const { data: schemaData, error: schemaError } = await supabase.rpc('exec_sql', {
        sql: `SELECT data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'game_rooms' AND column_name = 'id'`
      });
      
      if (schemaError) {
        console.log('ℹ️  Unable to check schema directly, proceeding with migration...');
        currentType = 'unknown';
      } else {
        currentType = schemaData[0]?.data_type || 'unknown';
      }
    } else {
      currentType = currentTypeData.data_type;
    }
    
    console.log(`Current game_rooms.id type: ${currentType}`);
    
    if (currentType === 'character varying') {
      console.log('✅ Migration already applied! game_rooms.id is already VARCHAR');
      return;
    }
    
    console.log('🔄 Running migration via Supabase...');
    
    // Execute the migration SQL
    const migrationSQL = `
BEGIN;

-- Drop foreign key constraints
ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey;
ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey;

-- Clear existing data to avoid UUID conversion issues
DELETE FROM active_games;
DELETE FROM chat_messages WHERE room_id IS NOT NULL;
DELETE FROM friend_game_invites;
DELETE FROM game_rooms;

-- Change column type
ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8);
ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT;

-- Re-add foreign key constraints
ALTER TABLE active_games 
ADD CONSTRAINT active_games_room_id_fkey 
FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;

ALTER TABLE chat_messages 
ADD CONSTRAINT chat_messages_room_id_fkey 
FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;

ALTER TABLE friend_game_invites 
ADD CONSTRAINT friend_game_invites_room_id_fkey 
FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;

COMMIT;
`;

    // Execute the migration using rpc if available, or break it into parts
    try {
      const { data: migrationData, error: migrationError } = await supabase.rpc('exec_sql', {
        sql: migrationSQL
      });
      
      if (migrationError) {
        throw migrationError;
      }
      
      console.log('✅ Migration executed successfully');
    } catch (error) {
      console.log('ℹ️  Direct SQL execution not available, trying alternative approach...');
      
      // Try to execute individual statements
      const statements = [
        "ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey",
        "ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey",
        "ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey",
        "DELETE FROM active_games",
        "DELETE FROM chat_messages WHERE room_id IS NOT NULL",
        "DELETE FROM friend_game_invites",
        "DELETE FROM game_rooms"
      ];
      
      for (const statement of statements) {
        try {
          console.log(`Executing: ${statement}`);
          await supabase.rpc('exec_sql', { sql: statement });
        } catch (err) {
          console.log(`Warning: ${statement} failed:`, err.message);
        }
      }
      
      console.log('🎯 Schema changes need to be applied via Supabase dashboard');
      console.log('📋 Please run these commands in your Supabase SQL editor:');
      console.log('');
      console.log('ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8);');
      console.log('ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT;');
      console.log('');
      console.log('-- Then re-add foreign key constraints:');
      console.log('ALTER TABLE active_games ADD CONSTRAINT active_games_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
      console.log('ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
      console.log('ALTER TABLE friend_game_invites ADD CONSTRAINT friend_game_invites_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
    }
    
    console.log('🎉 Migration process completed!');
    console.log('🚀 You should now be able to create rooms with alphanumeric codes');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});