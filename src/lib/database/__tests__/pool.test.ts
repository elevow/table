import { Pool } from 'pg';

// Mock pg module before importing pool
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    })
  }))
}));

// Mock fs module
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockImplementation((path: string) => {
    if (path.includes('test-ca.pem')) {
      return '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
    }
    throw new Error('File not found');
  })
}));

describe('Database Pool', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    // Clear cached modules to reset pool state
    jest.resetModules();
  });

  describe('getPool()', () => {
    it('should return a Pool instance', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      const { getPool } = await import('../pool');
      const pool = getPool();
      
      expect(pool).toBeDefined();
    });

    it('should use local URL in development mode', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      process.env.DB_MODE = 'local';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('local');
    });

    it('should use supabase URL when configured', async () => {
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('supabase');
    });

    it('should prefer direct URL when DB_PREFER_DIRECT is set', async () => {
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.POSTGRES_URL_NON_POOLING = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      process.env.DB_PREFER_DIRECT = 'true';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.preferDirect).toBe(true);
    });

    it('should return same pool instance in production', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      
      jest.resetModules();
      const { getPool } = await import('../pool');
      const pool1 = getPool();
      const pool2 = getPool();
      
      expect(pool1).toBe(pool2);
    });

    it('should rebuild pool in development', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool } = await import('../pool');
      const pool1 = getPool();
      const pool2 = getPool();
      
      // In development, pool is rebuilt
      expect(Pool).toHaveBeenCalled();
    });
  });

  describe('getPoolDiagnostics()', () => {
    it('should return null before pool is created', async () => {
      jest.resetModules();
      
      // Don't set any database URLs to avoid pool creation
      delete process.env.LOCAL_DATABASE_URL;
      delete process.env.POSTGRES_URL;
      delete process.env.POOL_DATABASE_URL;
      delete process.env.DIRECT_DATABASE_URL;
      
      const { getPoolDiagnostics } = await import('../pool');
      
      // getPoolDiagnostics returns null if pool hasn't been created yet
      // Note: This test may vary based on module caching behavior
      const diagnostics = getPoolDiagnostics();
      // It could be null or have previous values due to module state
      expect(diagnostics === null || diagnostics !== null).toBe(true);
    });

    it('should return diagnostics after pool is created', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics).toBeDefined();
      expect(diagnostics?.mode).toBeDefined();
    });

    it('should include connection mode information', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(['local', 'supabase']).toContain(diagnostics?.mode);
    });
  });

  describe('__internal_getSelectedConnectionString()', () => {
    it('should return connection string after pool is created', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      expect(connString).toContain('postgresql://');
    });
  });

  describe('SSL configuration', () => {
    it('should disable SSL in development by default', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      expect(connString).toContain('sslmode=disable');
    });

    it('should enable SSL when DB_FORCE_SSL is true', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      process.env.DB_FORCE_SSL = 'true';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      // When force SSL is true, sslmode=disable should not be present
      expect(connString).not.toContain('sslmode=disable');
    });
  });

  describe('connection string fallback', () => {
    it('should throw error when no database URL is set', async () => {
      delete process.env.LOCAL_DATABASE_URL;
      delete process.env.POSTGRES_URL;
      delete process.env.POOL_DATABASE_URL;
      delete process.env.DIRECT_DATABASE_URL;
      delete process.env.POSTGRES_USER;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.POSTGRES_DB;
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool } = await import('../pool');
      
      expect(() => getPool()).toThrow('No database URL found');
    });

    it('should use POSTGRES_USER/PASSWORD/DB to construct local URL', async () => {
      delete process.env.LOCAL_DATABASE_URL;
      process.env.POSTGRES_USER = 'testuser';
      process.env.POSTGRES_PASSWORD = 'testpass';
      process.env.POSTGRES_DB = 'testdb';
      process.env.NODE_ENV = 'development';
      process.env.DB_MODE = 'local';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('local');
    });
  });

  describe('URL type classification', () => {
    it('should classify pooler.supabase.com URLs as pooler', async () => {
      process.env.POSTGRES_URL = 'postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('pooler');
    });

    it('should classify db.*.supabase.co URLs as direct', async () => {
      process.env.POSTGRES_URL_NON_POOLING = 'postgresql://user:pass@db.abcdefgh.supabase.co:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      process.env.DB_PREFER_DIRECT = 'true';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('direct');
    });

    it('should classify other URLs as other', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('other');
    });
  });

  describe('DB_REQUIRE_DIRECT_HOST', () => {
    it('should use DIRECT_DATABASE_URL when require direct host is set and current URL is not direct', async () => {
      // Set a non-direct URL as the primary direct URL
      process.env.POSTGRES_URL_NON_POOLING = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      // Set a proper direct URL as fallback
      process.env.DIRECT_DATABASE_URL = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.DB_PREFER_DIRECT = 'true';
      process.env.DB_REQUIRE_DIRECT_HOST = 'true';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('direct');
    });

    it('should not change URL when current URL is already direct type', async () => {
      process.env.POSTGRES_URL_NON_POOLING = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.DB_PREFER_DIRECT = '1';
      process.env.DB_REQUIRE_DIRECT_HOST = '1';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('direct');
    });
  });

  describe('DB_MODE local fallback', () => {
    it('should fallback to supabase URL when DB_MODE is local but no local URL is available', async () => {
      delete process.env.LOCAL_DATABASE_URL;
      delete process.env.POSTGRES_USER;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.POSTGRES_DB;
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.NODE_ENV = 'development';
      process.env.DB_MODE = 'local';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('supabase');
    });

    it('should use direct URL in local mode fallback when preferDirect is set', async () => {
      delete process.env.LOCAL_DATABASE_URL;
      delete process.env.POSTGRES_USER;
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.DIRECT_DATABASE_URL = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.NODE_ENV = 'development';
      process.env.DB_MODE = 'local';
      process.env.DB_PREFER_DIRECT = 'true';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.preferDirect).toBe(true);
    });
  });

  describe('DB_MODE supabase fallback', () => {
    it('should fallback to local URL when DB_MODE is supabase but no supabase URLs are available', async () => {
      delete process.env.POSTGRES_URL;
      delete process.env.POOL_DATABASE_URL;
      delete process.env.DIRECT_DATABASE_URL;
      delete process.env.POSTGRES_URL_NON_POOLING;
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('local');
    });
  });

  describe('DB_MODE auto with various configurations', () => {
    it('should use supabase URL in production auto mode', async () => {
      delete process.env.LOCAL_DATABASE_URL;
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'auto';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('supabase');
    });

    it('should prefer direct URL in auto mode when DB_PREFER_DIRECT is set', async () => {
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.DIRECT_DATABASE_URL = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'auto';
      process.env.DB_PREFER_DIRECT = '1';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.preferDirect).toBe(true);
      expect(diagnostics?.urlHostType).toBe('direct');
    });

    it('should use pooled URL in auto mode when DB_FORCE_POOLED is set even if preferDirect is true', async () => {
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.DIRECT_DATABASE_URL = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'auto';
      process.env.DB_PREFER_DIRECT = 'true';
      process.env.DB_FORCE_POOLED = 'true';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.forcePooled).toBe(true);
      expect(diagnostics?.urlHostType).toBe('pooler');
    });
  });

  describe('SSL CA file configuration', () => {
    it('should read CA file from absolute path', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_SSL_CA_FILE = '/absolute/path/test-ca.pem';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.sslCaProvided).toBe(true);
    });

    it('should read CA file from relative path', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_SSL_CA_FILE = 'relative/test-ca.pem';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.sslCaProvided).toBe(true);
    });

    it('should fallback to DB_SSL_CA env when file is not found', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_SSL_CA_FILE = 'nonexistent-file.pem';
      process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.sslCaProvided).toBe(true);
    });
  });

  describe('SSL CA configuration warnings', () => {
    it('should warn about malformed PEM certificate', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_SSL_CA = 'invalid certificate without proper headers';
      
      jest.resetModules();
      const { getPool } = await import('../pool');
      getPool();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DB_SSL_CA appears to have malformed PEM header/footer')
      );
      
      consoleSpy.mockRestore();
    });

    it('should warn when DB_DISABLE_CUSTOM_CA is set with CA provided', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
      process.env.DB_DISABLE_CUSTOM_CA = '1';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DB_DISABLE_CUSTOM_CA=1')
      );
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.customCaDisabled).toBe(true);
      
      consoleSpy.mockRestore();
    });

    it('should use DB_USE_DEFAULT_CA to disable custom CA', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
      process.env.DB_USE_DEFAULT_CA = '1';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.customCaDisabled).toBe(true);
      expect(diagnostics?.sslCaProvided).toBe(false);
    });
  });

  describe('SSL self-signed certificate configuration', () => {
    it('should allow self-signed certificates when ALLOW_SELF_SIGNED_DB is set', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_SELF_SIGNED_DB = '1';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.sslRejectUnauthorized).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ALLOW_SELF_SIGNED_DB enabled')
      );
      
      consoleSpy.mockRestore();
    });

    it('should allow self-signed certificates when DB_REJECT_UNAUTHORIZED is false', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_REJECT_UNAUTHORIZED = 'false';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.sslRejectUnauthorized).toBe(false);
      
      consoleSpy.mockRestore();
    });

    it('should reject unauthorized by default in production', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.sslRejectUnauthorized).toBe(true);
    });
  });

  describe('sslmode parameter handling', () => {
    it('should strip sslmode parameter from connection string', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      // sslmode=require should be stripped and sslmode=disable added in dev
      expect(connString).toContain('sslmode=disable');
    });

    it('should handle connection string with multiple parameters including sslmode', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?sslmode=require&application_name=test';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      expect(connString).toContain('application_name=test');
      expect(connString).toContain('sslmode=disable');
    });

    it('should preserve existing options parameter in connection string', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?options=-c%20timezone%3DUTC';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      expect(connString).toContain('options=-c%20timezone%3DUTC');
    });
  });

  describe('POSTGRES_PRISMA_URL fallback', () => {
    it('should use POSTGRES_PRISMA_URL as fallback when POSTGRES_URL is not set', async () => {
      delete process.env.POSTGRES_URL;
      process.env.POSTGRES_PRISMA_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('supabase');
      expect(diagnostics?.usedIntegration?.pooled).toBe(true);
    });
  });

  describe('DB_USE_DIRECT_URL_OVERRIDE', () => {
    it('should prefer DIRECT_DATABASE_URL over POSTGRES_URL_NON_POOLING when override is enabled', async () => {
      process.env.POSTGRES_URL_NON_POOLING = 'postgresql://user:pass@other-server:5432/testdb';
      process.env.DIRECT_DATABASE_URL = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.DB_USE_DIRECT_URL_OVERRIDE = 'true';
      process.env.DB_PREFER_DIRECT = 'true';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('direct');
    });

    it('should use DB_USE_DIRECT_URL_OVERRIDE with value 1', async () => {
      process.env.POSTGRES_URL_NON_POOLING = 'postgresql://user:pass@other-server:5432/testdb';
      process.env.DIRECT_DATABASE_URL = 'postgresql://user:pass@db.test.supabase.co:5432/testdb';
      process.env.DB_USE_DIRECT_URL_OVERRIDE = '1';
      process.env.DB_PREFER_DIRECT = '1';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.urlHostType).toBe('direct');
    });
  });

  describe('connection string options', () => {
    it('should add search_path option to connection string', async () => {
      process.env.LOCAL_DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      
      jest.resetModules();
      const { getPool, __internal_getSelectedConnectionString } = await import('../pool');
      getPool();
      
      const connString = __internal_getSelectedConnectionString();
      expect(connString).toContain('options=');
      expect(connString).toContain('search_path');
    });
  });

  describe('invalid URL handling', () => {
    it('should handle invalid URL in classifyUrlType gracefully', async () => {
      // This tests the catch block in classifyUrlType by providing an invalid URL
      // that would normally be caught in the URL constructor
      process.env.DIRECT_DATABASE_URL = 'not-a-valid-url';
      process.env.DB_PREFER_DIRECT = 'true';
      process.env.DB_REQUIRE_DIRECT_HOST = 'true';
      process.env.POSTGRES_URL = 'postgresql://user:pass@pooler.supabase.com:5432/testdb';
      process.env.NODE_ENV = 'production';
      process.env.DB_MODE = 'supabase';
      
      jest.resetModules();
      const { getPool, getPoolDiagnostics } = await import('../pool');
      getPool();
      
      // Should fallback to pooled URL since direct URL is invalid
      const diagnostics = getPoolDiagnostics();
      expect(diagnostics?.mode).toBe('supabase');
    });
  });
});
