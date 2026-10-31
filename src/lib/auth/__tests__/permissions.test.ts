import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_ROLE_GRANTS, DEFAULT_ROLE_LIMITS, LIMIT_DEFS, LIMIT_KEYS, PERMISSION_GROUPS, PERMISSION_KEYS, isPermissionKey,
  limitReachedMessage, resolveLimits, resolvePermissions,
} from '../permissions';

describe('permission catalog', () => {
  test('keys are unique and follow resource.action', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    PERMISSION_KEYS.forEach(k => expect(k).toMatch(/^[a-z_]+(\.[a-z_]+)+$/));
    PERMISSION_GROUPS.forEach(g => expect(g.permissions.length).toBeGreaterThan(0));
  });

  test('isPermissionKey accepts catalog keys and the wildcard only', () => {
    expect(isPermissionKey('chat.send')).toBe(true);
    expect(isPermissionKey('*')).toBe(true);
    expect(isPermissionKey('chat.sendd')).toBe(false);
  });
});

describe('resolvePermissions', () => {
  test('unions role grants and ignores unknown keys', () => {
    const p = resolvePermissions(['chat.send', 'lobby.view', 'chat.send', 'not.real']);
    expect([...p].sort()).toEqual(['chat.send', 'lobby.view']);
  });

  test('the wildcard expands to every permission', () => {
    expect(resolvePermissions(['*']).size).toBe(PERMISSION_KEYS.length);
  });

  test('grant overrides add and deny overrides beat every grant, including the wildcard', () => {
    const p = resolvePermissions(['*'], [
      { permission: 'chat.send', effect: 'deny' },
    ]);
    expect(p.has('chat.send')).toBe(false);
    expect(p.has('chat.private')).toBe(true);

    const q = resolvePermissions(['lobby.view'], [{ permission: 'history.view_any', effect: 'grant' }]);
    expect(q.has('history.view_any')).toBe(true);
  });
});

describe('resolveLimits', () => {
  test('limits nothing sets are unlimited', () => {
    expect(resolveLimits([])).toEqual(Object.fromEntries(LIMIT_KEYS.map(k => [k, null])));
  });

  test('the most generous role wins, and no limit beats any number', () => {
    const limits = resolveLimits([
      { key: 'rooms.per_day', value: 10 },
      { key: 'rooms.per_day', value: 50 },
      { key: 'chat.per_minute', value: 20 },
      { key: 'chat.per_minute', value: null },
      { key: 'chat.per_minute', value: 5 },
      { key: 'not.a_limit', value: 1 },
    ]);
    expect(limits['rooms.per_day']).toBe(50);
    expect(limits['chat.per_minute']).toBeNull();
    expect(limits).not.toHaveProperty('not.a_limit');
  });

  test('a user\'s own limit replaces their roles\', even when lower', () => {
    const limits = resolveLimits(
      [{ key: 'tables.max_seated', value: 4 }, { key: 'rooms.per_day', value: 10 }],
      [{ key: 'tables.max_seated', value: 1 }, { key: 'rooms.per_day', value: null }]
    );
    expect(limits['tables.max_seated']).toBe(1);
    expect(limits['rooms.per_day']).toBeNull();
  });

  test('every limit has a message with its number', () => {
    LIMIT_DEFS.forEach(d => expect(limitReachedMessage(d.key, 7)).toMatch(/\b7\b/));
  });
});

describe('access-control.sql seed', () => {
  const sql = readFileSync(join(__dirname, '../../database/schema/access-control.sql'), 'utf8');

  // role key -> granted permissions, parsed from each seed statement
  const seeds = new Map<string, string[]>();
  for (const m of sql.matchAll(/VALUES \('([a-z_]+)',[\s\S]*?(?:unnest\(ARRAY\[([\s\S]*?)\]\)|SELECT r\.id, '\*' FROM r)/g)) {
    const keys = m[2] ? [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) : ['*'];
    seeds.set(m[1], keys);
  }

  test('seeds every built-in role', () => {
    expect([...seeds.keys()]).toEqual(['guest', 'player', 'host', 'tournament_director', 'moderator', 'admin', 'super_admin']);
  });

  test('only seeds permissions that exist in the catalog', () => {
    for (const [role, keys] of seeds) {
      const unknown = keys.filter(k => !isPermissionKey(k));
      expect({ role, unknown }).toEqual({ role, unknown: [] });
    }
  });

  test('the code fallback for guest and player matches the seed', () => {
    expect([...seeds.get('guest')!].sort()).toEqual([...DEFAULT_ROLE_GRANTS.guest].sort());
    expect([...seeds.get('player')!].sort()).toEqual([...DEFAULT_ROLE_GRANTS.player].sort());
  });

  test('seeds only known limits, and the code fallback for player matches the seed', () => {
    const block = sql.match(/INSERT INTO access_role_limits[\s\S]*?\) AS l\(/)![0];
    const rows = [...block.matchAll(/\('([a-z_]+)', '([a-z_.]+)', (NULL|\d+)\)/g)]
      .map(m => ({ role: m[1], key: m[2], value: m[3] === 'NULL' ? null : Number(m[3]) }));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(LIMIT_KEYS).toContain(r.key));
    rows.forEach(r => expect([...seeds.keys()]).toContain(r.role));
    const player = Object.fromEntries(rows.filter(r => r.role === 'player').map(r => [r.key, r.value]));
    expect(player).toEqual(DEFAULT_ROLE_LIMITS.player);
  });

  test('admin gets everything except editing roles and impersonating users', () => {
    const expected = PERMISSION_KEYS.filter(k => k !== 'roles.edit' && k !== 'admin.users.impersonate').sort();
    expect([...seeds.get('admin')!].sort()).toEqual(expected);
  });
});
