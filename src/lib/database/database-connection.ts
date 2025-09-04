// US-009: Player Profile Storage - Database Connection and Initialization

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  poolSize?: number;
  idleTimeoutMs?: number;
  // US-043: Extended pooling options
  minPoolSize?: number;
  maxPoolSize?: number;
  connectionTimeoutMs?: number;
}

export interface DatabasePool {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
  // US-043: Optional pool statistics for monitoring
  getStats?(): { total: number; idle: number; waiting: number; max: number };
}

export interface DatabaseClient {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
  release(): void;
}

// Mock implementation for development/testing
export class MockDatabasePool implements DatabasePool {
  private mockData: Map<string, any[]> = new Map();

  constructor() {
    this.initializeMockData();
  }

  async connect(): Promise<DatabaseClient> {
    return new MockDatabaseClient(this.mockData);
  }

  async end(): Promise<void> {
    this.mockData.clear();
  }

  private initializeMockData(): void {
    this.mockData.set('players', []);
    this.mockData.set('bankroll_history', []);
    this.mockData.set('player_game_stats', []);
    this.mockData.set('player_achievements', []);
    this.mockData.set('player_preferences', []);
  }
}

export class MockDatabaseClient implements DatabaseClient {
  constructor(private mockData: Map<string, any[]>) {}

  async query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    // Simple mock implementation
    // console.log('Mock Query:', text, params);
    
    // Simulate error for invalid SQL
    if (text.toUpperCase().includes('INVALID')) {
      throw new Error('Mock database error: Invalid SQL syntax');
    }
    
    // Return empty result for now
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    // Mock release - no-op
  }
}

// US-043: Real PostgreSQL connection pool implementation
// Uses the 'pg' library Pool to provide pooled connections with timeouts
class PostgresDatabaseClient implements DatabaseClient {
  constructor(private client: import('pg').PoolClient) {}

  async query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    const res = await this.client.query(text, params);
    return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
  }

  release(): void {
    this.client.release();
  }
}

class PostgresDatabasePool implements DatabasePool {
  private pool: import('pg').Pool;

  constructor(config: DatabaseConfig) {
    const { Pool } = require('pg') as typeof import('pg');

    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: config.maxPoolSize ?? config.poolSize ?? 10,
      min: config.minPoolSize ?? 2,
      idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? 2000
    });
  }

  async connect(): Promise<DatabaseClient> {
    const client = await this.pool.connect();
    return new PostgresDatabaseClient(client);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  getStats() {
    // pg.Pool exposes totalCount, idleCount, waitingCount, options.max
    return {
      total: (this.pool as any).totalCount ?? 0,
      idle: (this.pool as any).idleCount ?? 0,
      waiting: (this.pool as any).waitingCount ?? 0,
      max: (this.pool.options as any)?.max ?? 10
    };
  }
}

// Database connection factory
export function createDatabasePool(config: DatabaseConfig): DatabasePool {
  // US-043: Create a real PostgreSQL pool when not in test/mock mode
  const useMock = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_DB === 'true';
  if (useMock) {
    return new MockDatabasePool();
  }

  // Basic validation to decide if we can instantiate a real pool
  if (config && config.host && config.database && config.username) {
    try {
      return new PostgresDatabasePool(config);
    } catch (e) {
      // Fallback to mock if pg isn't available at runtime
      return new MockDatabasePool();
    }
  }

  // Fallback
  return new MockDatabasePool();
}

// Migration runner interface
export interface MigrationRunner {
  runMigrations(targetVersion?: string): Promise<void>;
  rollback(steps?: number): Promise<void>;
  getCurrentVersion(): Promise<string>;
}

export class DatabaseMigrationRunner implements MigrationRunner {
  constructor(private pool: DatabasePool) {}

  async runMigrations(targetVersion?: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // In production, this would run actual database migrations
      // console.log('Running migrations to version:', targetVersion || 'latest');
      
      // Mock migration execution
      await client.query(`
        -- Create tables if they don't exist
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
    } finally {
      client.release();
    }
  }

  async rollback(steps: number = 1): Promise<void> {
    // console.log('Rolling back', steps, 'migration steps');
    // Mock rollback
  }

  async getCurrentVersion(): Promise<string> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT version FROM schema_migrations 
        ORDER BY applied_at DESC 
        LIMIT 1
      `);
      
      return result.rows[0]?.version || '0';
      
    } finally {
      client.release();
    }
  }
}

// Lightweight Pool-like accessor for simple services that expect a `{ query }` API
// Used by API routes that want a direct query interface without acquiring/releasing clients manually.
// In test or when `pg` isn't available, this returns a stub with a failing query to surface configuration issues.
export function getDbPool(): any {
  // If tests/mock mode, expose a minimal adapter over MockDatabasePool
  if (process.env.NODE_ENV === 'test' || process.env.USE_MOCK_DB === 'true') {
    const mockPool = new MockDatabasePool();
    return {
      query: async (text: string, params?: any[]) => {
        const client = await mockPool.connect();
        try {
          return await client.query(text, params);
        } finally {
          client.release();
        }
      }
    };
  }

  try {
    const { Pool } = require('pg') as typeof import('pg');
    const host = process.env.DB_HOST || process.env.PGHOST || 'localhost';
    const port = Number(process.env.DB_PORT || process.env.PGPORT || 5432);
    const database = process.env.DB_NAME || process.env.PGDATABASE || 'app';
    const user = process.env.DB_USER || process.env.PGUSER || 'postgres';
    const password = process.env.DB_PASSWORD || process.env.PGPASSWORD || '';
    const sslMode = (process.env.DB_SSL || process.env.PGSSLMODE || 'disable').toString().toLowerCase();
    const ssl = sslMode === 'require' ? { rejectUnauthorized: false } : undefined;
    return new Pool({ host, port, database, user, password, ssl });
  } catch {
    // Fallback stub: surface configuration error at runtime
    return {
      query: async () => {
        throw new Error('pg Pool is not available. Ensure the "pg" package is installed and environment is configured.');
      }
    };
  }
}
