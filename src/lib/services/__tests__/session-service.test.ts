import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { SessionService } from '../session-service';

// We'll stub a manager and inject it into the service

const mockPool = {} as any;

describe('SessionService (US-068)', () => {
  let svc: SessionService;
  let mgr: any;

  beforeEach(() => {
  jest.clearAllMocks();
    mgr = {
      createSession: jest.fn(),
      getByToken: jest.fn(),
      touchActivity: jest.fn(),
      renewSession: jest.fn(),
      revokeByToken: jest.fn(),
      revokeAllForUser: jest.fn(),
      listUserSessions: jest.fn(),
      countActiveSessions: jest.fn(),
    };
    svc = new SessionService(mockPool, { maxConcurrentSessions: 2 }, mgr);
  });

  test('createSession enforces concurrent limit', async () => {
    mgr.countActiveSessions.mockResolvedValueOnce(2);
    await expect(svc.createSession({ userId: 'u1', token: 't', ttlSeconds: 60 })).rejects.toMatchObject({ code: 'CONCURRENT_LIMIT' });
    expect(mgr.createSession).not.toHaveBeenCalled();
  });

  test('createSession delegates when under limit', async () => {
    const now = new Date();
    mgr.countActiveSessions.mockResolvedValueOnce(1);
    mgr.createSession.mockResolvedValueOnce({ id: 's1', userId: 'u1', token: 't', ipAddress: null, userAgent: null, createdAt: now, expiresAt: new Date(now.getTime()+1000), lastActivity: now });
    const out = await svc.createSession({ userId: 'u1', token: 't', ttlSeconds: 1 });
    expect(out.id).toBe('s1');
  });

  test('verifySession returns null if expired or missing', async () => {
    mgr.getByToken.mockResolvedValueOnce(null);
    expect(await svc.verifySession('missing')).toBeNull();

    const past = new Date(Date.now() - 1000);
    mgr.getByToken.mockResolvedValueOnce({ id: 's1', userId: 'u1', token: 't', ipAddress: null, userAgent: null, createdAt: past, expiresAt: past, lastActivity: past });
    expect(await svc.verifySession('t')).toBeNull();
  });

  test('renew/revoke/list delegates to manager', async () => {
    const now = new Date();
    mgr.renewSession.mockResolvedValueOnce({ id: 's1', userId: 'u1', token: 't', ipAddress: null, userAgent: null, createdAt: now, expiresAt: new Date(now.getTime()+60000), lastActivity: now });
    const renewed = await svc.renewSession({ token: 't', ttlSeconds: 60 });
    expect(renewed.id).toBe('s1');

    mgr.revokeByToken.mockResolvedValueOnce(undefined);
    await expect(svc.revokeByToken('t')).resolves.toBeUndefined();

    mgr.revokeAllForUser.mockResolvedValueOnce(3);
    expect(await svc.revokeAllForUser('u1')).toBe(3);

    mgr.listUserSessions.mockResolvedValueOnce({ sessions: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    const page = await svc.listUserSessions('u1', { page: 1, limit: 20 });
    expect(page.total).toBe(0);
  });
});
