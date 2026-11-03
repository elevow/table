/**
 * @jest-environment node
 */
const mockQueries: Array<{ sql: string; params?: unknown[] }> = [];
let mockMissingRooms = new Set<string>();
const mockClient = {
  query: async (sql: string, params?: unknown[]) => {
    mockQueries.push({ sql, params });
    const missing = sql.startsWith('UPDATE') && mockMissingRooms.has(String(params?.[0]));
    return { rows: sql.startsWith('UPDATE') && !missing ? [{ seats: { 1: null } }] : [] };
  },
  release: jest.fn(),
};
jest.mock('../../database/pool', () => ({
  getPool: () => ({ query: mockClient.query, connect: async () => mockClient }),
}));

import { leaveSeat, moveSeat, takeSeat } from '../room-seats';

const seat = { playerId: 'u1', playerName: 'Ann', chips: 500 };

beforeEach(() => {
  mockQueries.length = 0;
  mockMissingRooms = new Set();
});

test('taking a seat is one statement that also makes the player a member', async () => {
  await takeSeat('room-1', 3, seat);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].sql).toContain("'{members}'");
  expect(mockQueries[0].params).toEqual(['room-1', 'u1', '3', JSON.stringify(seat)]);
});

test('leaving is one statement', async () => {
  await leaveSeat('room-1', 'u1');
  expect(mockQueries.map(q => q.sql.split(' ')[0])).toEqual(['UPDATE']);
});

test('a move locks both rooms, leaves one and takes a seat in the other in one transaction', async () => {
  await moveSeat('room-b', 'room-a', 2, seat);
  const steps = mockQueries.map(q => q.sql.trim().split(/\s/)[0]);
  expect(steps).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'UPDATE', 'COMMIT']);
  expect(mockQueries[1].sql).toContain('ORDER BY id FOR UPDATE');
  expect(mockQueries[2].params?.[0]).toBe('room-b');
  expect(mockQueries[3].params?.[0]).toBe('room-a');
});

test('a move to a room that is gone is undone, leaving the player where they were', async () => {
  mockMissingRooms.add('gone');
  await expect(moveSeat('room-b', 'gone', 2, seat)).rejects.toThrow('not found');
  expect(mockQueries.map(q => q.sql.trim().split(/\s/)[0])).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'UPDATE', 'ROLLBACK']);
});
