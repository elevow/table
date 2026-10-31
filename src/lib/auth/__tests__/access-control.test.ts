import type { NextApiRequest, NextApiResponse } from 'next';

const mockQuery = jest.fn();
jest.mock('../../database/pool', () => ({
  getPool: () => ({ query: (...args: any[]) => mockQuery(...args) }),
}));

import { getUserAccess, requirePermission, logAdminAction, clearAccessCache, BOOTSTRAP_RANK } from '../access-control';
import { DEFAULT_ROLE_GRANTS, DEFAULT_ROLE_LIMITS, PERMISSION_KEYS } from '../permissions';

function makeReq(headers: Record<string, string> = {}): NextApiRequest {
  return { method: 'GET', headers, cookies: {}, query: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as NextApiResponse & { status: jest.Mock; json: jest.Mock };
}

// Routes the session lookup and the access query (roles, overrides, limits, sanctions) to canned rows
function mockDb(opts: {
  session?: { id: string; email: string | null } | null;
  roleRows?: { key: string; rank: number; permission: string | null }[];
  overrides?: { permission: string; effect: string }[];
  roleLimits?: { key: string; limit: string; value: number | null }[];
  userLimits?: { limit: string; value: number | null }[];
  sanctions?: { kind: string; until: string | null; reason: string | null }[];
}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('auth_tokens')) return { rows: opts.session ? [opts.session] : [] };
    if (sql.includes('access_roles')) {
      return {
        rows: [
          ...(opts.roleRows ?? []).map(r => ({ kind: 'role', key: r.key, rank: r.rank, item: r.permission })),
          ...(opts.roleLimits ?? []).map(l => ({ kind: 'role_limit', key: l.key, rank: 0, item: l.limit, value: l.value })),
          ...(opts.overrides ?? []).map(o => ({ kind: 'override', item: o.permission, effect: o.effect })),
          ...(opts.userLimits ?? []).map(l => ({ kind: 'user_limit', item: l.limit, value: l.value })),
          ...(opts.sanctions ?? []).map(s => ({ kind: 'sanction', item: s.kind, until: s.until, reason: s.reason })),
        ],
      };
    }
    return { rows: [] };
  });
}

const accessQueries = () => mockQuery.mock.calls.filter(c => String(c[0]).includes('access_roles')).length;

