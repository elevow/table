// Permission catalog for role-based access control.
// Shared by the server (enforcement) and the admin UI (labels and grouping), so it imports nothing.
// Role grants are stored in the database as these keys; '*' grants every permission.

export interface PermissionDef {
  key: string;
  label: string;
  description?: string;
}

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'lobby',
    label: 'Lobby & viewing',
    permissions: [
      { key: 'lobby.view', label: 'View lobby', description: 'See the list of rooms' },
      { key: 'table.view', label: 'Watch tables', description: 'Open a table as a spectator' },
      { key: 'table.view_private', label: 'See private tables', description: 'Private and invite-only tables appear in the lobby' },
      { key: 'table.view_hole_cards', label: 'See all hole cards', description: 'Every player\'s cards, for support and investigations' },
      { key: 'table.spectate_chat', label: 'Chat as a spectator' },
    ],
  },
  {
    id: 'play',
    label: 'Playing',
    permissions: [
      { key: 'table.join', label: 'Take a seat' },
      { key: 'table.join_private', label: 'Join private tables without a code' },
      { key: 'table.waitlist', label: 'Join waitlists' },
      { key: 'game.play', label: 'Act in hands' },
      { key: 'game.straddle', label: 'Straddle' },
      { key: 'game.run_it_twice', label: 'Run it twice' },
      { key: 'game.rabbit_hunt', label: 'Rabbit hunt' },
      { key: 'game.show_cards', label: 'Show cards' },
      { key: 'game.rebuy', label: 'Rebuy and add chips' },
      { key: 'game.react', label: 'Table reactions' },
    ],
  },
  {
    id: 'host',
    label: 'Hosting (own tables)',
    permissions: [
      { key: 'room.create', label: 'Create rooms' },
      { key: 'room.create_private', label: 'Create private rooms', description: 'Not used yet: there are no private rooms' },
      { key: 'room.configure', label: 'Change table settings', description: 'Blinds, bomb pots, straddles, run it twice, turn time and time banks' },
      { key: 'room.choose_variant', label: 'Create dealer\'s choice and mixed games' },
      { key: 'room.start', label: 'Pause and resume the game', description: 'Any seated player can start the game and deal' },
      { key: 'room.approve_seat', label: 'Approve who sits down' },
      { key: 'room.kick_player', label: 'Remove players' },
      { key: 'room.transfer_host', label: 'Hand over host', description: 'Not used yet: hosts can\'t hand over yet' },
      { key: 'room.view_ledger', label: 'View the ledger', description: 'Players always see the ledger of tables they played at' },
      { key: 'room.edit_ledger', label: 'Correct the ledger', description: 'Not used yet: the ledger can\'t be edited yet' },
    ],
  },
  {
    id: 'tournament',
    label: 'Tournaments',
    permissions: [
      { key: 'tournament.view', label: 'View tournaments' },
      { key: 'tournament.register', label: 'Register for tournaments' },
      { key: 'tournament.create', label: 'Create tournaments' },
      { key: 'tournament.manage', label: 'Run tournaments', description: 'Start, pause, resume, advance levels, end breaks' },
      { key: 'tournament.eliminate', label: 'Eliminate players' },
      { key: 'tournament.payouts', label: 'Set payouts' },
      { key: 'tournament.report', label: 'View tournament reports' },
    ],
  },
  {
    id: 'social',
    label: 'Chat & social',
    permissions: [
      { key: 'chat.send', label: 'Table chat' },
      { key: 'chat.private', label: 'Private messages' },
      { key: 'chat.delete_own', label: 'Delete own messages' },
      { key: 'chat.delete_any', label: 'Delete anyone\'s messages' },
      { key: 'chat.moderate', label: 'Hide messages and mute users' },
      { key: 'friends.use', label: 'Friends and invites' },
      { key: 'profile.upload_avatar', label: 'Upload an avatar' },
      { key: 'avatar.moderate', label: 'Remove other users\' avatars' },
    ],
  },
  {
    id: 'history',
    label: 'History & stats',
    permissions: [
      { key: 'history.view_own', label: 'Own hand history' },
      { key: 'history.view_any', label: 'Anyone\'s hand history' },
      { key: 'history.export', label: 'Export hand history' },
      { key: 'stats.hud', label: 'HUD and stats overlay' },
      { key: 'stats.view_others', label: 'Other players\' stats' },
      { key: 'rit.verify', label: 'Verify run it twice' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin & moderation',
    permissions: [
      { key: 'admin.access', label: 'Open the admin area' },
      { key: 'admin.rooms.view', label: 'View all rooms and room stats' },
      { key: 'admin.rooms.manage', label: 'Close or delete any room' },
      { key: 'admin.users.view', label: 'Look up users' },
      { key: 'admin.users.ban', label: 'Ban users' },
      { key: 'admin.users.suspend', label: 'Suspend users' },
      { key: 'admin.users.reset_password', label: 'Reset passwords' },
      { key: 'admin.users.impersonate', label: 'View as a user', description: 'High risk; every use is logged' },
      { key: 'admin.chips.adjust', label: 'Adjust chip balances' },
      { key: 'admin.alerts.view', label: 'View security alerts' },
      { key: 'admin.alerts.resolve', label: 'Acknowledge and resolve alerts' },
      { key: 'admin.security.config', label: 'Security settings and scheduler' },
      { key: 'admin.audit_log.view', label: 'View the admin audit log' },
      { key: 'admin.announcements', label: 'Site-wide announcements' },
    ],
  },
  {
    id: 'roles',
    label: 'Roles',
    permissions: [
      { key: 'roles.view', label: 'View roles and assignments' },
      { key: 'roles.assign', label: 'Assign roles', description: 'Only roles ranked at or below your own' },
      { key: 'roles.edit', label: 'Create and edit roles' },
    ],
  },
];

export const ALL_PERMISSION = '*';

export const PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

const KEY_SET = new Set(PERMISSION_KEYS);

const LABELS = new Map(PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => [p.key, p.label] as const)));

