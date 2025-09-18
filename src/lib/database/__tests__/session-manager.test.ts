import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { SessionManager } from '../session-manager';
import { SessionError } from '../../../types/session';

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
    expect(out.userId).toBe('u1');
    expect(out.token).toBe('t1');
    expect(out.ipAddress).toBe('1.2.3.4');
    expect(out.userAgent).toBe('UA');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_sessions'),
      ['u1', 't1', '1.2.3.4', 'UA', expect.any(Date)]
    );
  });

  test('createSession handles null ipAddress and userAgent', async () => {
    const now = new Date();
    const row = {
      id: 's1', user_id: 'u1', token: 't1', ip_address: null, user_agent: null,
      created_at: now, expires_at: new Date(now.getTime() + 1000), last_activity: now
    };
    mockPool.query.mockResolvedValueOnce({ rows: [row] });
    const out = await mgr.createSession({ userId: 'u1', token: 't1', ttlSeconds: 1 });
    expect(out.ipAddress).toBeNull();
    expect(out.userAgent).toBeNull();
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_sessions'),
      ['u1', 't1', null, null, expect.any(Date)]
    );
  });

  test('getByToken returns null when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const out = await mgr.getByToken('nope');
    expect(out).toBeNull();
  });

  test('getByToken returns mapped session when found', async () => {
    const now = new Date();
    const row = {
      id: 's1', user_id: 'u1', token: 't1', ip_address: '192.168.1.1', user_agent: 'Chrome',
      created_at: now, expires_at: new Date(now.getTime() + 3600000), last_activity: now
    };
    mockPool.query.mockResolvedValueOnce({ rows: [row] });
    const out = await mgr.getByToken('t1');
    expect(out).not.toBeNull();
    expect(out!.id).toBe('s1');
    expect(out!.userId).toBe('u1');
    expect(out!.token).toBe('t1');
    expect(out!.ipAddress).toBe('192.168.1.1');
    expect(out!.userAgent).toBe('Chrome');
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT * FROM user_sessions WHERE token = $1',
      ['t1']
    );
  });

  test('touchActivity updates last_activity timestamp', async () => {
    mockPool.query.mockResolvedValueOnce({});
    await mgr.touchActivity('t1');
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE user_sessions SET last_activity = NOW() WHERE token = $1',
      ['t1']
    );
  });

  test('renewSession updates and returns row or throws when missing', async () => {
    const now = new Date();
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 's1', user_id: 'u1', token: 't1', ip_address: null, user_agent: null, created_at: now, expires_at: now, last_activity: now }] });
    const ok = await mgr.renewSession({ token: 't1', ttlSeconds: 10 });
    expect(ok.id).toBe('s1');
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE user_sessions SET expires_at = $1, last_activity = NOW() WHERE token = $2 RETURNING *',
      [expect.any(Date), 't1']
    );

    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await expect(mgr.renewSession({ token: 'missing', ttlSeconds: 10 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('revokeByToken deletes session by token', async () => {
    mockPool.query.mockResolvedValueOnce({});
    await mgr.revokeByToken('t1');
    expect(mockPool.query).toHaveBeenCalledWith(
      'DELETE FROM user_sessions WHERE token = $1',
      ['t1']
    );
  });

  test('revokeAllForUser deletes all sessions for user and returns count', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 3 });
    const count = await mgr.revokeAllForUser('u1');
    expect(count).toBe(3);
    expect(mockPool.query).toHaveBeenCalledWith(
      'DELETE FROM user_sessions WHERE user_id = $1',
      ['u1']
    );
  });

  test('revokeAllForUser handles null rowCount', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: null });
    const count = await mgr.revokeAllForUser('u1');
    expect(count).toBe(0);
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
    expect(page.page).toBe(1);
    expect(page.limit).toBe(2);
    expect(page.totalPages).toBe(1);
  });

  test('listUserSessions uses default pagination when options not provided', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ total: '25' }] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const page = await mgr.listUserSessions('u1');
    expect(page.page).toBe(1);
    expect(page.limit).toBe(20);
    expect(page.totalPages).toBe(2);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $2 OFFSET $3'),
      ['u1', 20, 0]
    );
  });

  test('listUserSessions handles invalid page and limit values', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ total: '10' }] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const page = await mgr.listUserSessions('u1', { page: 0, limit: -5 });
    expect(page.page).toBe(1);
    expect(page.limit).toBe(20);
  });

  test('listUserSessions limits maximum page size to 100', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ total: '200' }] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const page = await mgr.listUserSessions('u1', { page: 1, limit: 150 });
    expect(page.limit).toBe(100);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $2 OFFSET $3'),
      ['u1', 100, 0]
    );
  });

  test('listUserSessions handles missing total count', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const page = await mgr.listUserSessions('u1');
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(0);
  });

  test('countActiveSessions returns number', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: 3 }] });
    const cnt = await mgr.countActiveSessions('u1');
    expect(cnt).toBe(3);
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT COUNT(*)::int AS cnt FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()',
      ['u1']
    );
  });

  test('countActiveSessions handles null result', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: null }] });
    const cnt = await mgr.countActiveSessions('u1');
    expect(cnt).toBe(0);
  });

  test('countActiveSessions handles empty result', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const cnt = await mgr.countActiveSessions('u1');
    expect(cnt).toBe(0);
  });

  test('mapRow handles null values correctly', async () => {
    const now = new Date();
    const row = {
      id: 's1', user_id: 'u1', token: 't1', ip_address: null, user_agent: null,
      created_at: now, expires_at: now, last_activity: now
    };
    mockPool.query.mockResolvedValueOnce({ rows: [row] });
    const session = await mgr.getByToken('t1');
    expect(session!.ipAddress).toBeNull();
    expect(session!.userAgent).toBeNull();
  });

  test('SessionError class works correctly', () => {
    const error = new SessionError('Test message', 'TEST_CODE', { extra: 'data' });
    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ extra: 'data' });
    expect(error.name).toBe('SessionError');
  });

  test('SessionError uses default code when not provided', () => {
    const error = new SessionError('Test message');
    expect(error.code).toBe('SESSION_ERROR');
    expect(error.details).toBeUndefined();
  });
});
