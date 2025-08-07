# Development Environment Setup

## Prerequisites

1. Node.js and npm
   - Install Node.js v18+ from [nodejs.org](https://nodejs.org/)
   - This will also install npm (Node Package Manager)

2. Development Tools
   ```bash
   # Install TypeScript globally
   npm install -g typescript

   # Install development database
   npm install -g supabase
   ```

3. Redis (for feature state management)
   - Windows: Download from [Redis for Windows](https://github.com/microsoftarchive/redis/releases)
   - Mac: `brew install redis`
   - Linux: `sudo apt-get install redis-server`

## Project Setup

1. Clone and Install Dependencies
   ```bash
   # Clone the repository
   git clone https://github.com/elevow/table.git
   cd table

   # Install project dependencies
   npm install
   ```

2. Environment Configuration
   Create a `.env.local` file in the project root:
   ```env
   # Supabase Configuration
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

   # Redis Configuration
   REDIS_URL=redis://localhost:6379

   # WebSocket Configuration
   SOCKET_SERVER_URL=http://localhost:3001
   ```

3. Start Development Services
   ```bash
   # Start Redis server
   redis-server

   # In a new terminal, start the development server
   npm run dev
   ```

## Core Components Setup

### 1. Database Setup
```bash
# Initialize Supabase project
supabase init

# Start Supabase local development
supabase start

# Apply database migrations
supabase db reset
```

### 2. Game Engine Components
The following npm packages will be installed automatically via package.json:
```json
{
  "dependencies": {
    "next": "^13.0.0",
    "socket.io": "^4.0.0",
    "socket.io-client": "^4.0.0",
    "@supabase/supabase-js": "^2.0.0",
    "ioredis": "^5.0.0",
    "typescript": "^4.9.0",
    "@types/node": "^18.0.0",
    "@types/react": "^18.0.0",
    "pokersolver": "^2.1.4"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "@testing-library/react": "^13.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
```

## Core Engine Implementation Order

Follow these user stories in sequence:

1. Basic Game Flow (US-001)
   - Implement game state management
   - Set up state transitions
   - Create basic card dealing logic

2. Real-time Updates (US-002)
   - Configure Socket.io
   - Implement state broadcasting
   - Set up reconnection handling

3. Action Processing (US-003)
   - Implement action validation
   - Create pot management
   - Set up action broadcasting

4. Timer Management (US-004)
   - Implement countdown system
   - Set up time bank
   - Configure auto-actions

5. Hand Evaluation (US-005)
   - Implement poker hand evaluation
   - Set up winner determination
   - Configure pot distribution

6. State Recovery (US-006)
   - Implement state preservation
   - Set up action replay
   - Configure reconnection logic

7. Performance Optimization (US-007, US-008)
   - Set up monitoring
   - Implement caching
   - Configure load balancing

## Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage
```

## Common Issues and Solutions

1. Redis Connection Issues
   ```bash
   # Check if Redis is running
   redis-cli ping
   # Should return PONG
   ```

2. Supabase Connection Issues
   ```bash
   # Check Supabase status
   supabase status
   ```

3. WebSocket Issues
   - Ensure ports 3000 (Next.js) and 3001 (Socket.io) are available
   - Check firewall settings

## Development Tools

Recommended VS Code extensions:
- ESLint
- Prettier
- TypeScript + Webpack Problem Matchers
- Jest Runner
- Redis
- REST Client

## Debugging

1. Client-side debugging:
   - Use Chrome DevTools
   - Enable source maps in tsconfig.json
   - Use React DevTools for component debugging

2. Server-side debugging:
   - Use VS Code debugger
   - Configure launch.json for Next.js
   - Use debug logs

3. WebSocket debugging:
   - Use Socket.io Admin UI
   - Monitor Redis pub/sub
   - Track connection states
