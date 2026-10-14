import { NextApiRequest, NextApiResponse } from 'next';

// Simulate a signed-in caller whose session matches the playerId they send
const mockRequirePlayer = jest.fn(async (_req: any, _res: any, claimed?: unknown) => (claimed ? String(claimed) : 'player1'));
jest.mock('../../../auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...args),
}));

jest.mock('../../../realtime/publisher', () => ({
  publishSeatClaimed: jest.fn().mockResolvedValue(undefined),
  publishSeatState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../shared/rebuy-limit', () => ({
  fetchRoomRebuyLimit: jest.fn().mockResolvedValue('unlimited'),
}));

jest.mock('../../../shared/buyin-amount', () => ({
  fetchRoomBuyIn: jest.fn().mockResolvedValue(500),
}));

import handler from '../../../../../pages/api/games/seats/claim';
import * as GameSeats from '../../../shared/game-seats';

describe('/api/games/seats/claim', () => {
  let res: Partial<NextApiResponse>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    GameSeats.getGameSeats().clear();
    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    res = {
      status: statusMock as unknown as NextApiResponse['status'],
      setHeader: jest.fn() as unknown as NextApiResponse['setHeader'],
    };
  });

  test('seats the player with the room buy-in, ignoring a client-sent chip count', async () => {
    const req = {
      method: 'POST',
      body: { tableId: 'claim-table-1', seatNumber: 2, playerId: 'player1', playerName: 'Alice', chips: 1000000 },
    } as unknown as NextApiRequest;

    await handler(req, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ chips: 500 }));
    expect(GameSeats.getRoomSeats('claim-table-1')[2]).toEqual({ playerId: 'player1', playerName: 'Alice', chips: 500 });
  });

  test('does not claim a seat when the caller is not authenticated', async () => {
    mockRequirePlayer.mockImplementationOnce(async (_req: any, response: any) => {
      response.status(401).json({ error: 'Authentication required' });
      return null;
    });
    const req = {
      method: 'POST',
      body: { tableId: 'claim-table-2', seatNumber: 2, playerId: 'player1', playerName: 'Alice' },
    } as unknown as NextApiRequest;

    await handler(req, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(GameSeats.getRoomSeats('claim-table-2')[2]).toBeUndefined();
  });
});
