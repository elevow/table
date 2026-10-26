// Mock pg module to avoid TextEncoder issues in jsdom
jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

import { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/games/check-turn';
import * as enginePersistence from '../../../src/lib/poker/engine-persistence';

jest.mock('../../../src/lib/poker/engine-persistence');
// Signed in as player1; a claimed playerId is passed through as the session user
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: jest.fn(async (_req: unknown, _res: unknown, claimed?: unknown) => (claimed ? String(claimed) : 'player1')),
}));
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

describe('/api/games/check-turn', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    statusMock = jest.fn().mockReturnThis();
    jsonMock = jest.fn();
    setHeaderMock = jest.fn();
    req = {
      method: 'GET',
      query: {}
    };
    res = {
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock
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

  it('should answer for the signed-in player when playerId is omitted', async () => {
    req.query = { tableId: 'table1' };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue({
      getState: () => ({ activePlayer: 'player1', stage: 'flop' }),
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ isMyTurn: true }));
  });

  it('should not answer when the caller is not signed in', async () => {
    req.query = { tableId: 'table1', playerId: 'player1' };
    (requirePlayer as jest.Mock).mockImplementationOnce(async (_req: unknown, r: NextApiResponse) => {
      r.status(401).json({ error: 'Authentication required' });
      return null;
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(enginePersistence.getOrRestoreEngine).not.toHaveBeenCalled();
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

    expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate');
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      isMyTurn: true,
      activePlayer: 'player1',
      tableState: 'preflop',
      handNumber: 5,
      paused: false,
      turnSeq: 0,
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
      handNumber: 3,
      paused: false,
      turnSeq: 0,
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
      handNumber: 0,
      paused: false,
      turnSeq: 0,
    });
  });

  it('reports a pause and the turn number so a client that missed them refreshes', async () => {
    req.query = { tableId: 'table1', playerId: 'player2' };
    const mockEngine = {
      getState: jest.fn().mockReturnValue({ activePlayer: 'player1', stage: 'turn', paused: true, turnSeq: 12 }),
    };
    (enginePersistence.getOrRestoreEngine as jest.Mock).mockResolvedValue(mockEngine);

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ paused: true, turnSeq: 12 }));
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
