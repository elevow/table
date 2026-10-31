import type { NextApiRequest, NextApiResponse } from 'next';
import { PERMISSION_KEYS } from '../../lib/auth/permissions';

// Every query, through the pool or a checked-out client, goes to mockQuery
const mockQuery = jest.fn();
jest.mock('../../lib/database/pool', () => ({
  getPool: () => ({
    query: (...args: any[]) => mockQuery(...args),
    connect: async () => ({ query: (...args: any[]) => mockQuery(...args), release: jest.fn() }),
  }),
}));

const mockActor: { current: any } = { current: null };
const mockTarget: { current: any } = { current: null };
const mockLog = jest.fn();
const mockClearCache = jest.fn();
jest.mock('../../lib/auth/access-control', () => ({
  requirePermission: async (_req: any, res: any, permission: string) => {
    if (!mockActor.current.permissions.has(permission)) {
      res.status(403).json({ error: 'Permission required', permission });
      return null;
    }
    return mockActor.current;
  },
  requirePlayerAccess: async () => mockActor.current,
  hasPermission: (access: any, permission: string) => access.permissions.has(permission),
  sendPermissionDenied: (res: any, permission: string) => res.status(403).json({ error: 'Permission required', permission }),
  getUserAccess: async () => mockTarget.current,
  logAdminAction: (...args: any[]) => mockLog(...args),
  clearAccessCache: (...args: any[]) => mockClearCache(...args),
}));

import rolesHandler from '../../../pages/api/admin/roles/index';
import roleHandler from '../../../pages/api/admin/roles/[id]';
import userAccessHandler from '../../../pages/api/admin/users/[id]/access';
import sanctionHandler from '../../../pages/api/admin/users/[id]/sanction';

function actor(rank: number, permissions: string[], bootstrapAdmin = false) {
  return { userId: 'actor', email: 'a@example.com', roles: [], rank, permissions: new Set(permissions), bootstrapAdmin };
}

