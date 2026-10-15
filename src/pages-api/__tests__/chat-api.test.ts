import type { NextApiRequest, NextApiResponse } from 'next';

import sendHandler from '../../../pages/api/chat/send';
import listRoomHandler from '../../../pages/api/chat/room/list';
import listPrivateHandler from '../../../pages/api/chat/private/list';
import moderateHandler from '../../../pages/api/chat/moderate';
import deleteHandler from '../../../pages/api/chat/delete';
import addReactionHandler from '../../../pages/api/chat/reactions/add';
import removeReactionHandler from '../../../pages/api/chat/reactions/remove';

// The connect/release mock is needed for isUserAdminBySession, which uses client.query for admin authentication.
// The connect/release mock is needed for isUserAdminBySession, which uses client.query for admin authentication.
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }) })) }));
jest.mock('../../../src/lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }) }));
jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishChatMessage: jest.fn().mockResolvedValue(undefined),
  publishChatModerated: jest.fn().mockResolvedValue(undefined),
  publishChatDeleted: jest.fn().mockResolvedValue(undefined),
  publishChatReaction: jest.fn().mockResolvedValue(undefined),
  publishChatReactionRemoved: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/lib/database/pool', () => ({
  getPool: jest.fn().mockReturnValue({ query: jest.fn().mockResolvedValue({ rows: [] }), connect: jest.fn().mockResolvedValue({ query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }) }),
}));
jest.mock('../../../src/lib/api/admin-auth', () => ({
  isUserAdminBySession: jest.fn().mockResolvedValue(false),
}));

