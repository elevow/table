import { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../../../pages/api/games/seats/stand';
import * as GameSeats from '../../../shared/game-seats';
import * as publisher from '../../../realtime/publisher';

// Mock the publisher module
jest.mock('../../../realtime/publisher', () => ({
  publishSeatState: jest.fn().mockResolvedValue(undefined),
  publishSeatVacated: jest.fn().mockResolvedValue(undefined),
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
}));

describe('/api/games/seats/stand', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // Clear game seats before each test
    GameSeats.getGameSeats().clear();
    
    // Mock request and response
    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    
    req = {
      method: 'POST',
      body: {},
    };
    
    res = {
      status: statusMock,
      setHeader: jest.fn(),
    } as any;
    
    // Clear mocks
    jest.clearAllMocks();
  });

  test('returns 405 for non-POST requests', async () => {
    req.method = 'GET';
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(statusMock).toHaveBeenCalledWith(405);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Method Not Allowed' });
  });

  test('returns 400 when tableId is missing', async () => {
    req.body = { playerId: 'player1' };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Missing required fields' });
  });

  test('returns 400 when playerId is missing', async () => {
    req.body = { tableId: 'table1' };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Missing required fields' });
  });

  test('returns 404 when table not found', async () => {
    req.body = { tableId: 'nonexistent', playerId: 'player1' };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Table not found' });
  });

  test('returns 404 when player is not seated', async () => {
    const tableId = 'table1';
    GameSeats.initializeRoomSeats(tableId);
    
    req.body = { tableId, playerId: 'player1' };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Player not seated' });
  });

  test("returns 403 when trying to vacate another player's seat", async () => {
    const tableId = 'table1';
    GameSeats.initializeRoomSeats(tableId);
    GameSeats.claimSeat(tableId, 3, { playerId: 'player1', playerName: 'Alice', chips: 100 });
    
    req.body = { tableId, seatNumber: 3, playerId: 'player2' };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Not your seat' });
  });

  test('successfully vacates a seat on first request', async () => {
    const tableId = 'table1';
    const playerId = 'player1';
    const seatNumber = 3;
    
    GameSeats.initializeRoomSeats(tableId);
    GameSeats.claimSeat(tableId, seatNumber, { playerId, playerName: 'Alice', chips: 100 });
    
    req.body = { tableId, seatNumber, playerId };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ ok: true, seatNumber, playerId });
    
    // Verify seat is now null
    const seats = GameSeats.getRoomSeats(tableId);
    expect(seats[seatNumber]).toBeNull();
  });

  test('returns success when trying to vacate an already empty seat (idempotent)', async () => {
    const tableId = 'table1';
    const playerId = 'player1';
    const seatNumber = 3;
    
    GameSeats.initializeRoomSeats(tableId);
    GameSeats.claimSeat(tableId, seatNumber, { playerId, playerName: 'Alice', chips: 100 });
    
    req.body = { tableId, seatNumber, playerId };
    
    // First stand request
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ ok: true, seatNumber, playerId });
    
    // Clear mocks for second request
    jest.clearAllMocks();
    
    // Second stand request (should be idempotent)
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ ok: true, seatNumber, playerId, alreadyVacated: true });
    
    // Verify seat is still null
    const seats = GameSeats.getRoomSeats(tableId);
    expect(seats[seatNumber]).toBeNull();
  });

  test('finds seat automatically when seatNumber not provided', async () => {
    const tableId = 'table1';
    const playerId = 'player1';
    const seatNumber = 5;
    
    GameSeats.initializeRoomSeats(tableId);
    GameSeats.claimSeat(tableId, seatNumber, { playerId, playerName: 'Alice', chips: 100 });
    
    // Don't provide seatNumber
    req.body = { tableId, playerId };
    
    await handler(req as NextApiRequest, res as NextApiResponse);
    
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ ok: true, seatNumber, playerId });
    
    // Verify seat is now null
    const seats = GameSeats.getRoomSeats(tableId);
    expect(seats[seatNumber]).toBeNull();
  });

  test('multiple stand requests do not cause errors (idempotent operation)', async () => {
    const tableId = 'table1';
    const playerId = 'player1';
    const seatNumber = 3;
    
    GameSeats.initializeRoomSeats(tableId);
    GameSeats.claimSeat(tableId, seatNumber, { playerId, playerName: 'Alice', chips: 100 });
    
    req.body = { tableId, seatNumber, playerId };
    
    // First request
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(statusMock).toHaveBeenCalledWith(200);
    
    // Second request
    jest.clearAllMocks();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ ok: true, seatNumber, playerId, alreadyVacated: true });
    
    // Third request
    jest.clearAllMocks();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ ok: true, seatNumber, playerId, alreadyVacated: true });
  });
});
