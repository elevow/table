/**
 * @jest-environment node
 */
const mockQuery = jest.fn();
jest.mock('../../database/pool', () => ({ getPool: () => ({ query: (...args: any[]) => mockQuery(...args) }) }));

const mockSeats: Record<number, any> = {};
const mockMemorySeats = new Map<string, any>();
jest.mock('../../shared/game-seats', () => ({
  loadPersistedRoomSeats: async () => mockSeats,
  getRoomSeats: () => ({}),
  getGameSeats: () => mockMemorySeats,
}));

const mockLeaveTable = jest.fn().mockResolvedValue({ seatNumber: 1, cashedOut: 0 });
jest.mock('../seat-actions', () => ({ leaveTable: (...args: any[]) => mockLeaveTable(...args) }));

const mockEngineState: { current: any } = { current: null };
jest.mock('../../poker/engine-persistence', () => ({
  getOrRestoreEngine: async () => (mockEngineState.current ? { getState: () => mockEngineState.current } : null),
}));

import { deleteClosedTable, deleteClosedTableIfIdle, handInPlay } from '../close-table';

const res: any = {};

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  mockLeaveTable.mockClear();
  for (const k of Object.keys(mockSeats)) delete mockSeats[Number(k)];
  mockEngineState.current = null;
  const g: any = global;
  g.activeGames = new Map([['t1', {}]]);
  g.roomConfigs = new Map([['t1', {}]]);
  mockMemorySeats.set('t1', {});
});

describe('closing a table', () => {
  test('a hand is in play until its showdown, or while the dealer chooses nothing is', () => {
    expect(handInPlay(null)).toBe(false);
    expect(handInPlay({ stage: 'flop' })).toBe(true);
    expect(handInPlay({ stage: 'showdown' })).toBe(false);
    expect(handInPlay({ stage: 'awaiting-dealer-choice' })).toBe(false);
  });

  test('everyone seated stands up with their chips, then the room and its game are deleted and forgotten', async () => {
    mockSeats[1] = { playerId: 'a', playerName: 'A', chips: 120 };
    mockSeats[2] = null;
    mockSeats[4] = { playerId: 'b', playerName: 'B', chips: 80 };
    await deleteClosedTable('t1', res);
    expect(mockLeaveTable.mock.calls.map(c => c[0].playerId)).toEqual(['a', 'b']);
    expect(mockLeaveTable).toHaveBeenCalledWith(expect.objectContaining({ roomId: 't1', reason: 'table_closed' }));
    const sql = mockQuery.mock.calls.map(c => c[0]);
    expect(sql[sql.length - 1]).toMatch(/DELETE FROM game_rooms/);
    expect(sql.some(s => /DELETE FROM active_games/.test(s))).toBe(true);
    // The players' history and the night's settlement stay
    expect(sql.some(s => /hand_records|chip_ledger/.test(s))).toBe(false);
    const g: any = global;
    expect(g.activeGames.has('t1')).toBe(false);
    expect(g.roomConfigs.has('t1')).toBe(false);
    expect(mockMemorySeats.has('t1')).toBe(false);
  });

  test('a related table this database lacks does not stop the delete', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/chat_messages/.test(sql)) throw Object.assign(new Error('no such table'), { code: '42P01' });
      return { rows: [] };
    });
    await deleteClosedTable('t1', res);
    expect(mockQuery.mock.calls.some(c => /DELETE FROM game_rooms/.test(c[0]))).toBe(true);
  });

  test('a hand in play is left to finish: the table goes later', async () => {
    mockEngineState.current = { stage: 'turn' };
    expect(await deleteClosedTableIfIdle('t1', res)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    mockEngineState.current = { stage: 'showdown' };
    expect(await deleteClosedTableIfIdle('t1', res)).toBe(true);
    expect(mockQuery.mock.calls.some(c => /DELETE FROM game_rooms/.test(c[0]))).toBe(true);
  });
});
