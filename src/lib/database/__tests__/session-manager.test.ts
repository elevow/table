import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { SessionManager } from '../session-manager';

const mockPool = { query: jest.fn() } as any;

describe('SessionManager (US-068)', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mgr = new SessionManager(mockPool);
  });

  test('createSession inserts and returns mapped row', async () => {
    const now = new Date();
    const row = {
      id: 's1', user_id: 'u1', token: 't1', ip_address: '1.2.3.4', user_agent: 'UA',
      created_at: now, expires_at: new Date(now.getTime() + 1000), last_activity: now
    };
    mockPool.query.mockResolvedValueOnce({ rows: [row] });
    const out = await mgr.createSession({ userId: 'u1', token: 't1', ttlSeconds: 1, ipAddress: '1.2.3.4', userAgent: 'UA' });
    expect(out.id).toBe('s1');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  test('getByToken returns null when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const out = await mgr.getByToken('nope');
    expect(out).toBeNull();
  });

  test('renewSession updates and returns row or throws when missing', async () => {
    const now = new Date();
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 's1', user_id: 'u1', token: 't1', ip_address: null, user_agent: null, created_at: now, expires_at: now, last_activity: now }] });
    const ok = await mgr.renewSession({ token: 't1', ttlSeconds: 10 });
    expect(ok.id).toBe('s1');

    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await expect(mgr.renewSession({ token: 'missing', ttlSeconds: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('listUserSessions paginates', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ total: '2' }] });
    const now = new Date();
    mockPool.query.mockResolvedValueOnce({ rows: [
      { id: 's1', user_id: 'u1', token: 't1', ip_address: null, user_agent: null, created_at: now, expires_at: now, last_activity: now },
      { id: 's2', user_id: 'u1', token: 't2', ip_address: null, user_agent: null, created_at: now, expires_at: now, last_activity: now },
    ]});
    const page = await mgr.listUserSessions('u1', { page: 1, limit: 2 });
    expect(page.total).toBe(2);
    expect(page.sessions.length).toBe(2);
  });

  test('countActiveSessions returns number', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: 3 }] });
    const cnt = await mgr.countActiveSessions('u1');
    expect(cnt).toBe(3);
  });
});
