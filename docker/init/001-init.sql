-- Initial schema or extensions for local development
-- This script runs automatically on first container start.

-- Example: enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the database schema if you prefer non-default (using POSTGRES_DB by default)
-- You can also seed tables here or call \i to include other SQL files.
