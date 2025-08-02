# Data Management Strategy

## Data Flow Architecture

### Client-Side Data Flow
1. State Management
   - Redux store structure
   - Action creators
   - Reducers organization
   - Middleware configuration
   - Selector patterns

2. Real-Time Data Handling
   - Socket.io event management
   - Event queuing system
   - Offline data handling
   - Reconnection strategies
   - State rehydration

3. Local Storage Strategy
   - User preferences
   - Game history
   - Cached assets
   - Session data
   - Offline capabilities

### Server-Side Data Flow
1. Data Layer Architecture
   ```
   [Client Layer]
        ↕
   [API Gateway]
        ↕
   [Game Service] ←→ [State Manager]
        ↕               ↕
   [Database] ←→ [Cache Layer]
   ```

2. Service Communication
   - Event-driven architecture
   - Message queues
   - Service discovery
   - Load balancing
   - Error handling

## Caching Strategy

### Client-Side Caching
1. Browser Cache
   - Static assets
   - API responses
   - Game states
   - User preferences
   - Service worker implementation

2. Memory Caching
   - Game state
   - Frequently accessed data
   - User session
   - Socket connections
   - Temporary calculations

### Server-Side Caching
1. Redis Implementation
   - Session storage
   - Game state caching
   - Leaderboard data
   - Rate limiting
   - Pub/sub system
   - Avatar cache (with size variants)

2. CDN Integration
   - Avatar storage
   - Image optimization
   - Regional distribution
   - Cache invalidation
   - Fallback handling

2. Cache Invalidation
   - Time-based expiration
   - Event-based invalidation
   - Version tagging
   - Soft deletes
   - Cache warming

## State Management

### Game State
1. Core State Structure
   ```typescript
   interface GameState {
     tableId: string;
     players: Player[];
     deck: Card[];
     pot: {
       main: number;
       side: number[];
     };
     currentRound: Round;
     activePlayer: string;
     lastAction: Action;
   }
   ```

2. State Transitions
   - Action validation
   - State updates
   - Event broadcasting
   - History tracking
   - Error recovery

### Player State
1. Core State Structure
   ```typescript
   interface PlayerState {
     id: string;
     stack: number;
     cards: Card[];
     position: Position;
     status: Status;
     timeBank: number;
   }
   ```

2. State Synchronization
   - Bi-directional updates
   - Conflict resolution
   - State verification
   - Recovery mechanisms
   - Version control

## Data Persistence

### Database Strategy
1. Primary Data Store (PostgreSQL)
   - User accounts
   - Transaction history
   - Game records
   - Statistics
   - Audit logs

2. Real-Time Store (Redis)
   - Active games
   - Session data
   - Leaderboards
   - Rate limiting
   - Temporary data

### Data Models
1. Core Models
   ```typescript
   // User Model
   interface User {
     id: string;
     username: string;
     email: string;
     preferences: UserPreferences;
     statistics: UserStatistics;
     wallet: WalletInfo;
     avatar: AvatarInfo;
   }

   // Avatar Model
   interface AvatarInfo {
     id: string;
     type: 'default' | 'custom';
     url: string;
     thumbnails: {
       small: string;   // 32x32
       medium: string;  // 64x64
       large: string;   // 128x128
     };
     uploadedAt?: Date;
     status: 'pending' | 'active' | 'rejected';
     moderationStatus?: 'pending' | 'approved' | 'rejected';
     lastModifiedAt: Date;
   }

   // Game History Model
   interface GameHistory {
     id: string;
     tableId: string;
     players: PlayerSummary[];
     startTime: Date;
     endTime: Date;
     hands: HandSummary[];
     transactions: Transaction[];
   }
   ```

2. Relationships
   - User to Games
   - Games to Hands
   - Hands to Actions
   - Users to Statistics
   - Tables to Tournament

## Real-Time Sync Mechanisms

### WebSocket Implementation
1. Event Types
   ```typescript
   enum GameEvents {
     PLAYER_ACTION,
     STATE_UPDATE,
     TIMER_UPDATE,
     CHAT_MESSAGE,
     ERROR_NOTIFICATION
   }
   ```

2. Sync Protocol
   - Event serialization
   - Order guarantee
   - Delivery confirmation
   - Retry mechanism
   - Timeout handling

### Conflict Resolution
1. Strategy
   - Last-write-wins
   - Merge resolution
   - Version vectors
   - Conflict detection
   - State reconciliation

2. Recovery Procedures
   - State verification
   - Data reconstruction
   - History replay
   - Client resync
   - Error compensation
