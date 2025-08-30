import type { NextApiRequest, NextApiResponse } from 'next';

// Handlers under test
import uploadHandler from '../../../pages/api/avatars/upload';
import getLatestHandler from '../../../pages/api/avatars/[userId]';
import updateHandler from '../../../pages/api/avatars/[avatarId]';

// Mocks: pg Pool, rate limiter, and AvatarService used inside handlers
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockServiceInstance: any = {
  uploadAvatar: jest.fn(),
  getLatestForUser: jest.fn(),
  approveAvatar: jest.fn(),
  rejectAvatar: jest.fn(),
  manager: {
    updateAvatar: jest.fn()
  }
};

jest.mock('../../../src/lib/services/avatar-service', () => ({
  AvatarService: jest.fn().mockImplementation(() => mockServiceInstance)
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
  });

  test('POST /api/avatars/upload success', async () => {
    const avatar = { id: 'a1', originalUrl: 'http://img/orig.jpg', variants: { thumb: 'http://img/t.jpg' }, status: 'pending' } as any;
    mockServiceInstance.uploadAvatar.mockResolvedValue(avatar);

    const req = createReq('POST', { userId: 'u1', originalUrl: avatar.originalUrl, variants: avatar.variants });
    const res = createRes();

    await uploadHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'a1', url: 'http://img/orig.jpg', thumbnails: { thumb: 'http://img/t.jpg' }, status: 'pending' });
  });

  test('POST /api/avatars/upload validation error', async () => {
    const req = createReq('POST', { userId: 'u1' });
    const res = createRes();

    await uploadHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
  });

  test('GET /api/avatars/[userId] returns latest avatar', async () => {
    const avatar = { id: 'a2', originalUrl: 'http://img/2.jpg', variants: { s: 'http://img/2s.jpg' }, status: 'approved' } as any;
    mockServiceInstance.getLatestForUser.mockResolvedValue(avatar);

    const req = createReq('GET', undefined, { userId: 'u1' });
    const res = createRes();

    await getLatestHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'a2', url: 'http://img/2.jpg', thumbnails: { s: 'http://img/2s.jpg' }, status: 'approved' });
  });

  test('GET /api/avatars/[userId] returns 404 when none', async () => {
    mockServiceInstance.getLatestForUser.mockResolvedValue(null);
    const req = createReq('GET', undefined, { userId: 'u404' });
    const res = createRes();

    await getLatestHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  test('PUT /api/avatars/[avatarId] approve', async () => {
    const approved = { id: 'a3', status: 'approved', moderatedAt: new Date(), moderatorId: 'm1' } as any;
    mockServiceInstance.approveAvatar.mockResolvedValue(approved);

    const req = createReq('PUT', { action: 'approve', moderatorId: 'm1' }, { avatarId: 'a3' });
    const res = createRes();

    await updateHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'a3', status: 'approved', moderatedAt: approved.moderatedAt, moderatorId: 'm1' });
  });

  test('DELETE /api/avatars/[avatarId] archives avatar', async () => {
    const archived = { id: 'a4', status: 'archived' } as any;
    mockServiceInstance.manager.updateAvatar.mockResolvedValue(archived);

    const req = createReq('DELETE', undefined, { avatarId: 'a4' });
    const res = createRes();

    await updateHandler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, id: 'a4', status: 'archived' });
  });
});
