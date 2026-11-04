// Private tables: hidden from the lobby and open only to the host, players who used the room's
// invite link (its members) and staff with table.view_private. Public is the default, so rooms
// created before this existed stay public. Everything lives in game_rooms.configuration.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../database/pool';
import { getSessionUser } from '../auth/auth-utils';
import { getUserAccess, type UserAccess } from '../auth/access-control';
import { loadRoom } from './room-config';

export type RoomVisibility = 'public' | 'private';

export interface RoomPrivacyConfig {
  visibility?: RoomVisibility;
  /** Stored without the dash, e.g. K7QM2XPAHR */
  inviteCode?: string;
  /** Users who joined through the invite link */
  members?: string[];
}

/** Configuration keys only the server sets; stripped from anything a client sends. */
export const PRIVACY_KEYS = ['visibility', 'inviteCode', 'members'] as const;

export const PRIVATE_TABLE_RESPONSE = {
  error: 'This table is private. Ask the host for an invite link.',
  code: 'PRIVATE_TABLE',
} as const;

export { newInviteCode, formatInviteCode, normalizeInviteCode } from '../shared/invite-code';

function privacyOf(configuration: unknown): RoomPrivacyConfig {
  return configuration && typeof configuration === 'object' ? configuration as RoomPrivacyConfig : {};
}

export function isPrivateRoom(configuration: unknown): boolean {
  return privacyOf(configuration).visibility === 'private';
}

export function isRoomMember(configuration: unknown, userId: string | null | undefined): boolean {
  const members = privacyOf(configuration).members;
  return !!userId && Array.isArray(members) && members.includes(userId);
}

/** Whether the user may watch the table: always for public rooms. */
export function canEnterRoom(
  access: Pick<UserAccess, 'userId' | 'permissions'> | null,
  room: { createdBy?: string | null; configuration?: unknown }
): boolean {
  if (!isPrivateRoom(room.configuration)) return true;
  const userId = access?.userId;
  if (!userId) return false;
  if (room.createdBy === userId) return true;
  if (isRoomMember(room.configuration, userId)) return true;
  return !!access?.permissions.has('table.view_private');
}

/** The configuration without the invite code and member list, for anyone but the host. */
export function withoutPrivateFields<T extends Record<string, any> | null>(configuration: T): T {
  if (!configuration || typeof configuration !== 'object') return configuration;
  const { inviteCode: _code, members: _members, ...rest } = configuration;
  return rest as T;
}

/** A client-sent configuration with the server-only privacy keys removed. */
export function stripPrivacyKeys(configuration: unknown): Record<string, unknown> {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return {};
  const rest = { ...(configuration as Record<string, unknown>) };
  for (const key of PRIVACY_KEYS) delete rest[key];
  return rest;
}

/**
 * For routes that show a table: sends 403 and returns false when the room is private and the
 * caller can't enter it. A room that doesn't exist passes, so each route keeps its own not-found
 * handling; public rooms skip the session lookup.
 */
export async function guardRoomEntry(req: NextApiRequest, res: NextApiResponse, roomId: string): Promise<boolean> {
  const room = await loadRoom(roomId);
  if (!room || !isPrivateRoom(room.configuration)) return true;
  const user = await getSessionUser(req);
  if (canEnterRoom(user ? await getUserAccess(user) : null, room)) return true;
  res.status(403).json(PRIVATE_TABLE_RESPONSE);
  return false;
}

/** Add a user to a private room's members. One statement, so concurrent joins can't drop each other. */
export async function addRoomMember(roomId: string, userId: string): Promise<void> {
  await getPool().query(
    `UPDATE game_rooms
     SET configuration = jsonb_set(
       COALESCE(configuration, '{}'::jsonb),
       '{members}',
       CASE
         WHEN jsonb_typeof(configuration->'members') IS DISTINCT FROM 'array' THEN jsonb_build_array($2::text)
         WHEN configuration->'members' ? $2 THEN configuration->'members'
         ELSE (configuration->'members') || to_jsonb($2::text)
       END,
       true)
     WHERE id = $1`,
    [roomId, userId]
  );
}

export async function removeRoomMember(roomId: string, userId: string): Promise<void> {
  await getPool().query(
    `UPDATE game_rooms SET configuration = jsonb_set(configuration, '{members}', (configuration->'members') - $2::text)
     WHERE id = $1 AND jsonb_typeof(configuration->'members') = 'array'`,
    [roomId, userId]
  );
}

/** The private room an invite code opens, if any. */
export async function findRoomByInviteCode(code: string): Promise<{ id: string; name: string } | null> {
  const result = await getPool().query(
    `SELECT id, name FROM game_rooms WHERE configuration->>'visibility' = 'private' AND configuration->>'inviteCode' = $1 LIMIT 1`,
    [code]
  );
  const row = result.rows[0];
  return row ? { id: String(row.id), name: String(row.name) } : null;
}
