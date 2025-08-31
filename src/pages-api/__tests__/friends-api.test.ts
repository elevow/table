import type { NextApiRequest, NextApiResponse } from 'next';

import requestHandler from '../../../pages/api/friends/request';
import respondHandler from '../../../pages/api/friends/respond';
import listHandler from '../../../pages/api/friends/list';
import pendingHandler from '../../../pages/api/friends/pending';
import blockHandler from '../../../pages/api/friends/block';
import unblockHandler from '../../../pages/api/friends/unblock';
import unfriendHandler from '../../../pages/api/friends/unfriend';

// Mock pg Pool and rate limiter
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockService: any = {
  sendRequest: jest.fn(),
  respondToRequest: jest.fn(),
  listFriends: jest.fn(),
  listPending: jest.fn(),
  block: jest.fn(),
  unblock: jest.fn(),
  unfriend: jest.fn()
};

jest.mock('../../../src/lib/services/friend-service', () => ({
  FriendService: jest.fn().mockImplementation(() => mockService)
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

describe('Friends API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/friends/request success', async () => {
    const record = { id: 'fr1', userId: 'u1', friendId: 'u2', status: 'pending', createdAt: new Date(), updatedAt: new Date() } as any;
    mockService.sendRequest.mockResolvedValue(record);
    const req = createReq('POST', { requesterId: 'u1', recipientId: 'u2' });
    const res = createRes();
    await requestHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(record);
  });

  test('POST /api/friends/respond accept', async () => {
    const record = { id: 'fr1', status: 'accepted' } as any;
    mockService.respondToRequest.mockResolvedValue(record);
    const req = createReq('POST', { id: 'fr1', action: 'accept' });
    const res = createRes();
    await respondHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(record);
  });

  test('GET /api/friends/list returns friends', async () => {
    const payload = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } as any;
    mockService.listFriends.mockResolvedValue(payload);
    const req = createReq('GET', undefined, { userId: 'u1', page: '1', limit: '20' });
    const res = createRes();
    await listHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('GET /api/friends/pending returns pending', async () => {
    const payload = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } as any;
    mockService.listPending.mockResolvedValue(payload);
    const req = createReq('GET', undefined, { userId: 'u1' });
    const res = createRes();
    await pendingHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('POST /api/friends/block blocks user', async () => {
    const block = { id: 'b1', userId: 'u1', blockedId: 'u2', createdAt: new Date(), reason: 'spam' } as any;
    mockService.block.mockResolvedValue(block);
    const req = createReq('POST', { userId: 'u1', blockedId: 'u2', reason: 'spam' });
    const res = createRes();
    await blockHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(block);
  });

  test('POST /api/friends/unblock unblocks user', async () => {
    mockService.unblock.mockResolvedValue(undefined);
    const req = createReq('POST', { userId: 'u1', blockedId: 'u2' });
    const res = createRes();
    await unblockHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('POST /api/friends/unfriend removes friendship', async () => {
    mockService.unfriend.mockResolvedValue(undefined);
    const req = createReq('POST', { a: 'u1', b: 'u2' });
    const res = createRes();
    await unfriendHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