function makeReq(method: string, body?: any, query: Record<string, string> = {}): NextApiRequest {
  return { method, body, query, headers: {}, cookies: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as NextApiResponse & { status: jest.Mock; json: jest.Mock };
}

const ROLES = [
  { id: 'r-player', key: 'player', rank: 10 },
  { id: 'r-host', key: 'host', rank: 20 },
  { id: 'r-mod', key: 'moderator', rank: 40 },
  { id: 'r-admin', key: 'admin', rank: 80 },
  { id: 'r-super', key: 'super_admin', rank: 100 },
];

beforeEach(() => {
  mockQuery.mockReset();
  mockLog.mockReset();
  mockClearCache.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('POST /api/admin/roles', () => {
  test('creates a role with a key made from its name and logs it', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('INSERT INTO access_roles')
        ? { rows: [{ id: 'new', key: 'floor_manager', name: 'Floor Manager', description: null, rank: 25, built_in: false }] }
        : { rows: [] }
    );
    const res = makeRes();
    await rolesHandler(makeReq('POST', { name: 'Floor Manager', rank: 25, permissions: ['chat.moderate'] }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    const insert = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO access_roles'));
    expect(insert![1][0]).toBe('floor_manager');
    expect(mockLog).toHaveBeenCalledWith('actor', 'role.create', 'role', 'new', expect.objectContaining({ key: 'floor_manager' }));
  });

  test('requires roles.edit', async () => {
    mockActor.current = actor(80, ['roles.view', 'roles.assign']);
    const res = makeRes();
    await rolesHandler(makeReq('POST', { name: 'X' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('rejects a rank above the actor\'s own', async () => {
    mockActor.current = actor(50, ['roles.edit']);
    const res = makeRes();
    await rolesHandler(makeReq('POST', { name: 'Boss', rank: 90 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('rejects unknown permissions and permissions the actor lacks', async () => {
    mockActor.current = actor(90, ['roles.edit', 'chat.send']);
    const bad = makeRes();
    await rolesHandler(makeReq('POST', { name: 'A', permissions: ['nope.nope'] }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    const beyond = makeRes();
    await rolesHandler(makeReq('POST', { name: 'B', permissions: ['chat.send', 'admin.chips.adjust'] }), beyond);
    expect(beyond.status).toHaveBeenCalledWith(403);
    expect(beyond.json.mock.calls[0][0].error).toContain('admin.chips.adjust');
  });
});

describe('PATCH/DELETE /api/admin/roles/[id]', () => {
  const role = (over: any = {}) => ({ id: 'r1', key: 'host', name: 'Host', description: null, rank: 20, built_in: true, ...over });

  test('replaces permissions by adding and removing the difference', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM access_roles WHERE id::text')) return { rows: [role()] };
      if (sql.includes('SELECT permission FROM access_role_permissions')) return { rows: [{ permission: 'room.create' }, { permission: 'room.edit_ledger' }] };
      if (sql.includes('UPDATE access_roles')) return { rows: [role()] };
      return { rows: [] };
    });
    const res = makeRes();
    await roleHandler(makeReq('PATCH', { permissions: ['room.create', 'room.kick_player'] }, { id: 'r1' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockLog).toHaveBeenCalledWith('actor', 'role.update', 'role', 'r1',
      expect.objectContaining({ added: ['room.kick_player'], removed: ['room.edit_ledger'] }));
    // Everyone holding the role is affected, so the whole cache goes
    expect(mockClearCache).toHaveBeenCalledWith();
  });

  test('grants of permissions removed from the catalog are cleared without the holder check', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM access_roles WHERE id::text')) return { rows: [role()] };
      if (sql.includes('SELECT permission FROM access_role_permissions')) return { rows: [{ permission: 'room.create' }, { permission: 'room.next_hand' }] };
      if (sql.includes('UPDATE access_roles')) return { rows: [role()] };
      return { rows: [] };
    });
    const res = makeRes();
    await roleHandler(makeReq('PATCH', { permissions: ['room.create'] }, { id: 'r1' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const del = mockQuery.mock.calls.find(c => String(c[0]).startsWith('DELETE FROM access_role_permissions'));
    expect(del![1]).toEqual(['r1', ['room.next_hand']]);
  });

  test('super admin permissions are locked', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS, true);
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM access_roles WHERE id::text') ? { rows: [role({ key: 'super_admin', name: 'Super Admin', rank: 100 })] } : { rows: [] }
    );
    const res = makeRes();
    await roleHandler(makeReq('PATCH', { permissions: [] }, { id: 'r1' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('cannot change a role ranked above the actor', async () => {
    mockActor.current = actor(80, ['roles.edit']);
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM access_roles WHERE id::text') ? { rows: [role({ rank: 100 })] } : { rows: [] }
    );
    const res = makeRes();
    await roleHandler(makeReq('PATCH', { name: 'Mine now' }, { id: 'r1' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('replaces a role\'s limits when they change', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM access_roles WHERE id::text')) return { rows: [role({ key: 'player', rank: 10 })] };
      if (sql.includes('SELECT limit_key, value FROM access_role_limits')) return { rows: [{ limit_key: 'rooms.per_day', value: 10 }] };
      if (sql.includes('UPDATE access_roles')) return { rows: [role()] };
      return { rows: [] };
    });
    const res = makeRes();
    const limits = [{ key: 'rooms.per_day', value: 5 }, { key: 'chat.per_minute', value: null }];
    await roleHandler(makeReq('PATCH', { limits }, { id: 'r1' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const inserts = mockQuery.mock.calls.filter(c => String(c[0]).startsWith('INSERT INTO access_role_limits')).map(c => c[1]);
    expect(inserts).toEqual([['r1', 'rooms.per_day', 5], ['r1', 'chat.per_minute', null]]);
    expect(mockLog).toHaveBeenCalledWith('actor', 'role.update', 'role', 'r1', expect.objectContaining({ limits }));
  });

  test('rejects unknown limits and values that aren\'t whole numbers', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM access_roles WHERE id::text') ? { rows: [role()] } : { rows: [] }
    );
    for (const limits of [[{ key: 'nope', value: 1 }], [{ key: 'rooms.per_day', value: 1.5 }], [{ key: 'rooms.per_day', value: -1 }], 'x']) {
      const res = makeRes();
      await roleHandler(makeReq('PATCH', { limits }, { id: 'r1' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  test('built-in roles cannot be deleted; custom roles can', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM access_roles WHERE id::text') ? { rows: [role()] } : { rows: [] }
    );
    const builtIn = makeRes();
    await roleHandler(makeReq('DELETE', undefined, { id: 'r1' }), builtIn);
    expect(builtIn.status).toHaveBeenCalledWith(400);

    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM access_roles WHERE id::text') ? { rows: [role({ built_in: false, key: 'floor' })] } : { rows: [] }
    );
    const custom = makeRes();
    await roleHandler(makeReq('DELETE', undefined, { id: 'r1' }), custom);
    expect(custom.status).toHaveBeenCalledWith(200);
    expect(mockQuery.mock.calls.some(c => String(c[0]).startsWith('DELETE FROM access_roles'))).toBe(true);
  });
});

describe('PUT /api/admin/users/[id]/access', () => {
  function userDb(currentRoles: string[] = [], currentOverrides: any[] = []) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users WHERE id::text')) return { rows: [{ id: 'u2', email: 'p@example.com' }] };
      if (sql.includes('SELECT id, key, rank FROM access_roles')) return { rows: ROLES };
      if (sql.includes('FROM access_user_roles ur JOIN access_roles')) return { rows: currentRoles.map(key => ({ key })) };
      if (sql.includes('SELECT permission, effect FROM access_user_overrides')) return { rows: currentOverrides };
      return { rows: [] };
    });
  }
  const player = { userId: 'u2', roles: ['player'], rank: 10, permissions: new Set<string>(), bootstrapAdmin: false };

  test('an admin can make someone a moderator', async () => {
    mockActor.current = actor(80, ['roles.assign', 'chat.moderate']);
    mockTarget.current = player;
    userDb();
    const res = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: ['moderator', 'player'] }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const insert = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO access_user_roles'));
    expect(insert![1]).toEqual(['u2', ['r-mod'], 'actor']);
    expect(mockLog).toHaveBeenCalledWith('actor', 'user.access.update', 'user', 'u2', { addedRoles: ['moderator'] });
    expect(mockClearCache).toHaveBeenCalledWith('u2');
  });

  test('cannot assign a role ranked above the actor', async () => {
    mockActor.current = actor(80, ['roles.assign']);
    mockTarget.current = player;
    userDb();
    const res = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: ['super_admin'] }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('INSERT INTO access_user_roles'))).toBe(false);
  });

  test('cannot change a user ranked above the actor', async () => {
    mockActor.current = actor(40, ['roles.assign']);
    mockTarget.current = { ...player, rank: 80 };
    userDb(['admin']);
    const res = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: [] }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('ADMIN_EMAILS users can only be changed by another ADMIN_EMAILS user', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS);
    mockTarget.current = { ...player, rank: Number.MAX_SAFE_INTEGER, bootstrapAdmin: true };
    userDb();
    const res = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: [] }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('overrides can only cover permissions the actor holds', async () => {
    mockActor.current = actor(80, ['roles.assign', 'chat.send']);
    mockTarget.current = player;
    userDb();
    const ok = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: [], overrides: [{ permission: 'chat.send', effect: 'deny', reason: 'spam' }] }, { id: 'u2' }), ok);
    expect(ok.status).toHaveBeenCalledWith(200);
    const insert = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO access_user_overrides'));
    expect(insert![1]).toEqual(['u2', 'chat.send', 'deny', 'spam', 'actor']);

    const beyond = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: [], overrides: [{ permission: 'roles.edit', effect: 'grant' }] }, { id: 'u2' }), beyond);
    expect(beyond.status).toHaveBeenCalledWith(403);
  });

  test('sets the user\'s own limits', async () => {
    mockActor.current = actor(80, ['roles.assign']);
    mockTarget.current = player;
    userDb();
    const res = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: [], limits: [{ key: 'tables.max_seated', value: 8, reason: 'pro' }] }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const insert = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO access_user_limits'));
    expect(insert![1]).toEqual(['u2', 'tables.max_seated', 8, 'pro', 'actor']);
    expect(mockLog).toHaveBeenCalledWith('actor', 'user.access.update', 'user', 'u2',
      { limits: [{ key: 'tables.max_seated', value: 8, reason: 'pro' }] });
  });

  test('rejects malformed input', async () => {
    mockActor.current = actor(100, PERMISSION_KEYS, true);
    mockTarget.current = player;
    userDb();
    const res = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: 'admin' }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    const res2 = makeRes();
    await userAccessHandler(makeReq('PUT', { roles: [], overrides: [{ permission: 'chat.send', effect: 'maybe' }] }, { id: 'u2' }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });
});

describe('POST/DELETE /api/admin/users/[id]/sanction', () => {
  const player = { userId: 'u2', roles: ['player'], rank: 10, permissions: new Set<string>(), bootstrapAdmin: false };
  const moderator = () => actor(40, ['admin.users.suspend']);
  const admin = () => actor(80, ['admin.users.suspend', 'admin.users.ban']);
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  function sanctionDb(active: { id: string; kind: string }[] = []) {
    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM users WHERE id::text')) return { rows: [{ id: 'u2', email: 'p@example.com' }] };
      if (sql.includes('SELECT id, kind FROM access_user_sanctions')) return { rows: active };
      if (sql.includes('INSERT INTO access_user_sanctions')) return { rows: [{ kind: params[1], reason: params[2], until: params[3] }] };
      return { rows: [] };
    });
  }
  const ran = (prefix: string) => mockQuery.mock.calls.filter(c => String(c[0]).trim().startsWith(prefix));

  test('a moderator can suspend a player until a date; it is audited and clears their cached access', async () => {
    mockActor.current = moderator();
    mockTarget.current = player;
    sanctionDb();
    const until = tomorrow();
    const res = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'suspend', until, reason: ' tilt ' }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ran('INSERT INTO access_user_sanctions')[0][1]).toEqual(['u2', 'suspend', 'tilt', new Date(until), 'actor']);
    expect(ran('DELETE FROM auth_tokens')).toHaveLength(0);
    expect(mockClearCache).toHaveBeenCalledWith('u2');
    expect(mockLog).toHaveBeenCalledWith('actor', 'user.suspend', 'user', 'u2', { reason: 'tilt', until });
  });

  test('a suspension needs an end date in the future', async () => {
    mockActor.current = moderator();
    mockTarget.current = player;
    sanctionDb();
    for (const body of [{ kind: 'suspend' }, { kind: 'suspend', until: '2001-01-01' }, { kind: 'suspend', until: 'soon' }, { kind: 'mute' }]) {
      const res = makeRes();
      await sanctionHandler(makeReq('POST', body, { id: 'u2' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  test('banning needs admin.users.ban, and signs the user out', async () => {
    mockActor.current = moderator();
    mockTarget.current = player;
    sanctionDb();
    const denied = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'ban' }, { id: 'u2' }), denied);
    expect(denied.status).toHaveBeenCalledWith(403);

    mockActor.current = admin();
    const res = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'ban' }, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sanction: { kind: 'ban', reason: null, until: null } });
    expect(ran('DELETE FROM auth_tokens')[0][1]).toEqual(['u2']);
  });

  test('a new sanction replaces the active one, but a moderator can\'t replace or lift a ban', async () => {
    mockActor.current = moderator();
    mockTarget.current = player;
    sanctionDb([{ id: 's1', kind: 'ban' }]);
    const replace = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'suspend', until: tomorrow() }, { id: 'u2' }), replace);
    expect(replace.status).toHaveBeenCalledWith(403);
    const lift = makeRes();
    await sanctionHandler(makeReq('DELETE', undefined, { id: 'u2' }), lift);
    expect(lift.status).toHaveBeenCalledWith(403);
    expect(ran('UPDATE access_user_sanctions')).toHaveLength(0);

    mockActor.current = admin();
    const ok = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'suspend', until: tomorrow() }, { id: 'u2' }), ok);
    expect(ok.status).toHaveBeenCalledWith(200);
    expect(ran('UPDATE access_user_sanctions')[0][1]).toEqual([['s1'], 'actor']);
    expect(mockLog).toHaveBeenCalledWith('actor', 'user.suspend', 'user', 'u2', expect.objectContaining({ replaced: ['ban'] }));
  });

  test('lifting ends the active sanction, and says so when there is none', async () => {
    mockActor.current = moderator();
    mockTarget.current = player;
    sanctionDb([{ id: 's1', kind: 'suspend' }]);
    const res = makeRes();
    await sanctionHandler(makeReq('DELETE', undefined, { id: 'u2' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ran('UPDATE access_user_sanctions')[0][1]).toEqual([['s1'], 'actor']);
    expect(mockLog).toHaveBeenCalledWith('actor', 'user.sanction.lift', 'user', 'u2', { lifted: ['suspend'] });

    sanctionDb();
    const none = makeRes();
    await sanctionHandler(makeReq('DELETE', undefined, { id: 'u2' }), none);
    expect(none.status).toHaveBeenCalledWith(404);
  });

  test('staff can only sanction users ranked below them, never themselves or ADMIN_EMAILS users', async () => {
    mockActor.current = moderator();
    sanctionDb();
    mockTarget.current = { ...player, rank: 40 };
    const peer = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'suspend', until: tomorrow() }, { id: 'u2' }), peer);
    expect(peer.status).toHaveBeenCalledWith(403);

    mockActor.current = actor(100, PERMISSION_KEYS, true);
    mockTarget.current = { ...player, rank: Number.MAX_SAFE_INTEGER, bootstrapAdmin: true };
    const boss = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'ban' }, { id: 'u2' }), boss);
    expect(boss.status).toHaveBeenCalledWith(403);

    const self = makeRes();
    await sanctionHandler(makeReq('POST', { kind: 'ban' }, { id: 'actor' }), self);
    expect(self.status).toHaveBeenCalledWith(400);
    expect(ran('INSERT INTO access_user_sanctions')).toHaveLength(0);
  });
});
