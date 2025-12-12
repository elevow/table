# Development Environment Setup

## Prerequisites

1. Node.js and npm
   - Install Node.js v18+ from [nodejs.org](https://nodejs.org/)
   - This will also install npm (Node Package Manager)

2. (Optional) PostgreSQL
   - For local development, install PostgreSQL 13+ from [postgresql.org](https://www.postgresql.org/download/)
   - Or use a managed PostgreSQL service (Supabase, AWS RDS, etc.)
   - Or use mock database mode (no PostgreSQL required)

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
   Create a `.env.local` file in the project root. You have three options:

   **Option A: Mock Database (simplest, no PostgreSQL required)**
   ```env
   # Forces internal DB helpers to use an in-memory mock
   USE_MOCK_DB=true
   ```

   **Option B: Local PostgreSQL**
   
   First, install and start PostgreSQL on your system:
   - macOS: `brew install postgresql && brew services start postgresql`
   - Ubuntu: `sudo apt-get install postgresql && sudo systemctl start postgresql`
   - Windows: Download and install from [postgresql.org](https://www.postgresql.org/download/)
   
   Create a database:
   ```bash
   createdb table
   ```
   
   Then configure your environment:
   ```env
   # PostgreSQL (used by pg.Pool)
   PGHOST=localhost
   PGPORT=5432
   PGDATABASE=table
   PGUSER=postgres
   PGPASSWORD=postgres
   PGSSLMODE=disable

   # Alternative variable names
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=table
   DB_USER=postgres
   DB_PASSWORD=postgres
   DB_SSL=false

   # Pool/Direct database URLs
   POOL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/table
   DIRECT_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/table
   ```

   **Option C: Supabase (recommended for production-like development)**
   
   Create a Supabase project at [supabase.com](https://supabase.com/), then configure:
   ```env
   # Supabase Configuration
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

   # Database URLs from Supabase dashboard
   POOL_DATABASE_URL=your_supabase_pool_url
   DIRECT_DATABASE_URL=your_supabase_direct_url
   ```

3. Initialize Database Schema (if using Option B or C)
   ```bash
   # Apply migrations using the migration script
   npm run db:migrate

   # Or manually apply SQL files from:
   # - src/lib/database/schema/full-schema.sql (core tables)
   # - src/lib/database/schema/user-management.sql (RLS policies)
   # - src/lib/database/schema/game-access.sql (access control)
   ```

4. Start Development Server
   ```bash
   npm run dev
   ```

   The application will be available at http://localhost:3000

## Core Components Setup

### 1. Database Setup

The project uses PostgreSQL with Supabase Realtime for game state synchronization. Choose one of these approaches:

**Local PostgreSQL**

Install PostgreSQL on your system:
- macOS: `brew install postgresql && brew services start postgresql`
- Ubuntu: `sudo apt-get install postgresql && sudo systemctl start postgresql`
- Windows: Download from [postgresql.org](https://www.postgresql.org/download/)

Create the database and apply migrations:
```bash
# Create the database
createdb table

# Apply schema migrations
npm run db:migrate
```

**Supabase (recommended)**
```bash
# No local database needed - configure Supabase URLs in .env.local
# Schema can be applied via Supabase SQL Editor:
# 1. Copy SQL from src/lib/database/schema/full-schema.sql
# 2. Execute in Supabase SQL Editor
# 3. Apply RLS policies from user-management.sql and game-access.sql

# Or use the migration script
npm run db:migrate
```

### 2. Application Dependencies

The following npm packages are installed automatically via `npm install`:

**Core Dependencies:**
- `next` (^13.0.0) - React framework
- `react` (^18.2.0) - UI library
- `typescript` (^4.9.0) - Type safety
- `@supabase/supabase-js` (^2.0.0) - Supabase client with Realtime support
- `pokersolver` (^2.1.4) - Poker hand evaluation
- `tailwindcss` (^3.0.0) - CSS framework

**Database & Backend:**
- `pg` - PostgreSQL client (dev dependency for migrations)
- `ioredis` (^5.0.0) - Redis client (legacy dependency; currently used in cache-manager utility for optional caching)

**Testing:**
- `jest` (^29.7.0) - Test framework
- `@testing-library/react` (^13.0.0) - React testing utilities
- `ts-jest` (^29.4.1) - TypeScript support for Jest

### 3. Real-time Communication

The application uses **Supabase Realtime** for real-time game updates:
- Game state changes broadcast via Supabase channels
- Seat management and player actions synchronized in real-time
- Chat messages delivered through Supabase Realtime
- No separate WebSocket server required

**Note:** Some legacy Socket.io patterns and references remain in the codebase (e.g., in test files and state management modules) for compatibility and transitional purposes. Developers may encounter Socket.io-related code, which is being phased out as the migration to Supabase Realtime completes.

## Development Workflow

### Feature Implementation

The application is built following modular user stories documented in `docs/user_stories/`. Key implementation areas:

1. **Game Engine** (`src/lib/poker/`)
   - Game state management
   - Hand evaluation using pokersolver
   - Action validation and processing
   - Pot distribution logic

2. **Real-time Layer** (Supabase Realtime)
   - State broadcasting via channels
   - Seat synchronization
   - Chat messaging
   - Reconnection handling

3. **Data Layer** (`src/lib/database/`)
   - PostgreSQL schema and migrations
   - Hand history and player statistics
   - User management and authentication
   - Game rooms and session management

4. **API Routes** (`pages/api/`)
   - Game actions (bet, fold, call, etc.)
   - Room management
   - User profile and avatar management
   - Chat and social features

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run with coverage report
npm run test:coverage

# Run specific test pattern
npm test -- "pattern" --no-coverage

# Examples:
npm test -- "poker" --no-coverage          # Run poker-related tests
npm test -- "action-manager" --no-coverage # Run action manager tests
```

**Note:** The project enforces global coverage thresholds. Running individual test files may fail coverage checks. Use `--no-coverage` flag when running test subsets.

### Test Structure
- Tests are located in `src/**/__tests__/` directories
- Jest configuration in `jest.config.js`
- Ad-hoc test files in root (test-*.js) are gitignored
- Uses `@testing-library/react` for component testing
- Mocks for Supabase and pg modules in test setup

## Common Issues and Solutions

### 1. Database Connection Issues

**PostgreSQL connection refused**
```bash
# Check if PostgreSQL is running
# macOS with Homebrew:
brew services list | grep postgresql

# Ubuntu:
sudo systemctl status postgresql

# Start PostgreSQL if not running:
# macOS: brew services start postgresql
# Ubuntu: sudo systemctl start postgresql

# Test connection
psql -U postgres -d table -c "SELECT version();"
```

**SSL/TLS errors with Supabase or managed PostgreSQL**
```env
# For managed providers requiring SSL
PGSSLMODE=require

# For local development
PGSSLMODE=disable
```

### 2. Migration Issues

**Schema not applied**
```bash
# Reapply migrations
npm run db:migrate

# Or manually drop and recreate database:
dropdb table
createdb table
npm run db:migrate
```

### 3. Supabase Realtime Issues

**Connection problems**
- Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`
- Check Supabase dashboard for Realtime service status
- Ensure Realtime is enabled for your Supabase project
- Check browser console for connection errors

### 4. Test Failures

**Coverage threshold errors**
```bash
# Run full test suite (required for coverage checks)
npm test

# Or disable coverage for individual test runs
npm test -- "your-pattern" --no-coverage
```

**Mock/import errors**
- Ensure mocks are defined before imports in test files
- Check `jest.config.js` for module mocks
- See repository memories for common mock patterns

### 5. Environment Variables

**Missing or incorrect variables**
```bash
# Check which variables are loaded
node -e "require('dotenv').config({path: '.env.local'}); console.log(process.env)"

# Ensure .env.local exists and is not .gitignored
ls -la .env.local
```

## Development Tools

### Recommended VS Code Extensions
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **TypeScript and JavaScript Language Features** - Enhanced TS support
- **Jest Runner** - Run tests from editor
- **Tailwind CSS IntelliSense** - Tailwind class completion
- **PostgreSQL** - Database management

### Useful Commands

```bash
# Database management
npm run db:migrate     # Run migrations

# Development
npm run dev            # Start development server
npm run build          # Build for production
npm run start          # Start production server
npm run lint           # Run ESLint

# Testing
npm test               # Run all tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run with coverage report
```

### Directory Structure

```
table/
├── pages/              # Next.js pages and API routes
├── src/
│   ├── components/     # React components
│   ├── contexts/       # React contexts (Theme, etc.)
│   ├── hooks/          # Custom React hooks
│   ├── lib/
│   │   ├── poker/      # Poker game engine
│   │   ├── database/   # Database migrations and helpers
│   │   ├── server/     # Server-side utilities
│   │   └── utils/      # Shared utilities
├── public/             # Static assets
├── styles/             # Global styles and Tailwind
├── docs/               # Documentation and user stories
└── scripts/            # Build and migration scripts
```

## Debugging

### Client-side Debugging
- Use Chrome DevTools or browser developer tools
- React DevTools extension for component inspection
- Source maps enabled in `tsconfig.json` for TypeScript debugging
- Console logging in development mode

### Server-side Debugging
- Use VS Code debugger with Node.js
- Configure `launch.json` for Next.js debugging
- Use `console.log` or `debug` package for logging
- Check server logs in terminal running `npm run dev`

### Database Debugging
- Connect with any PostgreSQL client (psql, DBeaver, TablePlus, pgAdmin, etc.)
- Run SQL directly: `psql -U postgres -d table`
- Check PostgreSQL logs for connection errors
- For Supabase: use SQL Editor in Supabase dashboard

### Supabase Realtime Debugging
- Monitor Realtime connections in Supabase dashboard
- Check browser console for channel subscription status
- Enable Supabase debug mode in client configuration
- Track message flow in Network tab (WebSocket frames)

### Test Debugging
- Run tests with `--verbose` flag for detailed output
- Use `console.log` in test files
- Run single test file: `npm test -- path/to/test.test.ts`
- Use VS Code Jest Runner for breakpoint debugging

## Additional Resources

- **Project Documentation:** `docs/` directory
  - `TECHNICAL_ARCHITECTURE.md` - System architecture overview
  - `API_DOCUMENTATION.md` - API endpoint documentation
  - `GAME_MECHANICS.md` - Poker game rules and logic
  - `LOCAL_DB.md` - Local database setup details
  - `user_stories/` - Feature specifications

- **Database Schema:** `src/lib/database/schema/`
  - `full-schema.sql` - Complete database schema
  - `user-management.sql` - User authentication and RLS
  - `game-access.sql` - Game access control policies

- **External Resources:**
  - [Next.js Documentation](https://nextjs.org/docs)
  - [Supabase Documentation](https://supabase.com/docs)
  - [Supabase Realtime](https://supabase.com/docs/guides/realtime)
  - [PostgreSQL Documentation](https://www.postgresql.org/docs/)
  - [Tailwind CSS](https://tailwindcss.com/docs)
