import type { NextApiRequest, NextApiResponse } from 'next';

// Handlers under test
import uploadHandler from '../../../pages/api/avatars/upload';
import getLatestHandler from '../../../pages/api/avatars/user/[userId]';
import updateHandler from '../../../pages/api/avatars/[avatarId]';

// Mock pool module to avoid database connection
const mockPool: any = {
  end: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../../../src/lib/database/pool', () => ({
  getPool: jest.fn(() => mockPool)
}));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockServiceInstance: any = {
  uploadAvatar: jest.fn(),
  getLatestForUser: jest.fn(),
  manager: {
    updateAvatar: jest.fn(),
    getAvatarById: jest.fn()
  }
};

jest.mock('../../../src/lib/services/avatar-service', () => ({
  AvatarService: jest.fn().mockImplementation(() => mockServiceInstance)
}));

// Mock auth utils
const mockGetAuthenticatedUserId = jest.fn();
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requireAuth: jest.fn(() => Promise.resolve('authenticated-user-123')),
  getAuthenticatedUserId: (...args: any[]) => mockGetAuthenticatedUserId(...args),
  getAuthToken: jest.fn(() => 'mock-token')
}));

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return {
    method,
    body,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

describe('Avatar API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('authenticated-user-123');
  });

  test('POST /api/avatars/upload success', async () => {
    const avatar = { id: 'a1', originalUrl: 'http://img/orig.jpg', variants: { thumb: 'http://img/t.jpg' }, status: 'active' } as any;
    mockServiceInstance.uploadAvatar.mockResolvedValue(avatar);

    const req = createReq('POST', { originalUrl: avatar.originalUrl, variants: avatar.variants });
    const res = createRes();

    await uploadHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'a1', url: 'http://img/orig.jpg', thumbnails: { thumb: 'http://img/t.jpg' }, status: 'active' });
  });

  test('POST /api/avatars/upload uses the one image for every size when none are sent', async () => {
    const url = 'data:image/webp;base64,AAAA';
    mockServiceInstance.uploadAvatar.mockResolvedValue({ id: 'a3', originalUrl: url, variants: {}, status: 'active' } as any);
    const req = createReq('POST', { originalUrl: url });
    const res = createRes();

    await uploadHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockServiceInstance.uploadAvatar).toHaveBeenCalledWith(expect.objectContaining({
      originalUrl: url,
      variants: { small: url, medium: url, large: url },
    }));
  });

  test('POST /api/avatars/upload validation error', async () => {
    const req = createReq('POST', { /* missing originalUrl and variants */ });
    const res = createRes();

    await uploadHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
  });

  test('GET /api/avatars/[userId] returns latest avatar', async () => {
    const avatar = { id: 'a2', originalUrl: 'http://img/2.jpg', variants: { s: 'http://img/2s.jpg' }, status: 'active' } as any;
    mockServiceInstance.getLatestForUser.mockResolvedValue(avatar);

    const req = createReq('GET', undefined, { userId: 'u1' });
    const res = createRes();

    await getLatestHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'a2', url: 'http://img/2.jpg', thumbnails: { s: 'http://img/2s.jpg' }, status: 'active' });
  });

  test('GET /api/avatars/[userId] returns 404 when none', async () => {
    mockServiceInstance.getLatestForUser.mockResolvedValue(null);
    const req = createReq('GET', undefined, { userId: 'u404' });
    const res = createRes();

    await getLatestHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  test("DELETE /api/avatars/[avatarId] archives the caller's own avatar", async () => {
    const archived = { id: 'a4', status: 'archived' } as any;
    mockServiceInstance.manager.getAvatarById.mockResolvedValue({ id: 'a4', userId: 'authenticated-user-123' });
    mockServiceInstance.manager.updateAvatar.mockResolvedValue(archived);

    const req = createReq('DELETE', undefined, { avatarId: 'a4' });
    const res = createRes();

    await updateHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, id: 'a4', status: 'archived' });
  });

  test('DELETE /api/avatars/[avatarId] refuses signed-out callers', async () => {
    mockGetAuthenticatedUserId.mockResolvedValue(null);
    const res = createRes();
    await updateHandler(createReq('DELETE', undefined, { avatarId: 'a4' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockServiceInstance.manager.updateAvatar).not.toHaveBeenCalled();
  });

  test("DELETE /api/avatars/[avatarId] won't archive someone else's avatar", async () => {
    mockServiceInstance.manager.getAvatarById.mockResolvedValue({ id: 'a5', userId: 'someone-else' });
    const res = createRes();
    await updateHandler(createReq('DELETE', undefined, { avatarId: 'a5' }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockServiceInstance.manager.updateAvatar).not.toHaveBeenCalled();
  });
});
