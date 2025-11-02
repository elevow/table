import type { NextApiRequest, NextApiResponse } from 'next';

import createRoomHandler from '../../../pages/api/games/rooms/create';
import listRoomsHandler from '../../../pages/api/games/rooms/list';
import startHandler from '../../../pages/api/games/active/start';
import updateHandler from '../../../pages/api/games/active/update';
import endHandler from '../../../pages/api/games/active/end';
import byRoomHandler from '../../../pages/api/games/active/by-room';

// Mock pg Pool and rate limiter
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockService: any = {
  createRoom: jest.fn(),
  listRooms: jest.fn(),
  startGame: jest.fn(),
  updateActiveGame: jest.fn(),
  endGame: jest.fn(),
  getActiveGameByRoom: jest.fn(),
};

jest.mock('../../../src/lib/services/game-service', () => ({
  GameService: jest.fn().mockImplementation(() => mockService)
}));

// Mock auth to always return a valid user id
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requireAuth: jest.fn().mockResolvedValue('test-user-id')
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

describe('Games API routes (US-020)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/games/rooms/create', async () => {
    const payload = { id: 'r1', name: 'T1', status: 'waiting' } as any;
    mockService.createRoom.mockResolvedValue(payload);
    const req = createReq('POST', { name: 'T1', gameType: 'NLH', maxPlayers: 6, blindLevels: {}, createdBy: 'u1' });
    const res = createRes();
    await createRoomHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  test('GET /api/games/rooms/list', async () => {
    const data = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } as any;
    mockService.listRooms.mockResolvedValue(data);
    const req = createReq('GET', undefined, { page: '1', limit: '20' });
    const res = createRes();
    await listRoomsHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  test('POST /api/games/active/start', async () => {
    const game = { id: 'g1', roomId: 'r1' } as any;
    mockService.startGame.mockResolvedValue(game);
    const req = createReq('POST', { roomId: 'r1', dealerPosition: 0, currentPlayerPosition: 1 });
    const res = createRes();
    await startHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(game);
  });

  test('POST /api/games/active/update', async () => {
    const updated = { id: 'g1', currentHandId: 'h1' } as any;
    mockService.updateActiveGame.mockResolvedValue(updated);
    const req = createReq('POST', { id: 'g1', currentHandId: 'h1' });
    const res = createRes();
    await updateHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  test('POST /api/games/active/end', async () => {
    mockService.endGame.mockResolvedValue(undefined);
    const req = createReq('POST', { id: 'g1' });
    const res = createRes();
    await endHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('GET /api/games/active/by-room', async () => {
    const game = { id: 'g1', roomId: 'r1' } as any;
    mockService.getActiveGameByRoom.mockResolvedValue(game);
    const req = createReq('GET', undefined, { roomId: 'r1' });
    const res = createRes();
    await byRoomHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(game);
  });
});
