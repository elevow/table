import type { Pool } from 'pg';
import { ChatManager } from '../chat-manager';
import type { ChatMessageRow } from '../../../types/chat';

describe('ChatManager', () => {
  const makePool = () => {
    return { query: jest.fn() } as unknown as Pool;
  };

  const makeRow = (overrides: Partial<ChatMessageRow> = {}): ChatMessageRow => ({
    id: overrides.id ?? 'm1',
    room_id: overrides.room_id ?? 'r1',
    sender_id: overrides.sender_id ?? 'u1',
    message: overrides.message ?? 'hello',
    is_private: overrides.is_private ?? false,
    recipient_id: overrides.recipient_id ?? null,
    sent_at: overrides.sent_at ?? new Date('2025-01-01T00:00:00Z').toISOString(),
    is_moderated: overrides.is_moderated ?? false,
    moderated_at: overrides.moderated_at ?? null,
    moderator_id: overrides.moderator_id ?? null,
  });

  test('send() inserts a room message and maps result', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const row = makeRow({ is_private: false, recipient_id: null });
    query.mockResolvedValueOnce({ rows: [row] });

    const mgr = new ChatManager(pool);
    const result = await mgr.send({ roomId: 'room-1', senderId: 'user-1', message: 'hi' });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO chat_messages');
    expect(params).toEqual(['room-1', 'user-1', 'hi', false, null]);

    expect(result).toEqual({
      id: row.id,
      roomId: row.room_id,
      senderId: row.sender_id,
      message: row.message,
      isPrivate: row.is_private,
      recipientId: row.recipient_id,
      sentAt: row.sent_at,
      isModerated: row.is_moderated,
      moderatedAt: row.moderated_at,
      moderatorId: row.moderator_id,
    });
  });

  test('send() inserts a private message and maps result', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const row = makeRow({ is_private: true, room_id: null, recipient_id: 'u2' });
    query.mockResolvedValueOnce({ rows: [row] });

    const mgr = new ChatManager(pool);
    const result = await mgr.send({ senderId: 'user-1', message: 'secret', isPrivate: true, recipientId: 'user-2' });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO chat_messages');
    expect(params).toEqual([null, 'user-1', 'secret', true, 'user-2']);
    expect(result.isPrivate).toBe(true);
    expect(result.recipientId).toBe('u2');
  });

  test('send() validates required fields (senderId/message)', async () => {
    const pool = makePool();
    const mgr = new ChatManager(pool);

    await expect(mgr.send({ roomId: 'r1', senderId: '', message: 'x' } as any)).rejects.toThrow('senderId required');
    await expect(mgr.send({ roomId: 'r1', senderId: 'u1', message: '   ' })).rejects.toThrow('message required');
  });

  test('send() validates recipientId for private and roomId for room message', async () => {
    const pool = makePool();
    const mgr = new ChatManager(pool);

    await expect(
      mgr.send({ senderId: 'u1', message: 'x', isPrivate: true })
    ).rejects.toThrow('recipientId required for private message');

    await expect(
      mgr.send({ senderId: 'u1', message: 'x', isPrivate: false })
    ).rejects.toThrow('roomId required for room message');
  });

  test('listRoomMessages() queries with before=null and clamps high limit to 200', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const rows = [makeRow({ id: 'm1' }), makeRow({ id: 'm2' })];
    query.mockResolvedValueOnce({ rows });

    const mgr = new ChatManager(pool);
    const result = await mgr.listRoomMessages({ roomId: 'r1', limit: 999 });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE room_id = $1 AND is_private = FALSE');
    // params: [roomId, before, limit]
    expect(params[0]).toBe('r1');
    expect(params[1]).toBeNull();
    expect(params[2]).toBe(200);
    expect(result.map(m => m.id)).toEqual(['m1', 'm2']);
  });

  test('listRoomMessages() uses provided before and clamps low limit to 1', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const rows = [makeRow({ id: 'm3' })];
    query.mockResolvedValueOnce({ rows });

    const before = new Date('2024-12-31T23:59:59Z').toISOString();
    const mgr = new ChatManager(pool);
    await mgr.listRoomMessages({ roomId: 'r2', before, limit: 0 });

    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['r2', before, 1]);
  });

  test('listPrivateMessages() queries with symmetric participants and default limit', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const rows = [
      makeRow({ id: 'p1', is_private: true, room_id: null, sender_id: 'a', recipient_id: 'b' }),
      makeRow({ id: 'p2', is_private: true, room_id: null, sender_id: 'b', recipient_id: 'a' }),
    ];
    query.mockResolvedValueOnce({ rows });

    const mgr = new ChatManager(pool);
    const result = await mgr.listPrivateMessages({ userAId: 'a', userBId: 'b' });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE is_private = TRUE');
    // params: [userAId, userBId, before, limit]
    expect(params).toEqual(['a', 'b', null, 50]);
    expect(result.map(m => m.id)).toEqual(['p1', 'p2']);
  });

  test('listPrivateMessages() respects before and limit', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    query.mockResolvedValueOnce({ rows: [] });

    const before = new Date('2025-02-01T10:00:00Z').toISOString();
    const mgr = new ChatManager(pool);
    await mgr.listPrivateMessages({ userAId: 'x', userBId: 'y', before, limit: 10 });

    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['x', 'y', before, 10]);
  });

  test('moderate() updates row and maps result', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    const row = makeRow({ id: 'm100', is_moderated: true, moderator_id: 'mod-1', moderated_at: new Date().toISOString() });
    query.mockResolvedValueOnce({ rows: [row] });

    const mgr = new ChatManager(pool);
    const out = await mgr.moderate('m100', 'mod-1', true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE chat_messages');
    expect(params).toEqual(['m100', true, 'mod-1']);
    expect(out.isModerated).toBe(true);
    expect(out.moderatorId).toBe('mod-1');
  });

  test('moderate() throws when message not found', async () => {
    const pool = makePool();
    const query = (pool as any).query as jest.Mock;
    query.mockResolvedValueOnce({ rows: [] });

    const mgr = new ChatManager(pool);
    await expect(mgr.moderate('missing', 'mod-1', false)).rejects.toThrow('message not found');
  });
});
