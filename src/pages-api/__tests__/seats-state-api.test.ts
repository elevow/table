import type { NextApiRequest, NextApiResponse } from 'next';

const mockQuery = jest.fn();
jest.mock('../../lib/database/pool', () => ({
  getPool: jest.fn(() => ({ query: mockQuery })),
}));

import handler from '../../../pages/api/games/seats/state';
import { getGameSeats } from '../../lib/shared/game-seats';

describe('/api/games/seats/state', () => {
  beforeEach(() => {
    getGameSeats().clear();
    mockQuery.mockReset();
  });

  it('returns persisted seat assignments when this instance has an empty cache', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ configuration: { seats: { 1: { playerId: 'player-1', playerName: 'Player One', chips: 1000 } } } }],
    });
    const req = { method: 'GET', query: { tableId: 'room-1' } } as Partial<NextApiRequest>;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as Partial<NextApiResponse>;

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      seats: expect.objectContaining({
        1: { playerId: 'player-1', playerName: 'Player One', chips: 1000 },
        2: null,
      }),
    }));
  });
});