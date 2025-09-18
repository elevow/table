import { GameManager } from '../game-manager';
import type { Pool } from 'pg';

// Helper to build a mock Pool with controllable SELECT collision behavior
function mockPool(selectBehavior: (attempt: number) => 'collision' | 'clear'): Pool {
  let attempt = 0;
  const pool: any = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      if (/SELECT 1 FROM game_rooms WHERE id/.test(sql)) {
        attempt++;
        if (selectBehavior(attempt) === 'collision') {
          return { rows: [{ existing: true }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/INSERT INTO game_rooms/.test(sql)) {
        return { rows: [{ id: params?.[0], name: params?.[1], game_type: params?.[2], max_players: params?.[3], blind_levels: params?.[4], created_by: params?.[5], configuration: params?.[6], status: 'waiting', created_at: new Date() }], rowCount: 1 };
      }
      if (/SELECT \* FROM game_rooms WHERE id/.test(sql)) {
        return { rows: [{ id: params?.[0], name: 'X', game_type: 'poker', max_players: 6, blind_levels: {}, created_by: null, configuration: null, status: 'waiting', created_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    })
  };
  return pool as Pool;
}

describe('GameManager room code collision handling', () => {
  it('retries on a single collision then succeeds', async () => {
    const pool = mockPool(a => (a === 1 ? 'collision' : 'clear'));
    const gm = new GameManager(pool);
    const room = await gm.createRoom({
      name: 'Retry Table',
      gameType: 'poker',
      maxPlayers: 6,
      blindLevels: {},
      createdBy: undefined,
      configuration: null,
    });
    expect(room.id).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz]{8}$/);
    // Two SELECT attempts (collision + success)
    const selectCalls = (pool.query as jest.Mock).mock.calls.filter(c => /SELECT 1 FROM game_rooms/.test(c[0]));
    expect(selectCalls.length).toBe(2);
  });

  it('throws after exhausting maxAttempts collisions', async () => {
    const pool = mockPool(() => 'collision'); // always collide
    const gm = new GameManager(pool);
    await expect(gm.createRoom({
      name: 'Fail Table',
      gameType: 'poker',
      maxPlayers: 6,
      blindLevels: {},
      createdBy: undefined,
      configuration: null,
    })).rejects.toThrow('Unable to generate unique room code');
    const selectCalls = (pool.query as jest.Mock).mock.calls.filter(c => /SELECT 1 FROM game_rooms/.test(c[0]));
    // Should attempt 5 times (maxAttempts)
    expect(selectCalls.length).toBe(5);
  });
});
