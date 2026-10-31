// Host permissions (room.*) apply only to tables the user created.
// admin.rooms.manage lets staff use every host control on any table.
import type { UserAccess } from './access-control';

export const ADMIN_TABLE_PERMISSION = 'admin.rooms.manage';

// The host controls a table offers, in the order the host panel shows them
export const HOST_PERMISSIONS = [
  'room.start',
  'room.configure',
  'room.approve_seat',
  'room.kick_player',
  'room.view_ledger',
] as const;

export interface TableAuthorization {
  allowed: boolean;
  /** Allowed only through admin.rooms.manage, so the action belongs in the admin audit log */
  asAdmin: boolean;
}

export function isTableOwner(access: UserAccess, room: { createdBy?: string | null }): boolean {
  return !!access.userId && !!room.createdBy && room.createdBy === access.userId;
}

/** Whether the user may use a host permission on this table, and whether only as an admin. */
export function canOnTable(
  access: UserAccess,
  room: { createdBy?: string | null },
  permission: string
): TableAuthorization {
  if (isTableOwner(access, room) && access.permissions.has(permission)) return { allowed: true, asAdmin: false };
  if (access.permissions.has(ADMIN_TABLE_PERMISSION)) return { allowed: true, asAdmin: true };
  return { allowed: false, asAdmin: false };
}

/** The host permissions the user can use on this table, for showing the matching controls. */
export function tableHostPermissions(access: UserAccess, room: { createdBy?: string | null }): string[] {
  return HOST_PERMISSIONS.filter(p => canOnTable(access, room, p).allowed);
}
