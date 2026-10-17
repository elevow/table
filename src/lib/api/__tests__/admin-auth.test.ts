import type { NextApiRequest } from 'next';
import { isUserAdminBySession } from '../admin-auth';

describe('admin-auth', () => {
  const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;

  afterEach(() => {
    // Restore env var between tests
    process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
    jest.restoreAllMocks();
  });

  const makeReq = (
    headers: Record<string, string | string[] | undefined> = {},
    cookies: Record<string, string> = {}
  ): NextApiRequest => {
    return { headers, cookies } as unknown as NextApiRequest;
  };

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
