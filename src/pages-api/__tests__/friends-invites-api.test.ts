import type { NextApiRequest, NextApiResponse } from 'next';

import statusHandler from '../../../pages/api/friends/status';
import inviteHandler from '../../../pages/api/friends/invite';
import invitesHandler from '../../../pages/api/friends/invites';
import inviteRespondHandler from '../../../pages/api/friends/invite-respond';
import headToHeadHandler from '../../../pages/api/friends/head-to-head';

// Mock pg Pool and rate limiter
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockService: any = {
  relationshipStatus: jest.fn(),
  inviteToGame: jest.fn(),
  listInvites: jest.fn(),
  respondToInvite: jest.fn(),
  headToHead: jest.fn()
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

describe('Friends Invites & Status API routes (US-064)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/friends/status returns relationship status', async () => {
    const payload = { status: 'pending', direction: 'incoming' } as any;
    mockService.relationshipStatus.mockResolvedValue(payload);
    const req = createReq('GET', undefined, { a: 'u1', b: 'u2' });
    const res = createRes();
    await statusHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('POST /api/friends/invite creates invite', async () => {
    const invite = { id: 'i1', inviterId: 'u1', inviteeId: 'u2', roomId: 'r1', status: 'pending', createdAt: new Date() } as any;
    mockService.inviteToGame.mockResolvedValue(invite);
    const req = createReq('POST', { inviterId: 'u1', inviteeId: 'u2', roomId: 'r1' });
    const res = createRes();
    await inviteHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(invite);
  });

  test('GET /api/friends/invites lists invites', async () => {
    const payload = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } as any;
    mockService.listInvites.mockResolvedValue(payload);
    const req = createReq('GET', undefined, { userId: 'u1', kind: 'incoming' });
    const res = createRes();
    await invitesHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('POST /api/friends/invite-respond accept', async () => {
    const invite = { id: 'i1', status: 'accepted' } as any;
    mockService.respondToInvite.mockResolvedValue(invite);
    const req = createReq('POST', { id: 'i1', action: 'accept' });
    const res = createRes();
    await inviteRespondHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(invite);
  });

  test('GET /api/friends/head-to-head returns summary', async () => {
    const summary = { gamesPlayed: 12, lastPlayed: new Date() } as any;
    mockService.headToHead.mockResolvedValue(summary);
    const req = createReq('GET', undefined, { a: 'u1', b: 'u2' });
    const res = createRes();
    await headToHeadHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(summary);
  });
});
