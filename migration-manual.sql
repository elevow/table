-- Manual SQL commands to add role support
-- Run these in your Supabase SQL Editor or psql

-- Step 1: Add role column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'player';

-- Step 2: Add constraint to ensure valid role values (drop first if exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'users_role_check' 
        AND table_name = 'users'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('admin', 'player', 'guest'));
    END IF;
END $$;

-- Step 3: Set admin role for your email
UPDATE users SET role = 'admin' WHERE email = 'elevow@gmail.com';

-- Step 4: Create index for performance
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Step 5: Verify the changes
SELECT email, role FROM users WHERE email = 'elevow@gmail.com';

-- Step 6: Check all users and their roles
SELECT email, role, created_at FROM users ORDER BY created_at DESC;