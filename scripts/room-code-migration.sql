-- Room Code Migration: Change game_rooms.id from UUID to VARCHAR(8)
-- This enables the use of short alphanumeric room codes instead of UUIDs

BEGIN;

-- Step 0: Drop dependent view and policies that reference game_rooms.id/active_games.room_id
DROP VIEW IF EXISTS player_games_redacted;
DROP POLICY IF EXISTS spectators_can_view_public_games ON active_games;

-- Step 1: Drop foreign key references to game_rooms.id
ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey; 
ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey;

-- Step 2: Change the data type of referencing columns first (ensure casts)
ALTER TABLE active_games ALTER COLUMN room_id TYPE VARCHAR(8) USING room_id::text;
ALTER TABLE chat_messages ALTER COLUMN room_id TYPE VARCHAR(8) USING room_id::text;
ALTER TABLE friend_game_invites ALTER COLUMN room_id TYPE VARCHAR(8) USING room_id::text;

-- Step 3: Change the data type of the primary id column (use explicit cast)
ALTER TABLE game_rooms ALTER COLUMN id TYPE VARCHAR(8) USING id::text;

-- Step 4: Remove the default UUID generation since we'll generate codes in the application
ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT;

-- Step 5: Re-add foreign key constraints with the new VARCHAR(8) type
ALTER TABLE active_games ADD CONSTRAINT active_games_room_id_fkey 
  FOREIGN KEY (room_id) REFERENCES game_rooms(id);
  
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_id_fkey 
  FOREIGN KEY (room_id) REFERENCES game_rooms(id);
  
ALTER TABLE friend_game_invites ADD CONSTRAINT friend_game_invites_room_id_fkey 
  FOREIGN KEY (room_id) REFERENCES game_rooms(id);

-- Step 6: Recreate dropped policy and view with new types
CREATE POLICY spectators_can_view_public_games
ON active_games FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM game_rooms gr
        WHERE gr.id = room_id AND gr.is_public = TRUE
    )
);

CREATE OR REPLACE VIEW player_games_redacted AS
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
);

-- Step 5: Verify the changes
SELECT 
  table_name, 
  column_name, 
  data_type, 
  character_maximum_length,
  column_default
FROM information_schema.columns 
WHERE table_name = 'game_rooms' AND column_name = 'id';

COMMIT;

-- Success message
SELECT 'Room code migration completed successfully! game_rooms.id is now VARCHAR(8)' AS status;