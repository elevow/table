const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

async function runCompleteRoomCodeMigration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('🔄 Starting complete room code migration with RLS policy handling...');

  try {
    // Step 1: Identify and drop RLS policies that depend on game_rooms.id
    console.log('🔍 Finding RLS policies that depend on game_rooms.id...');
    
    const policiesQuery = `
      SELECT schemaname, tablename, policyname, definition
      FROM pg_policies 
      WHERE definition LIKE '%game_rooms%' OR definition LIKE '%room_id%'
      ORDER BY tablename, policyname;
    `;
    
    // Note: We'll provide the SQL commands since direct policy queries may be restricted
    console.log('📋 Please run these commands in your Supabase SQL editor:');
    console.log('\n-- STEP 1: Drop RLS policies that reference game_rooms.id');
    
    const policiesToDrop = [
      'DROP POLICY IF EXISTS spectators_can_view_public_games ON active_games;',
      'DROP POLICY IF EXISTS players_can_manage_own_games ON active_games;', 
      'DROP POLICY IF EXISTS players_can_view_own_games ON active_games;',
      'DROP POLICY IF EXISTS players_can_send_chat_messages ON chat_messages;',
      'DROP POLICY IF EXISTS players_can_view_chat_messages ON chat_messages;',
      'DROP POLICY IF EXISTS users_can_manage_own_invites ON friend_game_invites;',
      'DROP POLICY IF EXISTS users_can_view_received_invites ON friend_game_invites;',
      'DROP POLICY IF EXISTS players_can_manage_own_rooms ON game_rooms;',
      'DROP POLICY IF EXISTS spectators_can_view_public_rooms ON game_rooms;'
    ];
    
    policiesToDrop.forEach(policy => console.log(policy));
    
    console.log('\n-- STEP 2: Drop foreign key constraints');
    console.log('ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey;');
    console.log('ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey;');
    console.log('ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey;');
    
    console.log('\n-- STEP 3: Clear existing data (already done by previous script)');
    console.log('-- Data was already cleared by the previous migration script');
    
    console.log('\n-- STEP 4: Change column type');
    console.log('ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8);');
    console.log('ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT;');
    
    console.log('\n-- STEP 5: Re-add foreign key constraints');
    console.log('ALTER TABLE active_games ADD CONSTRAINT active_games_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
    console.log('ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
    console.log('ALTER TABLE friend_game_invites ADD CONSTRAINT friend_game_invites_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
    
    console.log('\n-- STEP 6: Recreate RLS policies with updated column references');
    
    const policiesToRecreate = [
      `CREATE POLICY spectators_can_view_public_games ON active_games
       FOR SELECT USING (
         EXISTS (
           SELECT 1 FROM game_rooms 
           WHERE game_rooms.id = active_games.room_id 
           AND game_rooms.privacy_level = 'public'
         )
       );`,
       
      `CREATE POLICY players_can_manage_own_games ON active_games
       FOR ALL USING (
         host_id = auth.uid() OR 
         player_ids @> ARRAY[auth.uid()::text]
       );`,
       
      `CREATE POLICY players_can_view_own_games ON active_games
       FOR SELECT USING (
         host_id = auth.uid() OR 
         player_ids @> ARRAY[auth.uid()::text]
       );`,
       
      `CREATE POLICY players_can_send_chat_messages ON chat_messages
       FOR INSERT WITH CHECK (
         sender_id = auth.uid() AND
         EXISTS (
           SELECT 1 FROM active_games ag
           WHERE ag.room_id = chat_messages.room_id
           AND (ag.host_id = auth.uid() OR ag.player_ids @> ARRAY[auth.uid()::text])
         )
       );`,
       
      `CREATE POLICY players_can_view_chat_messages ON chat_messages
       FOR SELECT USING (
         EXISTS (
           SELECT 1 FROM active_games ag
           WHERE ag.room_id = chat_messages.room_id
           AND (ag.host_id = auth.uid() OR ag.player_ids @> ARRAY[auth.uid()::text])
         )
       );`,
       
      `CREATE POLICY users_can_manage_own_invites ON friend_game_invites
       FOR ALL USING (
         inviter_id = auth.uid() OR invitee_id = auth.uid()
       );`,
       
      `CREATE POLICY users_can_view_received_invites ON friend_game_invites
       FOR SELECT USING (
         invitee_id = auth.uid()
       );`,
       
      `CREATE POLICY players_can_manage_own_rooms ON game_rooms
       FOR ALL USING (
         host_id = auth.uid()
       );`,
       
      `CREATE POLICY spectators_can_view_public_rooms ON game_rooms
       FOR SELECT USING (
         privacy_level = 'public'
       );`
    ];
    
    policiesToRecreate.forEach(policy => {
      console.log('\n' + policy);
    });
    
    console.log('\n-- STEP 7: Re-enable RLS on tables');
    console.log('ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;');
    console.log('ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;');
    console.log('ALTER TABLE friend_game_invites ENABLE ROW LEVEL SECURITY;');
    console.log('ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;');
    
    console.log('\n🎉 Complete migration SQL commands provided!');
    console.log('📝 Copy and paste all the commands above into your Supabase SQL editor');
    console.log('🚀 After running these, room creation should work with alphanumeric codes');
    
  } catch (error) {
    console.error('❌ Error preparing migration:', error);
    throw error;
  }
}

runCompleteRoomCodeMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});