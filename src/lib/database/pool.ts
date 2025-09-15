import { Pool } from 'pg';
import { config } from 'dotenv';
import { join } from 'path';

// Force load environment variables immediately
try {
  config({ path: join(process.cwd(), '.env.local'), override: true });
  config({ override: false }); // fallback to .env
} catch (e) {
  console.error('Failed to load environment variables:', e);
}

let pool: Pool | null = null;

function buildPool(): Pool {
  // Prefer pooled connection for restricted networks, fallback to direct
  let connectionString = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
  
  if (!connectionString) {
    console.error('Database environment check:');
    console.error('POOL_DATABASE_URL:', process.env.POOL_DATABASE_URL ? 'SET' : 'NOT SET');
    console.error('DIRECT_DATABASE_URL:', process.env.DIRECT_DATABASE_URL ? 'SET' : 'NOT SET');
    throw new Error('Neither POOL_DATABASE_URL nor DIRECT_DATABASE_URL environment variable is set');
  }
  
  console.log('NODE_ENV:', process.env.NODE_ENV || 'undefined');
  console.log('Original connection string:', connectionString.replace(/:[^@]*@/, ':****@'));
  
  // In development mode, disable SSL completely to avoid certificate issues
  if (process.env.NODE_ENV !== 'production') {
    // Remove any SSL parameters and add sslmode=disable
    connectionString = connectionString.replace(/[?&]?sslmode=(require|prefer|allow|disable)/g, '');
    connectionString += connectionString.includes('?') ? '&sslmode=disable' : '?sslmode=disable';
    console.log('Development mode: SSL completely disabled');
    console.log('Modified connection string:', connectionString.replace(/:[^@]*@/, ':****@'));
  }
  
  console.log('Final connection string being used:', connectionString.replace(/:[^@]*@/, ':****@'));
  
  // Parse connection string to add SSL configuration
  const config: any = { connectionString };
  
  // For development, explicitly disable SSL in the client config as well
  if (process.env.NODE_ENV !== 'production') {
    config.ssl = false;
    console.log('Development mode: SSL client configuration disabled');
  } else {
    // In production, use proper SSL verification
    config.ssl = { rejectUnauthorized: true };
  }
  
  return new Pool(config);
}

export function getPool(): Pool {
  // Force rebuild pool in development to pick up configuration changes
  if (process.env.NODE_ENV !== 'production') {
    pool = null;
  }
  if (!pool) pool = buildPool();
  return pool;
}