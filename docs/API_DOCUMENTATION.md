# API Documentation

## API Documentation

### Tournament Management Endpoints

1. Create Tournament
```typescript
POST /api/tournaments/create
Rate Limit: 60/min

Request:
{
  name: string,
  config: TournamentConfig // validated server-side
}

Response: TournamentState
```

2. Get Tournament
```typescript
GET /api/tournaments/get?tournamentId=string
Rate Limit: 120/min

Response: TournamentState
```

3. Register Player
```typescript
POST /api/tournaments/register
Rate Limit: 120/min

Request: { tournamentId: string, userId: string }
Response: TournamentState
```

4. Start/Pause/Resume
```typescript
POST /api/tournaments/start    // { tournamentId }
POST /api/tournaments/pause    // { tournamentId }
POST /api/tournaments/resume   // { tournamentId }
Rate Limit: 60/min

Response: TournamentState
```

5. Advance Level / End Break
```typescript
POST /api/tournaments/advance-level // { tournamentId }
POST /api/tournaments/end-break     // { tournamentId }
Rate Limit: 120/min

Response: TournamentState
```

6. Eliminate Player
```typescript
POST /api/tournaments/eliminate
Rate Limit: 120/min

Request: { tournamentId: string, userId: string }
Response: TournamentState
```

7. Rebuy / Add-on
```typescript
POST /api/tournaments/rebuy
POST /api/tournaments/add-on
Rate Limit: 120/min

Request: { tournamentId: string, userId: string }
Response: TournamentState

Notes:
- Rebuy validates tournament type, availability window, and per-player limits.
- Add-on is restricted to the configured break level and allowed once per player.
```

8. Payouts (preview)
```typescript
GET /api/tournaments/payouts?tournamentId=string&prizePool=number
Rate Limit: 120/min

Response: {
  placesPaid: number,
  distribution: Array<{ place: number; amount: number }>
}
```

9. Tournament Report
```typescript
GET /api/tournaments/report?tournamentId=string&prizePool=number
Rate Limit: 120/min

Response: TournamentReporting // registration timeline, eliminations, prize distribution, stats
```

### Avatar Management Endpoints

1. Upload Avatar
```typescript
POST /api/avatars/upload
Content-Type: multipart/form-data
Rate Limit: 5 requests per hour

Request:
{
  file: File,
  cropData?: {
    x: number,
    y: number,
    width: number,
    height: number
  }
}

Response:
{
  id: string,
  url: string,
  thumbnails: {
    small: string,  // 32x32
    medium: string, // 64x64
    large: string   // 128x128
  },
  status: 'pending'
}
```

2. Get Avatar
```typescript
GET /api/avatars/:userId
Rate Limit: 60 requests per minute

Response:
{
  id: string,
  url: string,
  thumbnails: {
    small: string,
    medium: string,
    large: string
  },
  status: 'pending' | 'active' | 'rejected'
}
```

3. Update Avatar
```typescript
PUT /api/avatars/:avatarId
Content-Type: multipart/form-data
Rate Limit: 5 requests per hour

Request: Same as upload
Response: Same as upload
```

4. Delete Avatar
```typescript
DELETE /api/avatars/:avatarId
Rate Limit: 5 requests per hour

Response:
{
  success: boolean,
  message: string
}
```

### Rate Limiting

```typescript
const RATE_LIMITS = {
  // Avatar endpoints
  'POST /api/avatars/upload': {
    window: '1h',
    max: 5,
    errorMessage: 'Upload limit exceeded. Try again later.'
  },
  'PUT /api/avatars/:avatarId': {
    window: '1h',
    max: 5,
    errorMessage: 'Update limit exceeded. Try again later.'
  },
  'GET /api/avatars/:userId': {
    window: '1m',
    max: 60,
    errorMessage: 'Too many requests. Please slow down.'
  },
  'DELETE /api/avatars/:avatarId': {
    window: '1h',
    max: 5,
    errorMessage: 'Delete limit exceeded. Try again later.'
  }
};
```

### Regular Endpoints

### Authentication
1. User Management
   ```
   POST /api/auth/register
   POST /api/auth/login
   POST /api/auth/logout
   POST /api/auth/refresh-token
   POST /api/auth/forgot-password
   POST /api/auth/reset-password
   ```

2. Profile Management
   ```
   GET /api/profile
   PUT /api/profile
   GET /api/profile/statistics
   GET /api/profile/history
   PUT /api/profile/settings
   ```

