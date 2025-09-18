import { jest } from '@jest/globals';
import { SessionManager } from '../session-manager';
import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
jest.mock('crypto');
jest.mock('uuid');
jest.mock('pg');

const mockCrypto = crypto as jest.Mocked<typeof crypto>;
const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock pool and client
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    
    mockPool = {
      connect: jest.fn(),
      query: jest.fn(), // Some methods use pool.query directly
    };
    
    // Set up the connect mock separately to avoid type issues
    mockPool.connect.mockResolvedValue(mockClient);
    
    sessionManager = new SessionManager(mockPool);
    
    // Setup crypto mocks
    (mockCrypto.randomBytes as any) = jest.fn().mockReturnValue(Buffer.from('mockedrandomdata'));
    (mockCrypto.createHash as any) = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mockedigest'),
    });
    
    // Setup uuid mock
    (mockUuidv4 as any).mockReturnValue('mocked-uuid-123');
  });

  test('should be instantiated correctly', () => {
    expect(sessionManager).toBeInstanceOf(SessionManager);
  });

  describe('createSession', () => {
    test('should create a session successfully', async () => {
      const mockSession = {
        id: 'mocked-uuid-123',
        userId: 'user-123',
        token: 'mockedigest',
        expiresAt: new Date(),
        createdAt: new Date(),
        lastAccessed: new Date(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        isActive: true
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // cleanup expired sessions
        .mockResolvedValueOnce({}) // INSERT session
        .mockResolvedValueOnce({}); // COMMIT

      const result = await sessionManager.createSession('user-123', '192.168.1.1', 'Mozilla/5.0');

      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('token');
      expect(result.token).toBe('6d6f636b656472616e646f6d64617461'); // hex encoded
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should handle database errors and rollback', async () => {
      const error = new Error('Database connection failed');
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(error); // fails on cleanup

      await expect(
        sessionManager.createSession('user-123', '192.168.1.1', 'Mozilla/5.0')
      ).rejects.toThrow('Database connection failed');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should create session with custom expiration', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // cleanup expired sessions
        .mockResolvedValueOnce({}) // INSERT session
        .mockResolvedValueOnce({}); // COMMIT

      await sessionManager.createSession('user-123', '192.168.1.1', 'Mozilla/5.0', 24);

      // Verify the expiration was set correctly in the INSERT call
      const insertCall = mockClient.query.mock.calls[2];
      expect(insertCall[0]).toContain('INSERT INTO auth_tokens');
      expect(insertCall[1][3]).toBeInstanceOf(Date); // expiresAt parameter
    });
  });

  describe('validateSession', () => {
    test('should validate a valid session', async () => {
      const mockValidSession = {
        id: 'session-123',
        user_id: 'user-123',
        token_hash: 'mockedigest',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        created_at: new Date(),
        last_accessed: new Date(),
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        is_active: true,
        type: 'session',
        email: 'test@example.com',
        username: 'testuser',
        is_verified: true
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [mockValidSession] }) // SELECT query with JOIN
        .mockResolvedValueOnce({}); // UPDATE expires_at

      const result = await sessionManager.validateSession('raw-token', '192.168.1.1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('session-123');
      expect(result?.userId).toBe('user-123');
      expect(result?.ipAddress).toBe('192.168.1.1');
      expect(result?.userAgent).toBe('unknown');
      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should return null for non-existent session', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const result = await sessionManager.validateSession('invalid-token');

      expect(result).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('should validate session and use default IP when not provided', async () => {
      const mockValidSession = {
        id: 'session-123',
        user_id: 'user-123',
        token_hash: 'mockedigest',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        created_at: new Date(),
        email: 'test@example.com',
        username: 'testuser',
        is_verified: true
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [mockValidSession] })
        .mockResolvedValueOnce({});

      const result = await sessionManager.validateSession('raw-token');

      expect(result).toBeDefined();
      expect(result?.ipAddress).toBe('unknown');
    });
  });

  describe('revokeSession', () => {
    test('should revoke a session successfully', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await sessionManager.revokeSession('raw-token');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        "DELETE FROM auth_tokens WHERE token_hash = $1 AND type = 'session'",
        ['mockedigest']
      );
    });

    test('should return false when session does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await sessionManager.revokeSession('invalid-token');

      expect(result).toBe(false);
    });
  });

  describe('revokeAllUserSessions', () => {
    test('should revoke all sessions for a user', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 3 });

      const result = await sessionManager.revokeAllUserSessions('user-123');

      expect(result).toBe(3);
      expect(mockPool.query).toHaveBeenCalledWith(
        "DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'session'",
        ['user-123']
      );
    });

    test('should return 0 when user has no sessions', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await sessionManager.revokeAllUserSessions('user-999');

      expect(result).toBe(0);
    });
  });

  describe('getUserSessions', () => {
    test('should retrieve user sessions successfully', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          user_id: 'user-123',
          token_hash: 'hash1',
          expires_at: new Date(),
          created_at: new Date(),
          last_accessed: new Date(),
          ip_address: '192.168.1.1',
          user_agent: 'Chrome',
          is_active: true,
          type: 'session'
        },
        {
          id: 'session-2',
          user_id: 'user-123',
          token_hash: 'hash2',
          expires_at: new Date(),
          created_at: new Date(),
          last_accessed: new Date(),
          ip_address: '192.168.1.2',
          user_agent: 'Firefox',
          is_active: true,
          type: 'session'
        }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockSessions });

      const result = await sessionManager.getUserSessions('user-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-1');
      expect(result[1].id).toBe('session-2');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM auth_tokens'),
        ['user-123']
      );
    });

    test('should return empty array when user has no sessions', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await sessionManager.getUserSessions('user-999');

      expect(result).toEqual([]);
    });
  });

  describe('cleanupExpiredSessions', () => {
    test('should cleanup expired sessions successfully', async () => {
      // When cleanupExpiredSessions is called without external client, it uses this.pool
      mockPool.query.mockResolvedValueOnce({ rowCount: 5 });

      const result = await sessionManager.cleanupExpiredSessions();

      expect(result).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        "DELETE FROM auth_tokens WHERE type = 'session' AND expires_at <= NOW()",
        []
      );
    });

    test('should cleanup expired sessions for specific user', async () => {
      const mockExternalClient: any = { 
        query: jest.fn()
      };
      mockExternalClient.query.mockResolvedValue({ rowCount: 2 });
      
      const result = await sessionManager.cleanupExpiredSessions('user-123', mockExternalClient);

      expect(result).toBe(2);
      expect(mockExternalClient.query).toHaveBeenCalledWith(
        "DELETE FROM auth_tokens WHERE type = 'session' AND expires_at <= NOW() AND user_id = $1",
        ['user-123']
      );
    });

    test('should return 0 when no expired sessions exist', async () => {
      // When cleanupExpiredSessions is called without external client, it uses this.pool
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await sessionManager.cleanupExpiredSessions();

      expect(result).toBe(0);
    });
  });

  describe('performSessionCleanup', () => {
    test('should perform comprehensive session cleanup', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 3 }) // expired sessions
        .mockResolvedValueOnce({ rowCount: 2 }) // idle sessions
        .mockResolvedValueOnce({ rowCount: 1 }); // old sessions

      const result = await sessionManager.performSessionCleanup({
        cleanupExpired: true,
        maxIdleTime: 72 * 60 * 60 * 1000, // 72 hours in milliseconds
        maxSessionAge: 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds  
      });

      expect(result).toEqual({
        expiredRemoved: 3,
        idleRemoved: 2,
        oldRemoved: 1
      });
    });

    test('should skip cleanup types when disabled', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 3 }); // only expired

      const result = await sessionManager.performSessionCleanup({
        cleanupExpired: true
      });

      expect(result).toEqual({
        expiredRemoved: 3,
        idleRemoved: 0,
        oldRemoved: 0
      });
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('private methods', () => {
    test('should generate secure tokens using crypto', () => {
      const token = (sessionManager as any).generateSecureToken();
      
      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
      expect(token).toBe('6d6f636b656472616e646f6d64617461'); // hex encoded
    });

    test('should hash tokens using SHA-256', () => {
      const mockHashInstance = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hashedigest'),
      };
      mockCrypto.createHash.mockReturnValue(mockHashInstance as any);

      const hashedToken = (sessionManager as any).hashToken('raw-token');

      expect(mockCrypto.createHash).toHaveBeenCalledWith('sha256');
      expect(mockHashInstance.update).toHaveBeenCalledWith('raw-token');
      expect(mockHashInstance.digest).toHaveBeenCalledWith('hex');
      expect(hashedToken).toBe('hashedigest');
    });
  });
});