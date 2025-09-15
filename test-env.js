// Test environment variable loading
const { config } = require('dotenv');
const { join } = require('path');

console.log('=== Environment Variable Test ===');
console.log('Current working directory:', process.cwd());

// Load .env.local
const result = config({ path: join(process.cwd(), '.env.local') });
console.log('dotenv result:', result);

console.log('POOL_DATABASE_URL:', process.env.POOL_DATABASE_URL ? 'LOADED' : 'NOT LOADED');
console.log('DIRECT_DATABASE_URL:', process.env.DIRECT_DATABASE_URL ? 'LOADED' : 'NOT LOADED');

if (process.env.POOL_DATABASE_URL) {
  console.log('POOL_DATABASE_URL preview:', process.env.POOL_DATABASE_URL.substring(0, 50) + '...');
}
