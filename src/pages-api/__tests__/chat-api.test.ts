import type { NextApiRequest, NextApiResponse } from 'next';

import sendHandler from '../../../pages/api/chat/send';
import listRoomHandler from '../../../pages/api/chat/room/list';
import listPrivateHandler from '../../../pages/api/chat/private/list';
import moderateHandler from '../../../pages/api/chat/moderate';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: jest.fn().mockResolvedValue({ rows: [] }) })) }));
jest.mock('../../../src/lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }) }));
jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishChatMessage: jest.fn().mockResolvedValue(undefined),
  publishChatModerated: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/lib/database/pool', () => ({
  getPool: jest.fn().mockReturnValue({ query: jest.fn().mockResolvedValue({ rows: [] }) }),
}));

const mockService: any = {
  send: jest.fn(),
  listRoom: jest.fn(),
  listPrivate: jest.fn(),
  moderate: jest.fn(),
};

jest.mock('../../../src/lib/services/chat-service', () => ({
  ChatService: jest.fn().mockImplementation(() => mockService),
}));

function resHelper() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return res;
}

function reqHelper(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return { method, body, query, headers: {}, socket: { remoteAddress: '127.0.0.1' } as any } as any;
}

describe('Chat API (US-023)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /api/chat/send returns created message', async () => {
    mockService.send.mockResolvedValue({ id: 'm1', message: 'hi' });
    const req = reqHelper('POST', { roomId: 'r1', senderId: 'u1', message: 'hi' });
    const res = resHelper();
    await sendHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'm1', message: 'hi' });
  });

  it('GET /api/chat/room/list returns items', async () => {
    mockService.listRoom.mockResolvedValue([{ id: 'm1' }]);
    const req = reqHelper('GET', undefined, { roomId: 'r1', limit: '10' });
    const res = resHelper();
    await listRoomHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'm1' }] });
  });

  it('GET /api/chat/private/list returns items', async () => {
    mockService.listPrivate.mockResolvedValue([{ id: 'm2' }]);
    const req = reqHelper('GET', undefined, { userAId: 'u1', userBId: 'u2' });
    const res = resHelper();
    await listPrivateHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'm2' }] });
  });

  it('POST /api/chat/moderate returns updated message', async () => {
    mockService.moderate.mockResolvedValue({ id: 'm3', isModerated: true });
    const req = reqHelper('POST', { messageId: 'm3', moderatorId: 'mod1', hide: true });
    const res = resHelper();
    await moderateHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'm3', isModerated: true });
  });
});
