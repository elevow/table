import { GameManager } from '../game-manager';
import type { Pool } from 'pg';

// Minimal mock Pool
function createMockPool(overrides: Partial<Pool> = {}): Pool {
  const calls: any[] = [];
  const pool: any = {
    __calls: calls,
    query: jest.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      if (/SELECT 1 FROM game_rooms WHERE id/.test(sql)) {
        return { rows: [], rowCount: 0 }; // no collision
      }
      if (/INSERT INTO game_rooms/.test(sql)) {
        return { rows: [{ id: params?.[0], name: params?.[1], game_type: params?.[2], max_players: params?.[3], blind_levels: params?.[4], created_by: params?.[5], configuration: params?.[6], status: 'waiting', created_at: new Date() }], rowCount: 1 };
      }
      if (/SELECT \* FROM game_rooms WHERE id/.test(sql)) {
        return { rows: [{ id: params?.[0], name: 'X', game_type: 'poker', max_players: 6, blind_levels: {}, created_by: null, configuration: null, status: 'waiting', created_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    ...overrides,
  };
  return pool as Pool;
}

describe('GameManager room code generation', () => {
  it('creates room with 8-char alphanumeric id', async () => {
    const pool = createMockPool();
    const gm = new GameManager(pool);
    const room = await gm.createRoom({
      name: 'Test Table',
      gameType: 'poker',
      maxPlayers: 6,
      blindLevels: {},
      createdBy: '00000000-0000-0000-0000-000000000001', // invalid -> stored as null
      configuration: null,
    });
    expect(room.id).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz]{8}$/);
    expect(room.status).toBe('waiting');
  });

  it('getRoomById returns mapped record', async () => {
    const pool = createMockPool();
    const gm = new GameManager(pool);
    const rec = await gm.getRoomById('ABCDEFGH');
    expect(rec?.id).toBe('ABCDEFGH');
    expect(rec?.gameType).toBe('poker');
  });
});
