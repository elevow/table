# Database Schema User Stories - Part 3

## Row Level Security

### US-066: User Data Privacy
As a system administrator,
I want to implement row level security for user data,
So that users can only access their own information.

**Acceptance Criteria:**
- Enable RLS on users table
- Allow users to view only their data
- Allow users to update only their data
- Protect sensitive fields
- Log access attempts

**Technical Notes:**
```sql
-- Row Level Security Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own data"
    ON users FOR UPDATE
    USING (auth.uid() = id);
```

### US-067: Game Access Control
As a system administrator,
I want to implement row level security for game data,
So that only participating players can access game information.

**Acceptance Criteria:**
- Enable RLS on games table
- Allow access only to players in the game
- Protect hole cards until showdown
- Handle spectator access
- Log unauthorized attempts

**Technical Notes:**
```sql
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view games they're in"
    ON games FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM player_games
        WHERE game_id = id AND user_id = auth.uid()
    ));

CREATE POLICY "Spectators can view public game data"
    ON games FOR SELECT
    USING (status = 'public');
```

## Session Management

### US-068: Session Tracking
As a system administrator,
I want to track user sessions comprehensively,
So that we can manage user access and detect suspicious activity.

**Acceptance Criteria:**
- Store session tokens
- Track IP addresses
- Record user agents
- Handle session expiration
- Monitor concurrent sessions

**Technical Notes:**
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

## Security Logging

### US-069: Security Event Logging
As a security administrator,
I want comprehensive security event logging,
So that we can audit and investigate security incidents.

**Acceptance Criteria:**
- Log all security-related actions
- Include IP addresses
- Store detailed event information
- Support audit queries
- Implement log rotation

**Technical Notes:**
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

## Player Game State

### US-070: Active Game State
As a game engine,
I want to track detailed player state in active games,
So that game progress can be managed accurately.

**Acceptance Criteria:**
- Track player positions
- Manage player stacks
- Record current bets
- Handle fold/all-in states
- Store hole cards securely

**Technical Notes:**
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
```

## Game Room Management

### US-071: Room Configuration
As a room administrator,
I want to configure game rooms with specific rules and limits,
So that players can join appropriate games.

**Acceptance Criteria:**
- Set player limits
- Configure buy-in ranges
- Set blind levels
- Specify game type
- Handle room status changes

**Technical Notes:**
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
```

### US-072: Profile Management
As a player,
I want to manage my poker profile,
So that I can track my progress and customize my experience.

**Acceptance Criteria:**
- Store player preferences
- Track game statistics
- Support profile customization
- Manage display settings
- Handle timezone preferences

**Technical Notes:**
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
