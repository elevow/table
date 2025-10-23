import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth check - you can remove this after running the migration
  const { secret } = req.body;
  if (secret !== 'migrate-admin-role-2024') {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  let pool;
  let client;

  try {
  // Use the shared pool with consistent TLS config
  pool = getPool();
    
    client = await pool.connect();
    console.log('Connected to database');

    try {
      // Check if role column exists
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'role'
      `);

      console.log('Column check result:', columnCheck.rows);

      if (columnCheck.rows.length === 0) {
        console.log('Adding role column to users table...');
        
        // Add role column
        await client.query(`
          ALTER TABLE users 
          ADD COLUMN role VARCHAR(20) DEFAULT 'player'
        `);

        // Add constraint separately (some versions of PostgreSQL have issues with CHECK in ALTER TABLE ADD COLUMN)
        await client.query(`
          ALTER TABLE users 
          ADD CONSTRAINT users_role_check 
          CHECK (role IN ('admin', 'player', 'guest'))
        `);

        console.log('Role column added successfully');
      } else {
        console.log('Role column already exists');
      }

      // Set admin role for elevow@gmail.com
      const updateResult = await client.query(`
        UPDATE users 
        SET role = 'admin' 
        WHERE email = $1
        RETURNING id, email, role
      `, ['elevow@gmail.com']);

      console.log('Update result:', updateResult.rows);

      // Create index
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
      `);

      // Get user count by role for verification
      const roleCount = await client.query(`
        SELECT role, COUNT(*) as count 
        FROM users 
        GROUP BY role
      `);

      console.log('Migration completed successfully!');
      
      return res.status(200).json({ 
        success: true, 
        message: 'Migration completed',
        adminUserUpdated: updateResult.rows.length > 0,
        adminUser: updateResult.rows[0] || null,
        roleCounts: roleCount.rows
      });

    } finally {
      if (client) client.release();
    }

  } catch (error: any) {
    console.error('Migration error:', error);
    return res.status(500).json({ 
      error: 'Migration failed', 
      details: error.message,
      stack: error.stack
    });
  } finally {
    // Do not end the shared pool in API routes
  }
}