// Mock pg module to avoid TextEncoder issues in jsdom
jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

import { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/check-turn';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';

jest.mock('../../../src/lib/poker/engine-persistence');

describe('/api/games/check-turn', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    statusMock = jest.fn().mockReturnThis();
    jsonMock = jest.fn();
    req = {
      method: 'GET',
      query: {}
    };
    res = {
      status: statusMock,
      json: jsonMock
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-GET requests', async () => {
    req.method = 'POST';

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(405);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('should return 400 when tableId is missing', async () => {
    req.query = { playerId: 'player1' };

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Missing tableId or playerId' });
  });

  it('should return 400 when playerId is missing', async () => {
    req.query = { tableId: 'table1' };

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Missing tableId or playerId' });
  });

  it('should return 404 when no active game is found', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue(null);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'No active game found for this table' });
  });

  it('should return 404 when engine has no getState method', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue({});

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'No active game found for this table' });
  });

  it('should return turn status when it is the player\'s turn', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    const mockEngine = {
      getState: jest.fn().mockReturnValue({
        activePlayer: 'player1',
        stage: 'preflop',
        handNumber: 5
      })
    };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue(mockEngine);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      isMyTurn: true,
      activePlayer: 'player1',
      tableState: 'preflop',
      handNumber: 5
    });
  });

  it('should return turn status when it is NOT the player\'s turn', async () => {
    req.query = { tableId: 'table1', playerId: 'player2' };
    const mockEngine = {
      getState: jest.fn().mockReturnValue({
        activePlayer: 'player1',
        stage: 'flop',
        handNumber: 3
      })
    };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue(mockEngine);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      isMyTurn: false,
      activePlayer: 'player1',
      tableState: 'flop',
      handNumber: 3
    });
  });

  it('should return handNumber as 0 when not present in state', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    const mockEngine = {
      getState: jest.fn().mockReturnValue({
        activePlayer: 'player1',
        stage: 'waiting'
      })
    };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue(mockEngine);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      isMyTurn: true,
      activePlayer: 'player1',
      tableState: 'waiting',
      handNumber: 0
    });
  });

  it('should handle errors gracefully', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockRejectedValue(new Error('Database error'));

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Database error' });
  });

  it('should handle non-Error exceptions', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockRejectedValue('String error');

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});
