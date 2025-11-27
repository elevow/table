import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminAuthorized, requireAdmin, isUserAdminBySession } from '../admin-auth';

describe('admin-auth', () => {
  const ORIGINAL_TOKEN = process.env.ADMIN_API_TOKEN;
  const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;

  afterEach(() => {
    // Restore env var between tests
    process.env.ADMIN_API_TOKEN = ORIGINAL_TOKEN;
    process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
    jest.restoreAllMocks();
  });

  const makeReq = (headers: Record<string, any> = {}, cookies: Record<string, any> = {}): NextApiRequest => {
    return { headers, cookies } as unknown as NextApiRequest;
  };

  const makeRes = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as NextApiResponse;
    return res;
  };

  test('isAdminAuthorized returns false when ADMIN_API_TOKEN is not set', () => {
    delete process.env.ADMIN_API_TOKEN;
    const req = makeReq({ 'x-admin-token': 'anything' });
    expect(isAdminAuthorized(req)).toBe(false);
  });

  test('isAdminAuthorized returns false when header is missing', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const req = makeReq({});
    expect(isAdminAuthorized(req)).toBe(false);
  });

  test('isAdminAuthorized returns false when header does not match env token', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const req = makeReq({ 'x-admin-token': 'wrong' });
    expect(isAdminAuthorized(req)).toBe(false);
  });

  test('isAdminAuthorized returns true when lowercase header matches', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const req = makeReq({ 'x-admin-token': 'secret' });
    expect(isAdminAuthorized(req)).toBe(true);
  });

  test('isAdminAuthorized returns true when uppercase header matches', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const req = makeReq({ 'X-Admin-Token': 'secret' });
    expect(isAdminAuthorized(req)).toBe(true);
  });

  test('isAdminAuthorized uses first value if header is an array', () => {
    process.env.ADMIN_API_TOKEN = 'first';
    const req = makeReq({ 'x-admin-token': ['first', 'second'] });
    expect(isAdminAuthorized(req)).toBe(true);
  });

  test('requireAdmin sends 401 and returns false when unauthorized', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const req = makeReq({ 'x-admin-token': 'wrong' });
    const res = makeRes();

    const ok = requireAdmin(req, res);

    expect(ok).toBe(false);
    const r = res as unknown as { status: jest.Mock; json: jest.Mock };
    expect(r.status).toHaveBeenCalledWith(401);
    expect(r.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  test('requireAdmin returns true and does not write response when authorized', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    const req = makeReq({ 'x-admin-token': 'secret' });
    const res = makeRes();

    const ok = requireAdmin(req, res);

    expect(ok).toBe(true);
    const r = res as unknown as { status: jest.Mock; json: jest.Mock };
    expect(r.status).not.toHaveBeenCalled();
    expect(r.json).not.toHaveBeenCalled();
  });

  describe('isUserAdminBySession', () => {
    test('returns false when no session token is provided', async () => {
      const req = makeReq({}, {});
      const getPool = jest.fn();
      
      const result = await isUserAdminBySession(req, getPool);
      
      expect(result).toBe(false);
      expect(getPool).not.toHaveBeenCalled();
    });

    test('returns false when session token is null string', async () => {
      const req = makeReq({}, { session_token: 'null' });
      const getPool = jest.fn();
      
      const result = await isUserAdminBySession(req, getPool);
      
      expect(result).toBe(false);
    });

    test('returns false when user is not found in database', async () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const req = makeReq({}, { session_token: 'valid-token' });
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      };
      const getPool = jest.fn().mockReturnValue(mockPool);
      
      const result = await isUserAdminBySession(req, getPool);
      
      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('returns true when user email is admin', async () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const req = makeReq({ authorization: 'Bearer valid-token' }, {});
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ email: 'admin@example.com' }] }),
        release: jest.fn(),
      };
      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      };
      const getPool = jest.fn().mockReturnValue(mockPool);
      
      const result = await isUserAdminBySession(req, getPool);
      
      expect(result).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('returns false when user email is not admin', async () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const req = makeReq({}, { auth_token: 'valid-token' });
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ email: 'user@example.com' }] }),
        release: jest.fn(),
      };
      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      };
      const getPool = jest.fn().mockReturnValue(mockPool);
      
      const result = await isUserAdminBySession(req, getPool);
      
      expect(result).toBe(false);
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('returns false and handles errors gracefully', async () => {
      const req = makeReq({}, { session_token: 'valid-token' });
      const mockPool = {
        connect: jest.fn().mockRejectedValue(new Error('Database error')),
      };
      const getPool = jest.fn().mockReturnValue(mockPool);
      
      const result = await isUserAdminBySession(req, getPool);
      
      expect(result).toBe(false);
    });
  });
});