describe('access control', () => {
  const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'boss@example.com';
    mockQuery.mockReset();
    consoleError.mockClear();
    clearAccessCache();
  });

  afterAll(() => {
    process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
    consoleError.mockRestore();
  });

  test('signed-out visitors get the guest role', async () => {
    mockDb({ roleRows: [{ key: 'guest', rank: 0, permission: 'lobby.view' }] });
    const access = await getUserAccess(null);
    expect(access.roles).toEqual(['guest']);
    expect([...access.permissions]).toEqual(['lobby.view']);
    expect(mockQuery.mock.calls[0][1]).toEqual([null, 'guest']);
  });

  test('signed-in users combine player with their extra roles and overrides in one query', async () => {
    mockDb({
      roleRows: [
        { key: 'player', rank: 10, permission: 'chat.send' },
        { key: 'player', rank: 10, permission: 'lobby.view' },
        { key: 'moderator', rank: 40, permission: 'chat.moderate' },
      ],
      overrides: [
        { permission: 'chat.send', effect: 'deny' },
        { permission: 'history.view_any', effect: 'grant' },
      ],
    });
    const access = await getUserAccess({ id: 'u1', email: 'mod@example.com' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1', 'player']);
    expect(access.roles.sort()).toEqual(['moderator', 'player']);
    expect(access.rank).toBe(40);
    expect([...access.permissions].sort()).toEqual(['chat.moderate', 'history.view_any', 'lobby.view']);
    expect(access.bootstrapAdmin).toBe(false);
  });

  test('ADMIN_EMAILS users get every permission, and overrides cannot remove any', async () => {
    mockDb({ overrides: [{ permission: 'roles.edit', effect: 'deny' }] });
    const access = await getUserAccess({ id: 'u9', email: 'Boss@Example.com' });
    expect(access.bootstrapAdmin).toBe(true);
    expect(access.rank).toBe(BOOTSTRAP_RANK);
    expect(access.permissions.size).toBe(PERMISSION_KEYS.length);
  });

  test('when the role tables cannot be read, users fall back to the default grants', async () => {
    mockQuery.mockRejectedValue(new Error('relation "access_roles" does not exist'));
    const admin = await getUserAccess({ id: 'u9', email: 'boss@example.com' });
    expect(admin.permissions.has('roles.edit')).toBe(true);
    const player = await getUserAccess({ id: 'u1', email: 'p@example.com' });
    expect([...player.permissions].sort()).toEqual([...DEFAULT_ROLE_GRANTS.player].sort());
    const guest = await getUserAccess(null);
    expect([...guest.permissions].sort()).toEqual([...DEFAULT_ROLE_GRANTS.guest].sort());
  });

  test('limits come from the most generous role unless the user has their own', async () => {
    mockDb({
      roleRows: [{ key: 'player', rank: 10, permission: 'chat.send' }, { key: 'host', rank: 20, permission: null }],
      roleLimits: [
        { key: 'player', limit: 'rooms.per_day', value: 10 },
        { key: 'host', limit: 'rooms.per_day', value: null },
        { key: 'player', limit: 'tables.max_seated', value: 4 },
      ],
      userLimits: [{ limit: 'tables.max_seated', value: 1 }],
    });
    const access = await getUserAccess({ id: 'u1', email: null });
    expect(access.roles.sort()).toEqual(['host', 'player']);
    expect(access.limits['rooms.per_day']).toBeNull();
    expect(access.limits['tables.max_seated']).toBe(1);
    expect(access.limits['chat.per_minute']).toBeNull();
  });

  test('a suspended or banned user keeps only what signed-out visitors can do, and is told why', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    mockDb({
      session: { id: 'u1', email: 'p@example.com' },
      roleRows: [{ key: 'moderator', rank: 40, permission: 'chat.moderate' }, { key: 'player', rank: 10, permission: 'chat.send' }],
      sanctions: [{ kind: 'suspend', until, reason: 'Spamming chat' }],
    });
    const access = await getUserAccess({ id: 'u1', email: 'p@example.com' });
    expect([...access.permissions].sort()).toEqual([...DEFAULT_ROLE_GRANTS.guest].sort());
    expect(access.sanction).toEqual({ kind: 'suspend', until, reason: 'Spamming chat' });

    clearAccessCache();
    const res = makeRes();
    await expect(requirePermission(makeReq({ authorization: 'Bearer t' }), res, 'chat.moderate')).resolves.toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: 'PERMISSION_DENIED',
      error: expect.stringMatching(/^Your account is suspended until \d{4}-\d\d-\d\d \d\d:\d\d UTC: Spamming chat$/),
      sanction: { kind: 'suspend' },
    });
  });

  test('a ban outranks a suspension', async () => {
    mockDb({
      sanctions: [
        { kind: 'suspend', until: new Date(Date.now() + 3_600_000).toISOString(), reason: null },
        { kind: 'ban', until: null, reason: 'Cheating' },
      ],
    });
    const access = await getUserAccess({ id: 'u1', email: null });
    expect(access.sanction).toEqual({ kind: 'ban', until: null, reason: 'Cheating' });
  });

  test('ADMIN_EMAILS users can\'t be banned or limited', async () => {
    mockDb({
      roleLimits: [{ key: 'player', limit: 'rooms.per_day', value: 1 }],
      userLimits: [{ limit: 'chat.per_minute', value: 0 }],
      sanctions: [{ kind: 'ban', until: null, reason: null }],
    });
    const access = await getUserAccess({ id: 'u9', email: 'boss@example.com' });
    expect(access.sanction).toBeNull();
    expect(access.permissions.size).toBe(PERMISSION_KEYS.length);
    expect(Object.values(access.limits).every(v => v === null)).toBe(true);
  });

  test('the fallback uses the default limits too', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const player = await getUserAccess({ id: 'u1', email: null });
    expect(player.limits).toMatchObject(DEFAULT_ROLE_LIMITS.player);
    expect(player.sanction).toBeNull();
  });

  test('fallback results are not cached, so access recovers once the tables exist', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await getUserAccess({ id: 'u1', email: null });
    mockDb({ roleRows: [{ key: 'player', rank: 10, permission: 'chat.send' }] });
    const access = await getUserAccess({ id: 'u1', email: null });
    expect([...access.permissions]).toEqual(['chat.send']);
  });

  test('access is cached per user until cleared', async () => {
    mockDb({ roleRows: [{ key: 'player', rank: 10, permission: 'chat.send' }] });
    await getUserAccess({ id: 'u1', email: null });
    await getUserAccess({ id: 'u1', email: null });
    expect(accessQueries()).toBe(1);

    await getUserAccess({ id: 'u2', email: null });
    expect(accessQueries()).toBe(2);

    clearAccessCache('u1');
    await getUserAccess({ id: 'u1', email: null });
    expect(accessQueries()).toBe(3);

    clearAccessCache();
    await getUserAccess({ id: 'u2', email: null });
    expect(accessQueries()).toBe(4);
  });

  test('cached access expires after a few seconds', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      mockDb({ roleRows: [{ key: 'player', rank: 10, permission: 'chat.send' }] });
      await getUserAccess({ id: 'u1', email: null });
      now.mockReturnValue(1_000_000 + 30_000);
      await getUserAccess({ id: 'u1', email: null });
      expect(accessQueries()).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  describe('requirePermission', () => {
    test('responds 401 without a session', async () => {
      mockDb({ session: null });
      const res = makeRes();
      await expect(requirePermission(makeReq({ authorization: 'Bearer t' }), res, 'admin.access')).resolves.toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('responds 403 naming the missing permission', async () => {
      mockDb({ session: { id: 'u1', email: 'p@example.com' }, roleRows: [{ key: 'player', rank: 10, permission: 'chat.send' }] });
      const res = makeRes();
      await expect(requirePermission(makeReq({ authorization: 'Bearer t' }), res, 'admin.rooms.view')).resolves.toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "You don't have permission for this: View all rooms and room stats",
        code: 'PERMISSION_DENIED',
        permission: 'admin.rooms.view',
      });
    });

    test('returns the access of a user holding the permission', async () => {
      mockDb({ session: { id: 'u1', email: 'm@example.com' }, roleRows: [{ key: 'moderator', rank: 40, permission: 'admin.rooms.view' }] });
      const res = makeRes();
      const access = await requirePermission(makeReq({ authorization: 'Bearer t' }), res, 'admin.rooms.view');
      expect(access?.userId).toBe('u1');
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  test('logAdminAction never throws', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    await expect(logAdminAction('u1', 'role.update', 'role', 'r1', { a: 1 })).resolves.toBeUndefined();
  });
});
