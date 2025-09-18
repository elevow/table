const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

async function generateFixedRemainingSteps() {
  console.log('🔄 FIXED Remaining Migration Steps (8-10) - Drop then Create policies');
  console.log('📋 Since you completed steps 1-7, here are the corrected remaining steps:');
  console.log('\n-- ==== FIXED REMAINING MIGRATION STEPS (8-10) ====');
  
  console.log('\n-- STEP 8A: Drop any remaining policies first');
  console.log('DROP POLICY IF EXISTS spectators_can_view_public_games ON active_games;');
  console.log('DROP POLICY IF EXISTS players_can_view_their_games ON active_games;');
  console.log('DROP POLICY IF EXISTS room_creators_can_manage_games ON active_games;');
  console.log('DROP POLICY IF EXISTS players_can_send_chat_messages ON chat_messages;');
  console.log('DROP POLICY IF EXISTS players_can_view_chat_messages ON chat_messages;');
  console.log('DROP POLICY IF EXISTS users_can_manage_own_invites ON friend_game_invites;');
  console.log('DROP POLICY IF EXISTS users_can_view_received_invites ON friend_game_invites;');
  console.log('DROP POLICY IF EXISTS players_can_manage_own_rooms ON game_rooms;');
  console.log('DROP POLICY IF EXISTS spectators_can_view_public_rooms ON game_rooms;');
  
  console.log('\n-- STEP 8B: Create new RLS policies');
  
  console.log(`CREATE POLICY spectators_can_view_public_games ON active_games
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM game_rooms gr
    WHERE gr.id = active_games.room_id
    AND gr.is_public = TRUE
  )
);`);

  console.log(`CREATE POLICY players_can_view_their_games ON active_games
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM player_games pg
    WHERE pg.game_id = active_games.id
    AND pg.user_id = auth.uid()
  )
);`);

  console.log(`CREATE POLICY room_creators_can_manage_games ON active_games
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM game_rooms gr
    WHERE gr.id = active_games.room_id
    AND gr.created_by = auth.uid()
  )
);`);

  console.log(`CREATE POLICY players_can_send_chat_messages ON chat_messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM active_games ag
    JOIN player_games pg ON pg.game_id = ag.id
    WHERE ag.room_id = chat_messages.room_id
    AND pg.user_id = auth.uid()
  )
);`);

  console.log(`CREATE POLICY players_can_view_chat_messages ON chat_messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM active_games ag
    JOIN player_games pg ON pg.game_id = ag.id
    WHERE ag.room_id = chat_messages.room_id
    AND pg.user_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM active_games ag
    JOIN game_rooms gr ON gr.id = ag.room_id
    WHERE ag.room_id = chat_messages.room_id
    AND gr.is_public = TRUE
  )
);`);

  console.log(`CREATE POLICY users_can_manage_own_invites ON friend_game_invites
FOR ALL USING (
  inviter_id = auth.uid() OR invitee_id = auth.uid()
);`);

  console.log(`CREATE POLICY users_can_view_received_invites ON friend_game_invites
FOR SELECT USING (
  invitee_id = auth.uid()
);`);

  console.log(`CREATE POLICY players_can_manage_own_rooms ON game_rooms
FOR ALL USING (
  created_by = auth.uid()
);`);

  console.log(`CREATE POLICY spectators_can_view_public_rooms ON game_rooms
FOR SELECT USING (
  is_public = TRUE
);`);
  
  console.log('\n-- STEP 9: Recreate the player_games_redacted view');
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
  EXISTS (
    SELECT 1 FROM player_games self
    WHERE self.game_id = pg.game_id
      AND self.user_id = (current_setting('app.current_user_id', true))::uuid
  )
  OR
  gr.is_public = TRUE
);`);

  console.log('\nCOMMENT ON VIEW player_games_redacted IS \'Player view with hole cards redacted unless owner or showdown; spectators see only public games.\';');
  
  console.log('\n-- STEP 10: Re-enable RLS on tables');
  console.log('ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;');
  console.log('ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;');
  console.log('ALTER TABLE friend_game_invites ENABLE ROW LEVEL SECURITY;');
  console.log('ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;');
  
  console.log('\n🎉 FIXED remaining migration steps provided!');
  console.log('✅ First drops existing policies, then creates new ones');
  console.log('✅ No more CREATE OR REPLACE POLICY syntax errors');
  console.log('📝 Copy and paste the commands above into your Supabase SQL editor');
  console.log('🚀 This should complete the migration successfully!');
  console.log('💡 After running, room creation will work with codes like "WGDcNU4t"');
}

generateFixedRemainingSteps().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});