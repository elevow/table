-- 047: Close the Supabase public API (PostgREST/GraphQL) to the anon and authenticated roles.
--
-- The NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser bundle. Supabase grants the anon and
-- authenticated roles full privileges on public tables by default, and many tables here had RLS
-- off, so anyone holding that key could read and write them directly: session tokens
-- (auth_tokens), roles (user_roles), saved game state with every hole card and the undealt deck
-- (active_games), and more.
--
-- The app never uses those roles for data: the server connects as postgres (owner, bypasses
-- RLS) and the browser only uses Supabase for Realtime broadcast, which does not touch tables.
-- So both roles lose all table access, and RLS is turned on everywhere as a second barrier.
--
-- Run once, by hand, after the session-token hashing change is deployed (it is not picked up by
-- scripts/db-migrate.js, which re-runs its files on every invocation).

BEGIN;

-- 1. No direct table, sequence or function access through the public API
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Objects created later by postgres stay closed as well
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 2. RLS on every public table (postgres bypasses it, so the app is unaffected)
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- 3. Views run with their creator's rights unless told otherwise; make them respect the caller
ALTER VIEW IF EXISTS public.player_games_redacted SET (security_invoker = true);
ALTER VIEW IF EXISTS public.game_history_summary SET (security_invoker = true);

-- 4. Every stored session token was readable, and anyone could have inserted session or
--    password-reset rows, so none of them can be trusted. Sessions are now stored hashed;
--    everyone signs in again.
DELETE FROM public.auth_tokens WHERE type IN ('session', 'password_reset');

COMMIT;