export function permissionLabel(key: string): string {
  return LABELS.get(key) ?? key;
}

/**
 * The seeded grants of the implicit roles, mirroring access-control.sql.
 * Used when the role tables can't be read, so the game keeps working before they are migrated.
 */
export const DEFAULT_ROLE_GRANTS: Record<'guest' | 'player', string[]> = {
  guest: ['lobby.view', 'table.view', 'tournament.view'],
  player: [
    'lobby.view', 'table.view', 'table.spectate_chat',
    'table.join', 'table.waitlist', 'game.play', 'game.straddle', 'game.run_it_twice',
    'game.rabbit_hunt', 'game.show_cards', 'game.rebuy', 'game.react',
    'room.create', 'room.create_private', 'room.configure', 'room.choose_variant', 'room.start',
    'room.approve_seat', 'room.kick_player', 'room.transfer_host', 'room.view_ledger',
    'tournament.view', 'tournament.register',
    'chat.send', 'chat.private', 'chat.delete_own', 'friends.use', 'profile.upload_avatar',
    'history.view_own', 'history.export', 'stats.hud', 'stats.view_others', 'rit.verify',
  ],
};

export interface LimitDef {
  key: string;
  label: string;
  description?: string;
  /** The message shown when the limit is reached; {n} is the limit */
  reached: string;
}

// Numeric limits set per role, and per user to make exceptions. null means no limit.
export const LIMIT_DEFS: LimitDef[] = [
  {
    key: 'rooms.per_day',
    label: 'Rooms created per day',
    description: 'Counted over the last 24 hours',
    reached: 'You can create up to {n} rooms a day',
  },
  {
    key: 'tables.max_seated',
    label: 'Tables at once',
    description: 'Seats held at different tables at the same time',
    reached: 'You can sit at up to {n} tables at once',
  },
  {
    key: 'chat.per_minute',
    label: 'Chat messages per minute',
    description: 'Table chat and private messages together',
    reached: 'You can send up to {n} chat messages a minute',
  },
];

export const LIMIT_KEYS: string[] = LIMIT_DEFS.map(l => l.key);

export function isLimitKey(key: string): boolean {
  return LIMIT_KEYS.includes(key);
}

export type Limits = Record<string, number | null>;

/** The seeded limits of the implicit roles, mirroring access-control.sql. */
export const DEFAULT_ROLE_LIMITS: Record<'guest' | 'player', Limits> = {
  guest: {},
  player: { 'rooms.per_day': 10, 'tables.max_seated': 4, 'chat.per_minute': 20 },
};

/**
 * Effective limits from role limits and per-user limits. A user's own limit wins; otherwise the
 * most generous of their roles applies (no limit beats any number). Limits nothing sets are unlimited.
 */
export function resolveLimits(
  roleLimits: Iterable<{ key: string; value: number | null }>,
  userLimits: Iterable<{ key: string; value: number | null }> = []
): Limits {
  const fromRoles = new Map<string, number | null>();
  for (const { key, value } of roleLimits) {
    if (!isLimitKey(key)) continue;
    const prev = fromRoles.get(key);
    if (prev === undefined) fromRoles.set(key, value);
    else if (prev !== null) fromRoles.set(key, value === null ? null : Math.max(prev, value));
  }
  const own = new Map<string, number | null>();
  for (const { key, value } of userLimits) if (isLimitKey(key)) own.set(key, value);
  const limits: Limits = {};
  for (const key of LIMIT_KEYS) {
    limits[key] = own.has(key) ? own.get(key)! : fromRoles.get(key) ?? null;
  }
  return limits;
}

/** The message for a reached limit. */
export function limitReachedMessage(key: string, n: number): string {
  const def = LIMIT_DEFS.find(l => l.key === key);
  return (def?.reached ?? `Limit reached: ${key} ({n})`).replace('{n}', String(n));
}

export function isPermissionKey(key: string): boolean {
  return key === ALL_PERMISSION || KEY_SET.has(key);
}

export type OverrideEffect = 'grant' | 'deny';

/**
 * Effective permissions from role grants and per-user overrides.
 * A deny override beats every grant, including '*'.
 */
export function resolvePermissions(
  roleGrants: Iterable<string>,
  overrides: Iterable<{ permission: string; effect: OverrideEffect }> = []
): Set<string> {
  const granted = new Set<string>();
  for (const key of roleGrants) {
    if (key === ALL_PERMISSION) PERMISSION_KEYS.forEach(k => granted.add(k));
    else if (KEY_SET.has(key)) granted.add(key);
  }
  const denied: string[] = [];
  for (const o of overrides) {
    if (!KEY_SET.has(o.permission)) continue;
    if (o.effect === 'grant') granted.add(o.permission);
    else denied.push(o.permission);
  }
  denied.forEach(k => granted.delete(k));
  return granted;
}
