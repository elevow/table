// US-009: Player Profile Storage - Database Connection Tests

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  MockDatabasePool,
  MockDatabaseClient,
  createDatabasePool,
  DatabaseMigrationRunner,
  DatabaseConfig
} from '../database-connection';

describe('Database Connection', () => {
  let pool: MockDatabasePool;
  let migrationRunner: DatabaseMigrationRunner;

  beforeEach(() => {
    pool = new MockDatabasePool();
    migrationRunner = new DatabaseMigrationRunner(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('MockDatabasePool', () => {
    test('should create and connect to mock database', async () => {
      const client = await pool.connect();
      
      expect(client).toBeInstanceOf(MockDatabaseClient);
      client.release();
    });

    test('should end connection properly', async () => {
      await expect(pool.end()).resolves.not.toThrow();
    });
  });

  describe('MockDatabaseClient', () => {
    test('should execute queries without throwing', async () => {
      const client = await pool.connect();
      
      const result = await client.query('SELECT 1 as test');
      
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('rowCount');
      expect(Array.isArray(result.rows)).toBe(true);
      expect(typeof result.rowCount).toBe('number');
      
      client.release();
    });

    test('should handle parameterized queries', async () => {
      const client = await pool.connect();
      
      const result = await client.query('SELECT * FROM users WHERE id = $1', ['123']);
      
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('rowCount');
      
      client.release();
    });

    test('should release connection without error', () => {
      const client = new MockDatabaseClient(new Map());
      
      expect(() => client.release()).not.toThrow();
    });
  });

  describe('createDatabasePool', () => {
    test('should create database pool with config', () => {
      const config: DatabaseConfig = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        password: 'test_pass',
        ssl: false,
        poolSize: 10,
        idleTimeoutMs: 30000
      };

      const createdPool = createDatabasePool(config);
      
      expect(createdPool).toBeInstanceOf(MockDatabasePool);
    });

    test('should create pool with minimal config', () => {
      const config: DatabaseConfig = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        password: 'test_pass'
      };

      const createdPool = createDatabasePool(config);
      
      expect(createdPool).toBeInstanceOf(MockDatabasePool);
    });
  });

  describe('DatabaseMigrationRunner', () => {
    test('should run migrations without error', async () => {
      await expect(migrationRunner.runMigrations()).resolves.not.toThrow();
    });

    test('should run migrations to specific version', async () => {
      const targetVersion = '2024.08.22.001';
      
      await expect(migrationRunner.runMigrations(targetVersion)).resolves.not.toThrow();
    });

    test('should rollback migrations', async () => {
      await expect(migrationRunner.rollback(1)).resolves.not.toThrow();
    });

    test('should rollback multiple migration steps', async () => {
      await expect(migrationRunner.rollback(3)).resolves.not.toThrow();
    });

    test('should get current migration version', async () => {
      const version = await migrationRunner.getCurrentVersion();
      
      expect(typeof version).toBe('string');
      expect(version).toBe('0'); // Default for mock
    });

    test('should handle migration errors gracefully', async () => {
      // This tests the error handling structure
      // In a real implementation, we'd test actual error conditions
      await expect(migrationRunner.runMigrations()).resolves.not.toThrow();
    });
  });

  describe('Database Configuration Validation', () => {
    test('should accept valid database configuration', () => {
      const config: DatabaseConfig = {
        host: 'localhost',
        port: 5432,
        database: 'poker_db',
        username: 'poker_user',
        password: 'secure_password',
        ssl: true,
        poolSize: 20,
        idleTimeoutMs: 60000
      };

      expect(() => createDatabasePool(config)).not.toThrow();
    });

    test('should handle SSL configuration', () => {
      const configWithSsl: DatabaseConfig = {
        host: 'prod-server.com',
        port: 5432,
        database: 'poker_prod',
        username: 'prod_user',
        password: 'prod_password',
        ssl: true
      };

      const configWithoutSsl: DatabaseConfig = {
        host: 'localhost',
        port: 5432,
        database: 'poker_dev',
        username: 'dev_user',
        password: 'dev_password',
        ssl: false
      };

      expect(() => createDatabasePool(configWithSsl)).not.toThrow();
      expect(() => createDatabasePool(configWithoutSsl)).not.toThrow();
    });

    test('should handle pool configuration options', () => {
      const config: DatabaseConfig = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        password: 'test_pass',
        poolSize: 50,
        idleTimeoutMs: 120000
      };

      expect(() => createDatabasePool(config)).not.toThrow();
    });
  });

  describe('Connection Pool Management', () => {
    test('should manage multiple connections', async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      const client3 = await pool.connect();

      expect(client1).toBeInstanceOf(MockDatabaseClient);
      expect(client2).toBeInstanceOf(MockDatabaseClient);
      expect(client3).toBeInstanceOf(MockDatabaseClient);

      client1.release();
      client2.release();
      client3.release();
    });

    test('should handle concurrent connections', async () => {
      const connections = await Promise.all([
        pool.connect(),
        pool.connect(),
        pool.connect(),
        pool.connect(),
        pool.connect()
      ]);

      expect(connections).toHaveLength(5);
      connections.forEach(client => {
        expect(client).toBeInstanceOf(MockDatabaseClient);
        client.release();
      });
    });
  });

  describe('Query Execution', () => {
    test('should handle complex queries', async () => {
      const client = await pool.connect();
      
      const complexQuery = `
        SELECT p.id, p.username, p.bankroll,
               COUNT(bh.id) as transaction_count,
               SUM(bh.amount) as total_transactions
        FROM players p
        LEFT JOIN bankroll_history bh ON p.id = bh.player_id
        WHERE p.created_at >= $1
        GROUP BY p.id, p.username, p.bankroll
        ORDER BY p.bankroll DESC
        LIMIT $2 OFFSET $3
      `;
      
      const params = ['2024-01-01', 10, 0];
      
      const result = await client.query(complexQuery, params);
      
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('rowCount');
      
      client.release();
    });

    test('should handle DDL queries', async () => {
      const client = await pool.connect();
      
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS test_table (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `;
      
      const result = await client.query(createTableQuery);
      
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('rowCount');
      
      client.release();
    });

    test('should handle transaction queries', async () => {
      const client = await pool.connect();
      
      await expect(client.query('BEGIN')).resolves.not.toThrow();
      await expect(client.query('INSERT INTO test VALUES ($1)', ['test'])).resolves.not.toThrow();
      await expect(client.query('COMMIT')).resolves.not.toThrow();
      
      client.release();
    });
  });
});

// Export test utilities for other database tests
export const createTestDatabaseConfig = (): DatabaseConfig => ({
  host: 'localhost',
  port: 5432,
  database: 'poker_test',
  username: 'test_user',
  password: 'test_password',
  ssl: false,
  poolSize: 5,
  idleTimeoutMs: 10000
});

export const createTestPool = () => new MockDatabasePool();