### Game Management
1. Room Operations
   ```
   POST /api/rooms
   GET /api/rooms
   GET /api/rooms/:id
   PUT /api/rooms/:id
   DELETE /api/rooms/:id
   POST /api/rooms/:id/join
   POST /api/rooms/:id/leave
   ```

2. Game Actions
   ```
   POST /api/games/:id/action
   GET /api/games/:id/state
   GET /api/games/:id/history
   POST /api/games/:id/chat
   ```

### Run It Twice (RIT)

1. Verify RNG Audit and Outcomes
```typescript
GET /api/history/run-it-twice/verify
Rate Limit: 120 requests per minute

Query Params:
{
  handId: string;                        // required
  publicSeed?: string;                   // optional
  proof?: string;                        // optional
  timestamp?: number;                    // optional (ms since epoch)
  playerEntropy?: string;                // optional
  hashChain?: string | string[];         // optional (JSON array or comma-separated)
}

Response (audit metadata provided):
{
  handId: string;
  auditAvailable: true;
  verified: boolean;                     // true if hashChain matches recomputed chain
  numberOfRuns: number;
  publicSeed: string;
  proof: string;
  hashChain: string[];                   // expected per-run seeds
  playerEntropy?: string;
  timestamp: number;
  outcomes: Array<{                      // persisted per-run results
    id: string;
    handId: string;
    boardNumber: number;
    communityCards: string[];
    winners: Array<{ playerId: string; amount: number }>;
    potAmount: number;
  }>;
}

Response (no/partial audit metadata):
{
  handId: string;
  auditAvailable: false;
  verified: false;
  reason: 'rng metadata not provided';
  numberOfRuns: number;                  // inferred from outcomes
  outcomes: Array<...>;
}

Notes:
- hashChain accepts a JSON-encoded array (e.g. "[\"s1\",\"s2\"]") or comma-separated string (e.g. "s1,s2").
- When audit metadata is provided, the endpoint recomputes the expected seeds and compares with hashChain to set verified.
- Outcomes are always returned for the given handId when available.
```

### Security & Anti‑Collusion

1. Collusion Analysis
```typescript
POST /api/security/collusion
Rate Limit: 60/min

Request:
{
  hands: Array<{
    id: string;
    players: string[];                 // participating player IDs
    actions?: Array<{                  // optional; when present, used for betting pattern metrics
      playerId: string;
      type: 'fold' | 'check' | 'call' | 'bet' | 'raise';
      amount?: number;
      street?: 'preflop' | 'flop' | 'turn' | 'river';
      timestamp?: number;
    }>;
    contributions?: Record<string, number>; // per-player committed chips for the hand
    winnerId?: string;                  // final winner for concentration analysis
    potAmount?: number;                 // total pot for thresholding
    timestamp?: number;
  }>
}

Response:
{
  suspicious: boolean;
  alerts: Array<{
    id: string;
    type: 'betting_anomaly' | 'player_grouping' | 'folding_pattern' | 'chip_dumping';
    severity: 'low' | 'medium' | 'high';
    message: string;
    evidence?: any;
  }>;
  metrics: {
    betting: Record<string, { vpip: number; pfr: number; aggression: number; suspicious: boolean }>;
    groupings: Array<{ players: [string, string]; coHands: number; ratio: number; suspicious: boolean }>;
    folding: Record<string, { opportunities: number; foldToAggPct: number; suspicious: boolean }>;
    chipDumping: Array<{ from: string; to: string; occurrences: number; totalAmount: number; suspicious: boolean }>;
  };
}

Notes:
- Heuristics flag extreme VPIP/PFR/aggression, unusually frequent co‑play pairs, high fold‑to‑aggressor, and concentrated transfers to the same winner.
- Thresholds are conservative and may be tuned; use results as investigative leads, not definitive judgments.
```

2. Multi‑Account Detection
```typescript
POST /api/security/multi-account
Rate Limit: 60/min

Request:
{
  logins: Array<{
    accountId: string;
    ip: string;
    timestamp: number;           // ms since epoch
    fingerprint?: string;        // device fingerprint id
    userAgent?: string;
  }>
}

Response:
{
  signals: {
    ip: Array<{ ip: string; accounts: string[]; count: number; recentAt?: number; risk: 'low'|'medium'|'high' }>;
    device: Array<{ fingerprint: string; accounts: string[]; userAgents?: string[]; count: number; risk: 'low'|'medium'|'high' }>;
    behavior: Array<{ accountId: string; metric: 'login_frequency'|'ip_diversity'|'device_diversity'; value: number; risk: 'low'|'medium'|'high' }>;
    timing: Array<{ pair: [string,string]; overlaps: number; medianDeltaMs: number | null; risk: 'low'|'medium'|'high' }>;
  };
  confidence: number;            // 0..1 weighted by signal strengths
  linkedAccounts: string[];      // union of accounts implicated by medium/high risk signals
}

Notes:
- Shared IPs/devices across multiple accounts, repeated near‑simultaneous logins, and extreme behavior metrics raise risk.
- Use as investigative input; combine with manual review and policy.
```

