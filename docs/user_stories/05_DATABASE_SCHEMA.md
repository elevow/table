# Database Schema User Stories

## User Management Schema

### US-017: Core User Profile
As a system,
I want to store comprehensive user profile data,
So that we can support user authentication and profile features.

**Acceptance Criteria:**
- Store basic user information (id, email, username)
- Support multiple authentication providers
- Track user creation and last login
- Handle password reset tokens

**Technical Notes:**
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    auth_provider VARCHAR(50),
    auth_provider_id TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    metadata JSONB
);

CREATE TABLE auth_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(50) NOT NULL
);
```

### US-018: Avatar Management
As a system,
I want to manage user avatars with multiple variants and moderation,
So that users can personalize their profiles safely.

**Acceptance Criteria:**
- Store avatar metadata and URLs
- Track multiple size variants
- Support moderation workflow
- Maintain version history

**Technical Notes:**
```sql
CREATE TABLE avatars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    original_url TEXT NOT NULL,
    variants JSONB NOT NULL,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    moderated_at TIMESTAMP WITH TIME ZONE,
    moderator_id UUID REFERENCES users(id)
);

CREATE TABLE avatar_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    avatar_id UUID REFERENCES avatars(id),
    version INTEGER NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### US-019: Friend Relationships
As a system,
I want to manage user friend relationships,
So that users can connect and play with friends.

**Acceptance Criteria:**
- Track friend connections
- Support friend requests
- Handle blocking
- Maintain relationship history

**Technical Notes:**
```sql
CREATE TABLE friend_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    friend_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, friend_id)
);

CREATE TABLE blocked_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    blocked_id UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, blocked_id)
);
```

## Game Management Schema

### US-020: Active Games
As a system,
I want to track active game states and configurations,
So that we can manage ongoing poker games.

**Acceptance Criteria:**
- Store game configuration
- Track current game state
- Handle player positions
- Manage game lifecycle

**Technical Notes:**
```sql
CREATE TABLE game_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    max_players INTEGER NOT NULL,
    blind_levels JSONB NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'waiting',
    configuration JSONB
);

CREATE TABLE active_games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES game_rooms(id),
    current_hand_id UUID,
    dealer_position INTEGER,
    current_player_position INTEGER,
    pot DECIMAL(15,2) DEFAULT 0,
    state JSONB,
    last_action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### US-021: Hand History
As a system,
I want to record detailed hand history,
So that we can support replay and analysis features.

**Acceptance Criteria:**
- Record all player actions
- Store card information
- Support special features (Run it Twice)
- Track betting rounds

**Technical Notes:**
```sql
CREATE TABLE hand_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id UUID REFERENCES active_games(id),
    hand_number INTEGER NOT NULL,
    community_cards TEXT[],
    player_cards JSONB,
    actions JSONB[],
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    winners JSONB,
    pot_distribution JSONB
);

CREATE TABLE run_it_twice_outcomes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hand_id UUID REFERENCES hand_history(id),
    board_number INTEGER NOT NULL,
    community_cards TEXT[],
    winners JSONB,
    pot_amount DECIMAL(15,2)
);
```

### US-022: Player Statistics
As a system,
I want to track comprehensive player statistics,
So that we can provide insights and achievements.

**Acceptance Criteria:**
- Track win/loss records
- Calculate key statistics
- Store achievement progress
- Support leaderboards

**Technical Notes:**
```sql
CREATE TABLE player_statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    hands_played INTEGER DEFAULT 0,
    hands_won INTEGER DEFAULT 0,
    total_profit DECIMAL(15,2) DEFAULT 0,
    biggest_pot DECIMAL(15,2) DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    game_specific_stats JSONB
);

CREATE TABLE achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    achievement_type VARCHAR(50) NOT NULL,
    achieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB
);
```

### US-023: Chat System
As a system,
I want to store chat messages and history,
So that we can support social interaction features.

**Acceptance Criteria:**
- Store messages with metadata
- Support room and private chat
- Enable message moderation
- Maintain chat history

**Technical Notes:**
```sql
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES game_rooms(id),
    sender_id UUID REFERENCES users(id),
    message TEXT NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    recipient_id UUID REFERENCES users(id),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_moderated BOOLEAN DEFAULT FALSE,
    moderated_at TIMESTAMP WITH TIME ZONE,
    moderator_id UUID REFERENCES users(id)
);

CREATE INDEX chat_messages_room_id_idx ON chat_messages(room_id);
CREATE INDEX chat_messages_sender_id_idx ON chat_messages(sender_id);
```

## Feature-Specific Schema

### US-024: Rabbit Hunting
As a system,
I want to store rabbit hunting data,
So that we can support the rabbit hunting feature.

**Acceptance Criteria:**
- Store remaining deck state
- Track revealed cards
- Manage cooldown periods
- Record usage statistics

**Technical Notes:**
```sql
CREATE TABLE rabbit_hunt_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hand_id UUID REFERENCES hand_history(id),
    requested_by UUID REFERENCES users(id),
    revealed_cards TEXT[],
    remaining_deck TEXT[],
    revealed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    street VARCHAR(20) NOT NULL
);

CREATE TABLE feature_cooldowns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    feature_type VARCHAR(50) NOT NULL,
    last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    next_available TIMESTAMP WITH TIME ZONE NOT NULL
);
```
