Local Database Development
===========================

This project uses Supabase as the primary database solution for both development and production.

## Development Setup

### Using Supabase (Recommended)

1) Set up your Supabase project at https://supabase.com

2) Configure your environment variables in `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   POOL_DATABASE_URL=your_supabase_connection_string
   DIRECT_DATABASE_URL=your_supabase_direct_connection_string
   ```

3) Apply database migrations:

   ```bash
   npm run db:migrate
   ```

### Using Local PostgreSQL (Alternative)

If you prefer to run a local PostgreSQL instance without Supabase:

1) Install PostgreSQL on your system
   - macOS: `brew install postgresql`
   - Ubuntu: `sudo apt-get install postgresql`
   - Windows: Download from https://www.postgresql.org/download/

2) Create a database:

   ```bash
   createdb table
   ```

3) Configure your environment variables in `.env.local`:

   ```
   LOCAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/table
   POOL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/table
   DIRECT_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/table
   ```

4) Apply database migrations:

   ```bash
   npm run db:migrate
   ```

## Database Migrations

The `db:migrate` script will automatically apply:
- Application schema files from `src/lib/database/schema/`
- Manual migrations from `migration-manual.sql` (if present)
- Additional SQL files from `scripts/*.sql`

## Connection Management

The application uses connection pooling in production and can run with or without SSL:
- Production: SSL is enabled by default
- Development: SSL is disabled by default for easier local development
- Override: Set `DB_FORCE_SSL=true` to force SSL in any environment
