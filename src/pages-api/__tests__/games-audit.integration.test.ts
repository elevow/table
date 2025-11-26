import type { NextApiRequest, NextApiResponse } from 'next';

// Handlers under test
import byRoomHandler from '../../../pages/api/games/active/by-room';
import createRoomHandler from '../../../pages/api/games/rooms/create';

// Prepare shared mocks
const poolInstance: any = { __tag: 'pool' };

// Mock the pool module to avoid requiring database environment variables
jest.mock('../../../src/lib/database/pool', () => ({
  getPool: jest.fn(() => poolInstance)
}));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockService: any = {
  getActiveGameByRoom: jest.fn(),
  createRoom: jest.fn(),
};

jest.mock('../../../src/lib/services/game-service', () => ({
  GameService: jest.fn().mockImplementation(() => mockService)
}));

// Mock auth to always return a valid user id for create route
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requireAuth: jest.fn().mockResolvedValue('u100')
}));

// Mock the audit helper and capture calls end-to-end
const mockSafeLog = jest.fn().mockResolvedValue(undefined);
const mockCreateSafeAudit = jest.fn().mockReturnValue(mockSafeLog);

jest.mock('../../../src/lib/api/audit', () => ({
  createSafeAudit: (...args: any[]) => (mockCreateSafeAudit as any)(...args)
}));

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, query?: any, headers?: Record<string, string>): Partial<NextApiRequest> {
  return {
    method,
    query,
    headers: headers || {},
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

describe('Games API audit integration (by-room)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/games/active/by-room invokes audit helper with expected args', async () => {
    // Arrange: service returns a game, caller provides user id
    const game = { id: 'g1', roomId: 'r1' } as any;
    mockService.getActiveGameByRoom.mockResolvedValue(game);
    const req = createReq('GET', { roomId: 'r1' }, { 'x-user-id': 'u1', 'user-agent': 'jest-test' });
    const res = createRes();

    // Act
    await byRoomHandler(req as any, res as any);

    // Assert response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(game);

    // Assert audit helper wiring
    expect(mockCreateSafeAudit).toHaveBeenCalledTimes(1);
    expect(mockCreateSafeAudit).toHaveBeenCalledWith(poolInstance);

    // safeLog called once with userId, resource, action, success, metadata
    expect(mockSafeLog).toHaveBeenCalledTimes(1);
    expect(mockSafeLog).toHaveBeenCalledWith(
      'u1',
      'games',
      'read',
      true,
      expect.objectContaining({
        endpoint: '/api/games/active/by-room',
        roomId: 'r1',
        userAgent: 'jest-test',
        ip: '127.0.0.1'
      })
    );
  });

  test('POST /api/games/rooms/create (error path) invokes audit with success=false and reason', async () => {
    // Arrange: force createRoom to fail
    mockService.createRoom.mockRejectedValue(new Error('validation failed'));
    const req = createReq('POST', { name: 'T1' }, { 'x-user-id': 'u99', 'user-agent': 'jest-UA' });
    const res = createRes();

    // Act
    await createRoomHandler(req as any, res as any);

    // Assert response
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'validation failed' });

    // Audit assertions
    expect(mockCreateSafeAudit).toHaveBeenCalledTimes(1);
    expect(mockCreateSafeAudit).toHaveBeenCalledWith(poolInstance);
    expect(mockSafeLog).toHaveBeenCalledTimes(1);
    expect(mockSafeLog).toHaveBeenCalledWith(
      'u99',
      'games',
      'create',
      false,
      expect.objectContaining({
        endpoint: '/api/games/rooms/create',
        userAgent: 'jest-UA',
        ip: '127.0.0.1',
        reason: 'validation failed'
      })
    );
  });

  test('POST /api/games/rooms/create (success path) does NOT call audit', async () => {
    // Arrange: createRoom succeeds
    const created = { id: 'room-1', name: 'T1' } as any;
    mockService.createRoom.mockResolvedValue(created);
    const req = createReq('POST', undefined, { 'x-user-id': 'u100', 'user-agent': 'jest-UA' });
    (req as any).body = { name: 'T1' };
    const res = createRes();

    // Act
    await createRoomHandler(req as any, res as any);

    // Assert response
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);

    // Audit helper is constructed but not used on success
    expect(mockCreateSafeAudit).toHaveBeenCalledTimes(1);
    expect(mockCreateSafeAudit).toHaveBeenCalledWith(poolInstance);
    expect(mockSafeLog).not.toHaveBeenCalled();
  });

  test('GET /api/games/active/by-room (no game) logs success=false with reason=forbidden for authenticated user', async () => {
    // Arrange: service returns null to simulate not visible/forbidden
    mockService.getActiveGameByRoom.mockResolvedValue(null);
    const req = createReq('GET', { roomId: 'r2' }, { 'x-user-id': 'u2', 'user-agent': 'jest-UA' });
    const res = createRes();

    // Act
    await byRoomHandler(req as any, res as any);

    // Assert response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(null);

    // Audit assertions
    expect(mockCreateSafeAudit).toHaveBeenCalledTimes(1);
    expect(mockCreateSafeAudit).toHaveBeenCalledWith(poolInstance);
    expect(mockSafeLog).toHaveBeenCalledTimes(1);
    expect(mockSafeLog).toHaveBeenCalledWith(
      'u2',
      'games',
      'read',
      false,
      expect.objectContaining({
        endpoint: '/api/games/active/by-room',
        roomId: 'r2',
        userAgent: 'jest-UA',
        ip: '127.0.0.1',
        reason: 'forbidden'
      })
    );
  });

  test('GET /api/games/active/by-room (spectator, no game) logs success=false with reason=unauthorized', async () => {
    // Arrange: no x-user-id header and no game available
    mockService.getActiveGameByRoom.mockResolvedValue(null);
    const req = createReq('GET', { roomId: 'r3' }, { 'user-agent': 'jest-UA' });
    const res = createRes();

    // Act
    await byRoomHandler(req as any, res as any);

    // Assert response
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(null);

    // Audit assertions: userId defaults to anonymous constant
    expect(mockCreateSafeAudit).toHaveBeenCalledTimes(1);
    expect(mockCreateSafeAudit).toHaveBeenCalledWith(poolInstance);
    expect(mockSafeLog).toHaveBeenCalledTimes(1);
    expect(mockSafeLog).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000000',
      'games',
      'read',
      false,
      expect.objectContaining({
        endpoint: '/api/games/active/by-room',
        roomId: 'r3',
        userAgent: 'jest-UA',
        ip: '127.0.0.1',
        as: 'spectator',
        reason: 'unauthorized'
      })
    );
  });
});