### Rabbit Hunt Preview

Preview the remaining community cards and the remaining deck without mutating live game state.

```typescript
GET /api/rabbit-hunt/preview
Rate Limit: 300 requests per minute

Query Params:
{
  roomId: string;                         // required – active room identifier
  street: 'flop' | 'turn' | 'river';      // required – target preview street
  knownCards?: string | string[];         // optional – cards to exclude (player/known), CSV or repeated query param
  communityCards?: string | string[];     // optional – current community snapshot, CSV or repeated query param
}

Notes:
- knownCards/communityCards accept either a comma-separated string (e.g. "Ah,Kd,Ts") or repeated query params (?knownCards=Ah&knownCards=Kd).
- Card strings use the DB card format used elsewhere in the system.

Response:
{
  street: 'flop' | 'turn' | 'river';
  revealedCards: string[];                // previewed community cards to reach the requested street
  remainingDeck: string[];                // snapshot of the remaining deck after the preview draw
}

Example:
// GET /api/rabbit-hunt/preview?roomId=room-123&street=turn&communityCards=Ah,Kd,Ts
{
  "street": "turn",
  "revealedCards": ["2c"],
  "remainingDeck": ["3c","4c","5c", "..." ]
}
```

### Social Features
1. Friend Management
   ```
   GET /api/friends
   POST /api/friends/request
   PUT /api/friends/accept
   DELETE /api/friends/:id
   GET /api/friends/online
   ```

2. Notifications
   ```
   GET /api/notifications
   PUT /api/notifications/:id
   DELETE /api/notifications/:id
   ```

## WebSocket Events

### Connection Events
1. Authentication
   ```
   socket.on('authenticate')
   socket.on('disconnect')
   socket.on('reconnect')
   ```

2. Room Events
   ```
   socket.on('room:join')
   socket.on('room:leave')
   socket.on('room:update')
   socket.on('room:chat')
   ```

### Game Events
1. Game State
   ```
   socket.on('game:start')
   socket.on('game:update')
   socket.on('game:end')
   socket.emit('game:state')
   ```

2. Player Actions
   ```
   socket.emit('action:fold')
   socket.emit('action:check')
   socket.emit('action:call')
   socket.emit('action:raise')
   ```

3. Timer Events
   ```
   socket.on('timer:start')
   socket.on('timer:update')
   socket.on('timer:expire')
   ```

## Request/Response Formats

### Standard Response Format
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    pagination?: {
      page: number;
      limit: number;
      total: number;
    };
  };
}
```

### Error Codes
1. Authentication Errors
   - AUTH_001: Invalid credentials
   - AUTH_002: Token expired
   - AUTH_003: Invalid token
   - AUTH_004: Insufficient permissions

2. Game Errors
   - GAME_001: Invalid action
   - GAME_002: Not your turn
   - GAME_003: Invalid bet amount
   - GAME_004: Room full

## WebSocket Message Formats

### Game State Message
```typescript
interface GameState {
  gameId: string;
  phase: GamePhase;
  players: Player[];
  activePlayer: string;
  pot: number;
  board: Card[];
  lastAction: Action;
  timer: Timer;
}
```

### Action Message
```typescript
interface ActionMessage {
  type: ActionType;
  playerId: string;
  amount?: number;
  timestamp: number;
}
```

## Rate Limiting

### API Limits
1. Authentication
   - Register: 5 requests per hour
   - Login: 10 requests per minute
   - Password Reset: 3 requests per hour

2. Game Actions
   - Room Creation: 10 per hour
   - Game Actions: 60 per minute
   - Chat Messages: 120 per minute

### WebSocket Limits
1. Connection Limits
   - Max connections per user: 3
   - Reconnection rate: 10 per minute
   - Message rate: 60 per minute

## Error Handling

### HTTP Status Codes
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 409: Conflict
- 429: Too Many Requests
- 500: Internal Server Error

### Error Responses
```typescript
interface ErrorResponse {
  code: string;
  message: string;
  details?: {
    field?: string;
    reason?: string;
    suggestion?: string;
  };
}
```

## API Versioning
- Version in URL: /api/v1/
- Version Header: X-API-Version
- Deprecation Header: X-API-Deprecated
- Sunset Header: X-API-Sunset
