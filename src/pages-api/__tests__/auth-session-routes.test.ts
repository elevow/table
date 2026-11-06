import type { NextApiRequest, NextApiResponse } from 'next';

import logoutHandler from '../../../pages/api/auth/logout';
import changePasswordHandler from '../../../pages/api/auth/change-password';

const mockQuery = jest.fn();
jest.mock('../../../src/lib/database/pool', () => ({ getPool: jest.fn(() => ({ query: (...a: any[]) => mockQuery(...a) })) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockAudit = jest.fn();
jest.mock('../../../src/lib/api/audit', () => ({ createSafeAudit: jest.fn(() => mockAudit) }));

const mockGetUserId = jest.fn();
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  ...jest.requireActual('../../../src/lib/auth/auth-utils'),
  getAuthenticatedUserId: (...args: any[]) => mockGetUserId(...args)
}));

const mockChangePassword = jest.fn();
jest.mock('../../../src/lib/database/user-manager', () => ({ UserManager: jest.fn() }));
jest.mock('../../../src/lib/services/user-service', () => ({
  createUserService: jest.fn(() => ({ changePassword: (...a: any[]) => mockChangePassword(...a) }))
}));

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn()
  } as any as NextApiResponse & { status: jest.Mock; json: jest.Mock };
}

function createReq(method: string, body?: any, token?: string): NextApiRequest {
  return {
    method,
    body,
    query: {},
    url: '/api/auth/test',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cookies: {},
    socket: { remoteAddress: '127.0.0.1' }
  } as any;
}

async function call(handler: any, req: NextApiRequest) {
  const res = createRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUserId.mockResolvedValue('u1');
});

describe('POST /api/auth/logout', () => {
  test('deletes the session token and audits the user', async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 'u1' }] });
    const res = await call(logoutHandler, createReq('POST', {}, 'tok'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM auth_tokens'), [expect.any(String)]);
    // Never stores or matches on the raw token
    expect(mockQuery.mock.calls[0][1][0]).not.toBe('tok');
    expect(mockAudit).toHaveBeenCalledWith('u1', 'auth', 'logout', true, expect.objectContaining({ tokenProvided: true }));
  });

  test('without a token returns 400', async () => {
    const res = await call(logoutHandler, createReq('POST', {}));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a database failure returns 500 and is audited', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(logoutHandler, createReq('POST', {}, 'tok'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockAudit).toHaveBeenCalledWith('system', 'auth', 'logout_attempt', false, expect.objectContaining({ reason: 'db down' }));
  });

  test('other methods return 405', async () => {
    const res = await call(logoutHandler, createReq('GET'));
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('POST /api/auth/change-password', () => {
  const valid = { currentPassword: 'old-password', newPassword: 'new-password' };

  test('signed-out callers get 401', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await call(changePasswordHandler, createReq('POST', valid));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  test('changes the signed-in user\'s password', async () => {
    mockChangePassword.mockResolvedValue(true);
    const res = await call(changePasswordHandler, createReq('POST', valid, 'tok'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockChangePassword).toHaveBeenCalledWith({ userId: 'u1', ...valid });
    expect(mockAudit).toHaveBeenCalledWith('u1', 'auth', 'password_change', true, expect.any(Object));
  });

  test.each([
    [{}, 'Current password and new password are required'],
    [{ currentPassword: 'old-password', newPassword: 'short' }, 'New password must be at least 8 characters long'],
    [{ currentPassword: 'same-password', newPassword: 'same-password' }, 'New password must be different from current password'],
  ])('rejects %j with 400', async (body, error) => {
    const res = await call(changePasswordHandler, createReq('POST', body, 'tok'));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error });
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  test('a wrong current password returns 400 and is audited against the user', async () => {
    mockChangePassword.mockRejectedValue(new Error('Current password is incorrect'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(changePasswordHandler, createReq('POST', valid, 'tok'));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Current password is incorrect' });
    expect(mockAudit).toHaveBeenCalledWith('u1', 'auth', 'password_change_attempt', false, expect.any(Object));
  });

  test('an account without a password returns 404', async () => {
    mockChangePassword.mockRejectedValue(new Error('User not found or no password set'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(changePasswordHandler, createReq('POST', valid, 'tok'));
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('other failures return a generic 500', async () => {
    mockChangePassword.mockRejectedValue(new Error('connection reset'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(changePasswordHandler, createReq('POST', valid, 'tok'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password change failed. Please try again.' });
  });
});
