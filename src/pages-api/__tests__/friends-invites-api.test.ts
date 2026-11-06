import type { NextApiRequest, NextApiResponse } from 'next';

import statusHandler from '../../../pages/api/friends/status';
import inviteHandler from '../../../pages/api/friends/invite';
import invitesHandler from '../../../pages/api/friends/invites';
import inviteRespondHandler from '../../../pages/api/friends/invite-respond';

jest.mock('../../../src/lib/database/pool', () => ({ getPool: jest.fn(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockGetUserId = jest.fn();
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  getAuthenticatedUserId: (...args: any[]) => mockGetUserId(...args)
}));

const mockService: any = {
  relationshipStatus: jest.fn(),
  inviteToGame: jest.fn(),
  listInvites: jest.fn(),
  respondToInvite: jest.fn()
};

jest.mock('../../../src/lib/services/friend-service', () => ({
  FriendService: jest.fn().mockImplementation(() => mockService)
}));

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return {
    method,
    body,
    query: query || {},
    url: '/api/friends/test',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

async function call(handler: any, req: Partial<NextApiRequest>) {
  const res = createRes();
  await handler(req as any, res as any);
  return res;
}

describe('Friends Invites & Status API routes (US-064)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserId.mockResolvedValue('u1');
  });

  test('every route rejects signed-out callers with 401', async () => {
    mockGetUserId.mockResolvedValue(null);
    const cases: Array<[any, Partial<NextApiRequest>]> = [
      [statusHandler, createReq('GET', undefined, { a: 'u1', b: 'u2' })],
      [invitesHandler, createReq('GET', undefined, { userId: 'u1' })],
      [inviteHandler, createReq('POST', { inviterId: 'u1', inviteeId: 'u2', roomId: 'r1' })],
      [inviteRespondHandler, createReq('POST', { id: 'i1', action: 'accept' })]
    ];
    for (const [handler, req] of cases) {
      const res = await call(handler, req);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(mockService.relationshipStatus).not.toHaveBeenCalled();
    expect(mockService.listInvites).not.toHaveBeenCalled();
    expect(mockService.inviteToGame).not.toHaveBeenCalled();
    expect(mockService.respondToInvite).not.toHaveBeenCalled();
  });

  test('GET /api/friends/status returns relationship status', async () => {
    const payload = { status: 'pending', direction: 'incoming' } as any;
    mockService.relationshipStatus.mockResolvedValue(payload);
    const res = await call(statusHandler, createReq('GET', undefined, { a: 'u1', b: 'u2' }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('GET /api/friends/status refuses lookups between two other users', async () => {
    const res = await call(statusHandler, createReq('GET', undefined, { a: 'u2', b: 'u3' }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.relationshipStatus).not.toHaveBeenCalled();
  });

  test('POST /api/friends/invite creates invite', async () => {
    const invite = { id: 'i1', inviterId: 'u1', inviteeId: 'u2', roomId: 'r1', status: 'pending', createdAt: new Date() } as any;
    mockService.inviteToGame.mockResolvedValue(invite);
    const res = await call(inviteHandler, createReq('POST', { inviterId: 'u1', inviteeId: 'u2', roomId: 'r1' }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(invite);
  });

  test('POST /api/friends/invite refuses to invite on behalf of another user', async () => {
    const res = await call(inviteHandler, createReq('POST', { inviterId: 'u9', inviteeId: 'u2', roomId: 'r1' }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.inviteToGame).not.toHaveBeenCalled();
  });

  test('POST /api/friends/invite maps BLOCKED to 400', async () => {
    mockService.inviteToGame.mockRejectedValue(Object.assign(new Error('Blocked'), { code: 'BLOCKED' }));
    const res = await call(inviteHandler, createReq('POST', { inviteeId: 'u2', roomId: 'r1' }));
    expect(mockService.inviteToGame).toHaveBeenCalledWith('u1', 'u2', 'r1');
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('GET /api/friends/invites lists invites', async () => {
    const payload = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } as any;
    mockService.listInvites.mockResolvedValue(payload);
    const res = await call(invitesHandler, createReq('GET', undefined, { userId: 'u1', kind: 'incoming' }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test("GET /api/friends/invites refuses another user's invites", async () => {
    const res = await call(invitesHandler, createReq('GET', undefined, { userId: 'u2' }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.listInvites).not.toHaveBeenCalled();
  });

  test('POST /api/friends/invite-respond accepts as the signed-in invitee', async () => {
    const invite = { id: 'i1', status: 'accepted' } as any;
    mockService.respondToInvite.mockResolvedValue(invite);
    const res = await call(inviteRespondHandler, createReq('POST', { id: 'i1', action: 'accept' }));
    expect(mockService.respondToInvite).toHaveBeenCalledWith('i1', 'accept', 'u1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(invite);
  });

  test("POST /api/friends/invite-respond returns 404 for someone else's invite", async () => {
    mockService.respondToInvite.mockRejectedValue(Object.assign(new Error('Invite not found'), { code: 'NOT_FOUND' }));
    const res = await call(inviteRespondHandler, createReq('POST', { id: 'i2', action: 'accept' }));
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('wrong method returns 405', async () => {
    const res = await call(inviteHandler, createReq('GET'));
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
  });
});
