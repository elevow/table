const mockQuery = jest.fn();
jest.mock('../../database/pool', () => ({ getPool: () => ({ query: (...args: unknown[]) => mockQuery(...args) }) }));

import { tableDirectorId, withSenderNames } from '../chat-senders';

const ALICE = '11111111-1111-4111-8111-111111111111';
const msg = (id: string, senderId: string) => ({
  id, roomId: 'r1', senderId, message: 'hi', isPrivate: false, recipientId: null,
  sentAt: '', isModerated: false, moderatedAt: null, moderatorId: null,
});

beforeEach(() => mockQuery.mockReset());

test('messages get their sender\'s username', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: ALICE, username: 'alice' }] });
  const [a, b] = await withSenderNames([msg('m1', ALICE), msg('m2', 'not-a-user')]);
  expect(a.senderName).toBe('alice');
  expect(b).not.toHaveProperty('senderName');
});

test('a failed name lookup still returns the messages', async () => {
  mockQuery.mockRejectedValue(new Error('down'));
  expect(await withSenderNames([msg('m1', ALICE)])).toEqual([msg('m1', ALICE)]);
});

test('a tournament table names its director; other tables have none', async () => {
  mockQuery.mockResolvedValue({ rows: [{ director: 'td-1' }] });
  expect(await tableDirectorId({ configuration: { tournamentId: 't1', tournamentTableId: 'table-1' } })).toBe('td-1');
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM tournaments'), ['t1']);
  mockQuery.mockClear();
  expect(await tableDirectorId({ configuration: { variant: 'omaha' } })).toBeNull();
  expect(await tableDirectorId(null)).toBeNull();
  expect(mockQuery).not.toHaveBeenCalled();
});