const mockRequireAdminSession = jest.fn(async () => 'admin-1');
// Behaves like the real requirePlayer: 401 without a session, 403 when a claimed ID differs
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockRequirePlayer = jest.fn(async (_req: any, res: any, claimed?: unknown) => {
  if (!mockSession.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  if (claimed !== undefined && claimed !== null && claimed !== '' && String(claimed) !== mockSession.userId) {
    res.status(403).json({ error: 'Player does not match the signed-in user' });
    return null;
  }
  return mockSession.userId;
});
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requireAdminSession: (...args: any[]) => mockRequireAdminSession(...args),
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

interface MockChatService {
  send: jest.Mock;
  listRoom: jest.Mock;
  listPrivate: jest.Mock;
  moderate: jest.Mock;
  getMessage: jest.Mock;
  deleteMessage: jest.Mock;
  addReaction: jest.Mock;
  removeReaction: jest.Mock;
}

const mockService: MockChatService = {
  send: jest.fn(),
  listRoom: jest.fn(),
  listPrivate: jest.fn(),
  moderate: jest.fn(),
  getMessage: jest.fn(),
  deleteMessage: jest.fn(),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
};

jest.mock('../../../src/lib/services/chat-service', () => ({
  ChatService: jest.fn().mockImplementation(() => mockService),
}));

interface MockResponse extends Partial<NextApiResponse> {
  status: jest.Mock;
  json: jest.Mock;
}

function resHelper(): MockResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function reqHelper(
  method: string,
  body?: Record<string, unknown>,
  query?: Record<string, string | string[]>,
  cookies?: Record<string, string>,
  headers?: Record<string, string | string[]>
): Partial<NextApiRequest> {
  return {
    method,
    body,
    query,
    headers: headers || {},
    cookies: cookies || {},
    socket: { remoteAddress: '127.0.0.1' } as Partial<NextApiRequest['socket']>,
  } as Partial<NextApiRequest>;
}

describe('Chat API (US-023)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.userId = 'u1';
  });

  it('POST /api/chat/send returns created message', async () => {
    mockService.send.mockResolvedValue({ id: 'm1', message: 'hi' });
    const req = reqHelper('POST', { roomId: 'r1', senderId: 'u1', message: 'hi' });
    const res = resHelper();
    await sendHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'm1', message: 'hi' });
    expect(mockService.send).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'u1' }));
  });

  it('POST /api/chat/send sends as the signed-in user when senderId is omitted', async () => {
    mockService.send.mockResolvedValue({ id: 'm1' });
    const req = reqHelper('POST', { roomId: 'r1', message: 'hi' });
    const res = resHelper();
    await sendHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockService.send).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'u1' }));
  });

  it('POST /api/chat/send refuses to send as another user', async () => {
    const req = reqHelper('POST', { roomId: 'r1', senderId: 'u2', message: 'hi' });
    const res = resHelper();
    await sendHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.send).not.toHaveBeenCalled();
  });

  it('POST /api/chat/send requires a login', async () => {
    mockSession.userId = null;
    const req = reqHelper('POST', { roomId: 'r1', message: 'hi' });
    const res = resHelper();
    await sendHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockService.send).not.toHaveBeenCalled();
  });

  it('GET /api/chat/room/list returns items', async () => {
    mockService.listRoom.mockResolvedValue([{ id: 'm1' }]);
    const req = reqHelper('GET', undefined, { roomId: 'r1', limit: '10' });
    const res = resHelper();
    await listRoomHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'm1' }] });
  });

  it('GET /api/chat/private/list returns items', async () => {
    mockService.listPrivate.mockResolvedValue([{ id: 'm2' }]);
    const req = reqHelper('GET', undefined, { userAId: 'u1', userBId: 'u2' });
    const res = resHelper();
    await listPrivateHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'm2' }] });
  });

  it('GET /api/chat/private/list refuses a conversation the caller is not part of', async () => {
    const req = reqHelper('GET', undefined, { userAId: 'u3', userBId: 'u4' });
    const res = resHelper();
    await listPrivateHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.listPrivate).not.toHaveBeenCalled();
  });

  it('GET /api/chat/private/list requires a login', async () => {
    mockSession.userId = null;
    const req = reqHelper('GET', undefined, { userAId: 'u1', userBId: 'u2' });
    const res = resHelper();
    await listPrivateHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockService.listPrivate).not.toHaveBeenCalled();
  });

  it('POST /api/chat/moderate returns updated message, attributed to the signed-in admin', async () => {
    mockService.moderate.mockResolvedValue({ id: 'm3', isModerated: true });
    const req = reqHelper('POST', { messageId: 'm3', moderatorId: 'mod1', hide: true });
    const res = resHelper();
    await moderateHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'm3', isModerated: true });
    expect(mockService.moderate).toHaveBeenCalledWith('m3', 'admin-1', true);
  });

  it('POST /api/chat/moderate rejects non-admins', async () => {
    mockRequireAdminSession.mockImplementationOnce(async (_req: any, res: any) => {
      res.status(403).json({ error: 'Admin access required' });
      return null;
    });
    const req = reqHelper('POST', { messageId: 'm3', hide: true });
    const res = resHelper();
    await moderateHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.moderate).not.toHaveBeenCalled();
  });

  it('POST /api/chat/delete returns success when user deletes own message', async () => {
    mockService.getMessage.mockResolvedValue({ id: 'm4', senderId: 'u1', roomId: 'r1' });
    mockService.deleteMessage.mockResolvedValue({ deleted: true });
    const req = reqHelper('POST', { messageId: 'm4', userId: 'u1' });
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ deleted: true });
  });

  it('POST /api/chat/delete returns 403 when user tries to delete another user message', async () => {
    mockSession.userId = 'u2';
    mockService.getMessage.mockResolvedValue({ id: 'm5', senderId: 'u1', roomId: 'r1' });
    const req = reqHelper('POST', { messageId: 'm5', userId: 'u2' });
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'not authorized to delete this message' });
  });

  it('POST /api/chat/delete returns 404 when message not found', async () => {
    mockService.getMessage.mockResolvedValue(null);
    const req = reqHelper('POST', { messageId: 'm6', userId: 'u1' });
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'message not found' });
  });

  it('POST /api/chat/delete returns 400 when messageId is missing', async () => {
    const req = reqHelper('POST', { userId: 'u1' });
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'messageId required' });
  });

  it('POST /api/chat/delete uses the signed-in user when userId is omitted', async () => {
    mockService.getMessage.mockResolvedValue({ id: 'm7', senderId: 'u1', roomId: 'r1' });
    mockService.deleteMessage.mockResolvedValue({ deleted: true });
    const req = reqHelper('POST', { messageId: 'm7' });
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockService.deleteMessage).toHaveBeenCalledWith('m7', 'u1', false);
  });

  it('POST /api/chat/delete cannot delete another user message by claiming their ID', async () => {
    mockSession.userId = 'u2';
    mockService.getMessage.mockResolvedValue({ id: 'm8', senderId: 'u1', roomId: 'r1' });
    const req = reqHelper('POST', { messageId: 'm8', userId: 'u1' });
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.deleteMessage).not.toHaveBeenCalled();
  });

  it('POST /api/chat/reactions/add records the reaction for the signed-in user', async () => {
    mockService.addReaction.mockResolvedValue({ id: 'x1' });
    const req = reqHelper('POST', { messageId: 'm1', emoji: 'thumbs-up' });
    const res = resHelper();
    await addReactionHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockService.addReaction).toHaveBeenCalledWith({ messageId: 'm1', userId: 'u1', emoji: 'thumbs-up' });
  });

  it('POST /api/chat/reactions/add and remove refuse to act as another user', async () => {
    for (const handler of [addReactionHandler, removeReactionHandler]) {
      const req = reqHelper('POST', { messageId: 'm1', userId: 'u2', emoji: 'thumbs-up' });
      const res = resHelper();
      await handler(req as NextApiRequest, res as NextApiResponse);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mockService.addReaction).not.toHaveBeenCalled();
    expect(mockService.removeReaction).not.toHaveBeenCalled();
  });

  it('POST /api/chat/delete returns 405 for non-POST requests', async () => {
    const req = reqHelper('GET', undefined, undefined);
    const res = resHelper();
    await deleteHandler(req as NextApiRequest, res as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });
});
