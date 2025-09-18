const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

async function runCompleteRoomCodeMigrationWithViews() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  console.log('🔄 Starting complete room code migration with RLS policies AND views...');

  console.log('📋 Please run these commands in your Supabase SQL editor:');
  console.log('\n-- ==== COMPLETE ROOM CODE MIGRATION (WITH VIEWS) ====');
  
  console.log('\n-- STEP 1: Drop dependent views');
  console.log('DROP VIEW IF EXISTS player_games_redacted;');
  
  console.log('\n-- STEP 2: Drop RLS policies that reference game_rooms.id');
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
  
  console.log('\n-- STEP 3: Drop foreign key constraints');
  console.log('ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey;');
  console.log('ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey;');
  console.log('ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey;');
  
  console.log('\n-- STEP 4: Change column type (this will now work!)');
  console.log('ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8);');
  console.log('ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT;');
  
  console.log('\n-- STEP 5: Re-add foreign key constraints');
  console.log('ALTER TABLE active_games ADD CONSTRAINT active_games_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
  console.log('ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
  console.log('ALTER TABLE friend_game_invites ADD CONSTRAINT friend_game_invites_room_id_fkey FOREIGN KEY (room_id) REFERENCES game_rooms(id) ON DELETE CASCADE;');
  
  console.log('\n-- STEP 6: Recreate RLS policies');
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
  
  console.log('\n-- STEP 7: Recreate the player_games_redacted view');
  console.log(`CREATE OR REPLACE VIEW player_games_redacted AS
SELECT
  pg.game_id,
  pg.user_id,
  pg.position,
  pg.stack,
  pg.current_bet,
  pg.folded,
  pg.all_in,
  CASE
    WHEN pg.user_id = (current_setting('app.current_user_id', true))::uuid
      OR COALESCE(ag.state->>'phase', '') = 'showdown'
      THEN pg.cards
    ELSE '[]'::jsonb
  END AS cards,
  pg.last_action,
  pg.last_action_time
FROM player_games pg
JOIN active_games ag ON ag.id = pg.game_id
JOIN game_rooms gr ON gr.id = ag.room_id
WHERE (
  -- Player of the game
  EXISTS (
    SELECT 1 FROM player_games self
    WHERE self.game_id = pg.game_id
      AND self.user_id = (current_setting('app.current_user_id', true))::uuid
  )
  OR
  -- Or spectator of a public game
  gr.is_public = TRUE
);`);

  console.log('\nCOMMENT ON VIEW player_games_redacted IS \'Player view with hole cards redacted unless owner or showdown; spectators see only public games.\';');
  
  console.log('\n-- STEP 8: Re-enable RLS on tables');
  console.log('ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;');
  console.log('ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;');
  console.log('ALTER TABLE friend_game_invites ENABLE ROW LEVEL SECURITY;');
  console.log('ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;');
  
  console.log('\n🎉 COMPLETE migration SQL commands provided!');
  console.log('📝 Copy and paste ALL the commands above into your Supabase SQL editor');
  console.log('🚀 This handles RLS policies AND views - should work now!');
  console.log('💡 After running, room creation will work with alphanumeric codes like "WGDcNU4t"');
}

runCompleteRoomCodeMigrationWithViews().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});