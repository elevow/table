-- Room Code Migration: Change game_rooms.id from UUID to VARCHAR(8)
-- This enables the use of short alphanumeric room codes instead of UUIDs

BEGIN;

-- Step 1: Drop foreign key references to game_rooms.id
ALTER TABLE active_games DROP CONSTRAINT IF EXISTS active_games_room_id_fkey;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_id_fkey; 
ALTER TABLE friend_game_invites DROP CONSTRAINT IF EXISTS friend_game_invites_room_id_fkey;

-- Step 2: Change the data type of the id column
ALTER TABLE game_rooms ALTER COLUMN id SET DATA TYPE VARCHAR(8);

-- Step 3: Remove the default UUID generation since we'll generate codes in the application
ALTER TABLE game_rooms ALTER COLUMN id DROP DEFAULT;

-- Step 4: Re-add foreign key constraints with the new VARCHAR(8) type
ALTER TABLE active_games ADD CONSTRAINT active_games_room_id_fkey 
  FOREIGN KEY (room_id) REFERENCES game_rooms(id);
  
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_room_id_fkey 
  FOREIGN KEY (room_id) REFERENCES game_rooms(id);
  
ALTER TABLE friend_game_invites ADD CONSTRAINT friend_game_invites_room_id_fkey 
  FOREIGN KEY (room_id) REFERENCES game_rooms(id);

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