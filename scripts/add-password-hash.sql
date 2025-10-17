-- Add password_hash column to users table for secure password storage
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Helpful partial index for lookups only when password-based auth is used
CREATE INDEX IF NOT EXISTS idx_users_email_password
  ON public.users(email)
  WHERE password_hash IS NOT NULL;

-- Optional documentation comment
COMMENT ON COLUMN public.users.password_hash IS 'bcrypt hashed password for email/password authentication';
