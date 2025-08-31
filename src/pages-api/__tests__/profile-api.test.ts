import type { NextApiRequest, NextApiResponse } from 'next';

// Handler under test
import handler from '../../../pages/api/profile';

// Mocks: pg Pool, rate limiter, user manager/service factories, and DataProtectionFactory
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockUser = { id: 'u1', email: 'a@b.com', username: 'alice' };
const mockManager: any = {};
const mockService: any = {
  getUserById: jest.fn().mockResolvedValue(mockUser),
  updateUser: jest.fn().mockResolvedValue({ ...mockUser, username: 'alice2' })
};

jest.mock('../../../src/lib/database/user-manager', () => ({
  UserManager: jest.fn().mockImplementation(() => mockManager)
}));

jest.mock('../../../src/lib/services/user-service', () => ({
  createUserService: jest.fn().mockImplementation(() => mockService)
}));

jest.mock('../../../src/lib/database/security-utilities', () => {
  const auditAccess = jest.fn().mockResolvedValue(undefined);
  const dp = { auditAccess };
  return {
    DataProtectionFactory: {
      createDataProtectionService: jest.fn().mockResolvedValue(dp)
    },
    __mock: { dp, auditAccess }
  };
});

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, body?: any, query?: any, headers?: any): Partial<NextApiRequest> {
  return {
    method,
    body,
    query,
    headers: { 'x-user-id': 'u1', 'user-agent': 'jest', ...(headers || {}) },
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

describe('Profile API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/profile returns own profile and logs access', async () => {
    const req = createReq('GET');
    const res = createRes();

    await handler(req as any, res as any);

    if ((res.status as any).mock.calls[0]?.[0] === 400) {
      // Debug output
      // eslint-disable-next-line no-console
      console.log('GET /api/profile error:', (res.json as any).mock.calls[0]?.[0]);
    }

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockUser);
    expect(mockService.getUserById).toHaveBeenCalledWith('u1', 'u1');
  const { __mock } = require('../../../src/lib/database/security-utilities');
  expect(__mock.auditAccess).toHaveBeenCalled();
  });

  it('PUT /api/profile updates own profile and logs access', async () => {
    const req = createReq('PUT', { username: 'alice2' });
    const res = createRes();

    await handler(req as any, res as any);

    if ((res.status as any).mock.calls[0]?.[0] === 400) {
      // Debug output
      // eslint-disable-next-line no-console
      console.log('PUT /api/profile error:', (res.json as any).mock.calls[0]?.[0]);
    }

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...mockUser, username: 'alice2' });
    expect(mockService.updateUser).toHaveBeenCalledWith('u1', { username: 'alice2' }, 'u1');
  const { __mock } = require('../../../src/lib/database/security-utilities');
  expect(__mock.auditAccess).toHaveBeenCalled();
  });

  it('GET /api/profile denies access to other userId', async () => {
    const req = createReq('GET', undefined, { userId: 'u2' });
    const res = createRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('handles unauthorized when missing user id', async () => {
    const req = createReq('GET', undefined, undefined, { 'x-user-id': '' });
    const res = createRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 405 and Allow header for unsupported methods', async () => {
    const req = createReq('DELETE');
    // Attach a setHeader spy to verify Allow header
    const res = {
      ...createRes(),
      setHeader: jest.fn()
    } as any;

    await handler(req as any, res as any);

    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'PUT', 'PATCH']);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('OPTIONS returns 204 and Allow header for preflight', async () => {
    const req = createReq('OPTIONS');
    // Ensure no auth header needed for preflight
    (req as any).headers['x-user-id'] = '';
    const res = {
      ...createRes(),
      setHeader: jest.fn(),
      end: jest.fn()
    } as any;

    await handler(req as any, res as any);

    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['GET', 'PUT', 'PATCH']);
    // Access-Control-Allow-Methods is optional but we set it; assert presence
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, PUT, PATCH');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
