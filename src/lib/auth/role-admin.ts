// Shared helpers for the role-management API routes.
import { ALL_PERMISSION, PERMISSION_KEYS, isLimitKey, isPermissionKey } from './permissions';
import type { UserAccess } from './access-control';

// Roles every user has implicitly; they can't be assigned or removed per user
export const IMPLICIT_ROLES = ['guest', 'player'];

// The super admin role always keeps '*', so roles can't be edited into a lockout
export const LOCKED_PERMISSION_ROLES = ['super_admin'];

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  built_in: boolean;
}

/** Whether the actor may create, edit, assign or remove a role of this rank. */
export function canManageRank(actor: UserAccess, rank: number): boolean {
  return actor.bootstrapAdmin || rank <= actor.rank;
}

/** A role key made from its name: "Floor Manager" -> "floor_manager". */
export function roleKeyFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

/** The requested permission list, deduplicated, or an error message. */
export function parsePermissionList(value: unknown): { permissions: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'permissions must be an array' };
  const unknown = value.filter(p => typeof p !== 'string' || !isPermissionKey(p));
  if (unknown.length) return { error: `Unknown permissions: ${unknown.join(', ')}` };
  return { permissions: [...new Set(value as string[])] };
}

export interface LimitInput {
  key: string;
  /** A whole number, or null for no limit */
  value: number | null;
  reason: string | null;
}

/** A list of limits ({ key, value, reason? }), deduplicated by key, or an error message. */
export function parseLimits(value: unknown): { limits: LimitInput[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'limits must be an array' };
  const out = new Map<string, LimitInput>();
  for (const l of value) {
    if (!l || typeof l.key !== 'string' || !isLimitKey(l.key)) return { error: `Unknown limit: ${l?.key}` };
    if (l.value !== null && !(Number.isInteger(l.value) && l.value >= 0 && l.value <= 1_000_000)) {
      return { error: `${l.key} must be a whole number, or null for no limit` };
    }
    out.set(l.key, {
      key: l.key,
      value: l.value,
      reason: typeof l.reason === 'string' ? l.reason.trim().slice(0, 500) || null : null,
    });
  }
  return { limits: [...out.values()] };
}

/** Keys whose value differs between two limit lists, including keys only one list has. */
export function changedLimitKeys(
  before: Iterable<{ key: string; value: number | null }>,
  after: Iterable<{ key: string; value: number | null }>
): string[] {
  const b = new Map([...before].map(l => [l.key, l.value]));
  const a = new Map([...after].map(l => [l.key, l.value]));
  return [...new Set([...b.keys(), ...a.keys()])].filter(k => b.has(k) !== a.has(k) || b.get(k) !== a.get(k));
}

/** Permissions in the list that the actor doesn't hold, so can't hand out. */
export function permissionsBeyondActor(actor: UserAccess, permissions: string[]): string[] {
  if (actor.bootstrapAdmin) return [];
  const holdsAll = PERMISSION_KEYS.every(k => actor.permissions.has(k));
  return permissions.filter(p => (p === ALL_PERMISSION ? !holdsAll : !actor.permissions.has(p)));
}
