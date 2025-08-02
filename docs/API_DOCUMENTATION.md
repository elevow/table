# API Documentation

## API Documentation

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
