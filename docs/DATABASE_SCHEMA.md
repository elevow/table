# Database Schema Design

## Core Tables

### Users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    encrypted_password TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    status TEXT DEFAULT 'offline',
    chips_balance INTEGER DEFAULT 1000,
    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$')
);

CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_username ON users(username);
```

### Profiles
```sql
CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    display_name TEXT,
    biography TEXT,
    location TEXT,
    timezone TEXT,
    preferences JSONB DEFAULT '{}',
    statistics JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Friends
```sql
CREATE TABLE friends (
    user_id UUID REFERENCES users(id),
    friend_id UUID REFERENCES users(id),
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id != friend_id)
);

CREATE INDEX idx_friends_status ON friends(status);
```

## Game Tables

### Rooms
```sql
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    game_type TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    max_players INTEGER DEFAULT 9,
    min_buy_in INTEGER NOT NULL,
    max_buy_in INTEGER NOT NULL,
    small_blind INTEGER NOT NULL,
    big_blind INTEGER NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_blinds CHECK (small_blind < big_blind),
    CONSTRAINT valid_buy_ins CHECK (min_buy_in < max_buy_in)
);

CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_game_type ON rooms(game_type);
```

### Games
```sql
CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id),
    status TEXT DEFAULT 'active',
    current_round INTEGER DEFAULT 1,
    pot INTEGER DEFAULT 0,
    board JSONB DEFAULT '[]',
    current_player_id UUID REFERENCES users(id),
    dealer_position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_room ON games(room_id);
```

### Player_Games
```sql
CREATE TABLE player_games (
    game_id UUID REFERENCES games(id),
    user_id UUID REFERENCES users(id),
    position INTEGER NOT NULL,
    stack INTEGER NOT NULL,
    current_bet INTEGER DEFAULT 0,
    folded BOOLEAN DEFAULT FALSE,
    all_in BOOLEAN DEFAULT FALSE,
    cards JSONB DEFAULT '[]',
    last_action TEXT,
    last_action_time TIMESTAMPTZ,
    PRIMARY KEY (game_id, user_id),
    CONSTRAINT valid_position CHECK (position >= 0 AND position < 9)
);

CREATE INDEX idx_player_games_user ON player_games(user_id);
```

## History Tables

### Hand_History
```sql
CREATE TABLE hand_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id UUID REFERENCES games(id),
    hand_number INTEGER NOT NULL,
    actions JSONB NOT NULL,
    results JSONB NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    winning_hands JSONB NOT NULL,
    pot_size INTEGER NOT NULL
);

CREATE INDEX idx_hand_history_game ON hand_history(game_id);
```

### Player_Statistics
```sql
CREATE TABLE player_statistics (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    hands_played INTEGER DEFAULT 0,
    hands_won INTEGER DEFAULT 0,
    total_profit INTEGER DEFAULT 0,
    biggest_pot INTEGER DEFAULT 0,
    total_time_played INTERVAL DEFAULT '0',
    last_calculated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Chat System

### Chat_Messages
```sql
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id),
    user_id UUID REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT message_length CHECK (char_length(message) <= 500)
);

CREATE INDEX idx_chat_messages_room ON chat_messages(room_id);
CREATE INDEX idx_chat_messages_created ON chat_messages(created_at);
```

## Security Tables

### User_Sessions
```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    token TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);
```

### Security_Logs
```sql
CREATE TABLE security_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    ip_address INET,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_security_logs_user ON security_logs(user_id);
CREATE INDEX idx_security_logs_action ON security_logs(action);
```

## Row Level Security Policies

### Users Table Policies
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own data"
    ON users FOR UPDATE
    USING (auth.uid() = id);
```

### Games Table Policies
```sql
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view games they're in"
    ON games FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM player_games
        WHERE game_id = id AND user_id = auth.uid()
    ));
```

### Chat Messages Policies
```sql
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages in their rooms"
    ON chat_messages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM player_games
        WHERE game_id IN (SELECT id FROM games WHERE room_id = chat_messages.room_id)
        AND user_id = auth.uid()
    ));
```
