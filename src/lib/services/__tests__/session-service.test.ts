import { SessionService } from '../session-service';
import { SessionManager } from '../../database/session-manager';
import { Pool } from 'pg';
import {
  CreateSessionRequest,
  RenewSessionRequest,
  UserSessionRecord,
  SessionError
} from '../../../types/session';

// Mock the session manager
jest.mock('../../database/session-manager');

describe('SessionService', () => {
  let sessionService: SessionService;
  let mockPool: jest.Mocked<Pool>;
  let mockSessionManager: jest.Mocked<SessionManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    } as any;

    mockSessionManager = {
      countActiveSessions: jest.fn(),
      createSession: jest.fn(),
      getByToken: jest.fn(),
      touchActivity: jest.fn(),
      renewSession: jest.fn(),
      revokeByToken: jest.fn(),
      revokeAllUserSessions: jest.fn(),
      cleanupExpiredSessions: jest.fn(),
      listActiveSessions: jest.fn(),
    } as any;

    (SessionManager as jest.MockedClass<typeof SessionManager>).mockImplementation(() => mockSessionManager);
  });

  describe('Constructor', () => {
    it('should create an instance with default config', () => {
      sessionService = new SessionService(mockPool);
      expect(sessionService).toBeInstanceOf(SessionService);
      expect(SessionManager).toHaveBeenCalledWith(mockPool);
    });

    it('should create an instance with custom config', () => {
      const config = { maxConcurrentSessions: 10 };
      sessionService = new SessionService(mockPool, config);
      expect(sessionService).toBeInstanceOf(SessionService);
    });

    it('should accept custom manager', () => {
      sessionService = new SessionService(mockPool, {}, mockSessionManager);
      expect(sessionService).toBeInstanceOf(SessionService);
    });
  });

  describe('createSession', () => {
    beforeEach(() => {
      sessionService = new SessionService(mockPool, { maxConcurrentSessions: 3 });
    });

    const validRequest: CreateSessionRequest = {
      userId: 'user123',
      token: 'token123',
      ttlSeconds: 86400, // 24 hours in seconds
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1'
    };

    const expectedSession: UserSessionRecord = {
      id: 'session123',
      userId: 'user123',
      token: 'token123',
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };

    it('should create session when under concurrent limit', async () => {
      mockSessionManager.countActiveSessions.mockResolvedValue(2);
      mockSessionManager.createSession.mockResolvedValue(expectedSession);

      const result = await sessionService.createSession(validRequest);

      expect(mockSessionManager.countActiveSessions).toHaveBeenCalledWith('user123');
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(validRequest);
      expect(result).toEqual(expectedSession);
    });

    it('should throw error when concurrent limit exceeded', async () => {
      mockSessionManager.countActiveSessions.mockResolvedValue(3);

      await expect(sessionService.createSession(validRequest))
        .rejects.toThrow('Too many concurrent sessions');
      
      expect(mockSessionManager.countActiveSessions).toHaveBeenCalledWith('user123');
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('should use default concurrent limit when not specified', async () => {
      sessionService = new SessionService(mockPool); // Default limit is 5
      mockSessionManager.countActiveSessions.mockResolvedValue(6);

      await expect(sessionService.createSession(validRequest))
        .rejects.toThrow('Too many concurrent sessions');
    });
  });

  describe('verifySession', () => {
    beforeEach(() => {
      sessionService = new SessionService(mockPool);
    });

    const validSession: UserSessionRecord = {
      id: 'session123',
      userId: 'user123',
      token: 'token123',
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // Future date
    };

    it('should return session when valid and not expired', async () => {
      mockSessionManager.getByToken.mockResolvedValue(validSession);

      const result = await sessionService.verifySession('token123');

      expect(mockSessionManager.getByToken).toHaveBeenCalledWith('token123');
      expect(result).toEqual(validSession);
    });

    it('should return null when session not found', async () => {
      mockSessionManager.getByToken.mockResolvedValue(null);

      const result = await sessionService.verifySession('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when session is expired', async () => {
      const expiredSession = {
        ...validSession,
        expiresAt: new Date(Date.now() - 1000) // Past date
      };
      mockSessionManager.getByToken.mockResolvedValue(expiredSession);

      const result = await sessionService.verifySession('token123');

      expect(result).toBeNull();
    });
  });

  describe('touchActivity', () => {
    beforeEach(() => {
      sessionService = new SessionService(mockPool);
    });

    it('should update session activity', async () => {
      mockSessionManager.touchActivity.mockResolvedValue();

      await sessionService.touchActivity('token123');

      expect(mockSessionManager.touchActivity).toHaveBeenCalledWith('token123');
    });
  });

  describe('renewSession', () => {
    beforeEach(() => {
      sessionService = new SessionService(mockPool);
    });

    const renewRequest: RenewSessionRequest = {
      token: 'token123',
      ttlSeconds: 172800 // 48 hours in seconds
    };

    const renewedSession: UserSessionRecord = {
      id: 'session123',
      userId: 'user123',
      token: 'token123',
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
    };

    it('should renew session successfully', async () => {
      mockSessionManager.renewSession.mockResolvedValue(renewedSession);

      const result = await sessionService.renewSession(renewRequest);

      expect(mockSessionManager.renewSession).toHaveBeenCalledWith(renewRequest);
      expect(result).toEqual(renewedSession);
    });
  });

  describe('revokeByToken', () => {
    beforeEach(() => {
      sessionService = new SessionService(mockPool);
    });

    it('should revoke session by token', async () => {
      mockSessionManager.revokeByToken.mockResolvedValue();

      await sessionService.revokeByToken('token123');

      expect(mockSessionManager.revokeByToken).toHaveBeenCalledWith('token123');
    });
  });
});