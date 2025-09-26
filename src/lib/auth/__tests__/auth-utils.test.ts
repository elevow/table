import type { NextApiRequest } from 'next';
import { getAuthToken, getAuthenticatedUserId, requireAuth } from '../auth-utils';
import { Pool } from 'pg';

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    end: jest.fn()
  }))
}));

// Mock console.error to avoid noise in tests
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('auth-utils', () => {
  let mockPool: any;
  let mockClient: any;
  let mockRequest: Partial<NextApiRequest>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConsoleError.mockClear();
    
    // Store original environment variables
    originalEnv = { ...process.env };
    
    // Setup mock client
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    
    // Setup mock pool
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn().mockResolvedValue(undefined)
    };
    
    (Pool as jest.MockedClass<typeof Pool>).mockImplementation(() => mockPool);
    
    // Setup base mock request
    mockRequest = {
      headers: {},
      cookies: {}
    };
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  describe('getAuthToken', () => {
    it('should extract token from Authorization header', () => {
      mockRequest.headers = {
        authorization: 'Bearer test-token-123'
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe('test-token-123');
    });

    it('should return null for Authorization header without Bearer prefix', () => {
      mockRequest.headers = {
        authorization: 'Basic dGVzdA=='
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe(null);
    });

    it('should extract token from session_token cookie when no auth header', () => {
      mockRequest.headers = {};
      mockRequest.cookies = {
        session_token: 'cookie-session-token'
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe('cookie-session-token');
    });

    it('should extract token from auth_token cookie when no auth header or session_token', () => {
      mockRequest.headers = {};
      mockRequest.cookies = {
        auth_token: 'cookie-auth-token'
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe('cookie-auth-token');
    });

    it('should prefer session_token over auth_token cookie', () => {
      mockRequest.headers = {};
      mockRequest.cookies = {
        session_token: 'session-token',
        auth_token: 'auth-token'
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe('session-token');
    });

    it('should prefer Authorization header over cookies', () => {
      mockRequest.headers = {
        authorization: 'Bearer header-token'
      };
      mockRequest.cookies = {
        session_token: 'cookie-token'
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe('header-token');
    });

    it('should return null when no token found', () => {
      mockRequest.headers = {};
      mockRequest.cookies = {};
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe(null);
    });

    it('should handle malformed Authorization header', () => {
      mockRequest.headers = {
        authorization: 'Bearer'
      };
      
      const token = getAuthToken(mockRequest as NextApiRequest);
      expect(token).toBe(null);
    });
  });

  describe('getAuthenticatedUserId', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return null when no token is found', async () => {
      mockRequest.headers = {};
      mockRequest.cookies = {};
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      expect(userId).toBe(null);
    });

    it('should return null when token is "null" string', async () => {
      mockRequest.headers = {
        authorization: 'Bearer null'
      };
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      expect(userId).toBe(null);
    });

    it('should return user ID for valid token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token'
      };
      
      mockClient.query.mockResolvedValue({
        rows: [{ user_id: 'user-123' }]
      });
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(userId).toBe('user-123');
      expect(mockClient.query).toHaveBeenCalledWith(
        `SELECT user_id FROM auth_tokens 
         WHERE token_hash = $1 AND type = 'session' AND expires_at > NOW()`,
        ['valid-token']
      );
      expect(mockClient.release).toHaveBeenCalled();
      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should return null for expired or invalid token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer expired-token'
      };
      
      mockClient.query.mockResolvedValue({
        rows: []
      });
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(userId).toBe(null);
      expect(mockClient.release).toHaveBeenCalled();
      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should use POOL_DATABASE_URL when available', async () => {
      Object.assign(process.env, {
        NODE_ENV: 'development',
        POOL_DATABASE_URL: 'postgresql://pool:pass@localhost:5432/pool',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test'
      });
      
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      mockClient.query.mockResolvedValue({ rows: [] });
      
      await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(Pool).toHaveBeenCalledWith({
        connectionString: 'postgresql://pool:pass@localhost:5432/pool',
        ssl: false
      });
    });

    it('should modify SSL settings for development environment', async () => {
      Object.assign(process.env, {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test?sslmode=require'
      });
      
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      mockClient.query.mockResolvedValue({ rows: [] });
      
      await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(Pool).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@localhost:5432/test?sslmode=disable',
        ssl: false
      });
    });

    it('should use production SSL settings for non-development environment', async () => {
      Object.assign(process.env, {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test'
      });
      
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      mockClient.query.mockResolvedValue({ rows: [] });
      
      await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(Pool).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@localhost:5432/test',
        ssl: undefined
      });
    });

    it('should handle database connection errors', async () => {
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      const dbError = new Error('Database connection failed');
      mockPool.connect.mockRejectedValue(dbError);
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(userId).toBe(null);
      expect(mockConsoleError).toHaveBeenCalledWith('Error getting authenticated user ID:', dbError);
    });

    it('should handle database query errors', async () => {
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      const queryError = new Error('Query failed');
      mockClient.query.mockRejectedValue(queryError);
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(userId).toBe(null);
      expect(mockClient.release).toHaveBeenCalled();
      expect(mockPool.end).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalledWith('Error getting authenticated user ID:', queryError);
    });

    it('should always release client and end pool even on errors', async () => {
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      mockClient.query.mockRejectedValue(new Error('Query failed'));
      
      await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(mockClient.release).toHaveBeenCalled();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe('requireAuth', () => {
    it('should return user ID when authentication succeeds', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token'
      };
      
      mockClient.query.mockResolvedValue({
        rows: [{ user_id: 'user-456' }]
      });
      
      const userId = await requireAuth(mockRequest as NextApiRequest);
      
      expect(userId).toBe('user-456');
    });

    it('should throw error when no token is provided', async () => {
      mockRequest.headers = {};
      mockRequest.cookies = {};
      
      await expect(requireAuth(mockRequest as NextApiRequest))
        .rejects
        .toThrow('Authentication required');
    });

    it('should throw error when token is invalid', async () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid-token'
      };
      
      mockClient.query.mockResolvedValue({
        rows: []
      });
      
      await expect(requireAuth(mockRequest as NextApiRequest))
        .rejects
        .toThrow('Authentication required');
    });

    it('should throw error when database error occurs', async () => {
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      mockPool.connect.mockRejectedValue(new Error('Database connection failed'));
      
      await expect(requireAuth(mockRequest as NextApiRequest))
        .rejects
        .toThrow('Authentication required');
    });
  });

  describe('Edge cases and integration', () => {
    it('should handle undefined cookies object', () => {
      const requestWithoutCookies = {
        headers: {},
        cookies: undefined
      } as any;
      
      const token = getAuthToken(requestWithoutCookies);
      expect(token).toBe(null);
    });

    it('should handle undefined headers object', () => {
      const requestWithoutHeaders = {
        headers: undefined,
        cookies: { session_token: 'test' }
      } as any;
      
      const token = getAuthToken(requestWithoutHeaders);
      expect(token).toBe('test');
    });

    it('should handle empty environment variables', async () => {
      Object.assign(process.env, {
        DATABASE_URL: undefined,
        POOL_DATABASE_URL: undefined,
        NODE_ENV: undefined
      });
      
      mockRequest.headers = {
        authorization: 'Bearer test-token'
      };
      
      mockClient.query.mockResolvedValue({ rows: [] });
      
      const userId = await getAuthenticatedUserId(mockRequest as NextApiRequest);
      
      expect(userId).toBe(null);
      expect(Pool).toHaveBeenCalledWith({
        connectionString: undefined,
        ssl: undefined
      });
    });

    it('should work with cookies from getAuthToken through the full flow', async () => {
      mockRequest.headers = {};
      mockRequest.cookies = {
        auth_token: 'cookie-token-123'
      };
      
      mockClient.query.mockResolvedValue({
        rows: [{ user_id: 'cookie-user-789' }]
      });
      
      const userId = await requireAuth(mockRequest as NextApiRequest);
      
      expect(userId).toBe('cookie-user-789');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.any(String),
        ['cookie-token-123']
      );
    });
  });
});