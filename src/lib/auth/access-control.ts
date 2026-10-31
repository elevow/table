import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../database/pool';
import { isAdminEmail } from '../../utils/roleUtils';
import { getSessionUser } from './auth-utils';
import {
  ALL_PERMISSION, DEFAULT_ROLE_GRANTS, DEFAULT_ROLE_LIMITS, Limits, OverrideEffect, limitReachedMessage,
  permissionLabel, resolveLimits, resolvePermissions,
} from './permissions';

// Rank given to ADMIN_EMAILS users, above any role so they can always manage roles
export const BOOTSTRAP_RANK = Number.MAX_SAFE_INTEGER;

// Game routes check permissions on every action, so access is cached briefly per user.
// Role changes clear this server's cache at once; other servers pick them up within the TTL.
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { access: UserAccess; expires: number }>();

export interface UserAccess {
  userId: string | null;
  email: string | null;
  /** Role keys, including the implicit 'player' (signed in) or 'guest' (signed out) */
  roles: string[];
  /** Highest rank among the user's roles */
  rank: number;
  permissions: Set<string>;
  /** Listed in ADMIN_EMAILS, which always grants every permission */
  bootstrapAdmin: boolean;
  /** Numeric limits by key (see LIMIT_DEFS); null means no limit */
  limits: Limits;
  /** An active ban or suspension, which leaves only what signed-out visitors can do */
  sanction: Sanction | null;
}

export interface Sanction {
  kind: 'ban' | 'suspend';
  /** ISO time it ends, or null for a ban with no end */
  until: string | null;
  reason: string | null;
}

export function hasPermission(access: UserAccess, permission: string): boolean {
  return access.permissions.has(permission);
}

/** A user's limit, or null when they have none. */
export function getLimit(access: UserAccess, key: string): number | null {
  return access.limits[key] ?? null;
}

/** "suspended until 2026-11-02 14:00 UTC", "banned" */
export function describeSanction(sanction: Sanction): string {
  const verb = sanction.kind === 'ban' ? 'banned' : 'suspended';
  const until = sanction.until ? ` until ${new Date(sanction.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
  return `Your account is ${verb}${until}${sanction.reason ? `: ${sanction.reason}` : ''}`;
}

/** Forget cached access for one user, or for everyone (after a role's permissions change). */
export function clearAccessCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Roles and effective permissions for a user, or for a signed-out visitor when user is null.
 * If the role tables can't be read, users fall back to the default Player or Guest grants.
 */
export async function getUserAccess(user: { id: string; email: string | null } | null): Promise<UserAccess> {
  const cacheKey = user ? user.id : '';
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now() && cached.access.email === (user?.email ?? null)) {
    return cached.access;
  }

  const implicitRole = user ? 'player' : 'guest';
  const bootstrapAdmin = !!user?.email && isAdminEmail(user.email);
  const roles = new Set<string>([implicitRole]);
  const grants: string[] = [];
  const overrides: { permission: string; effect: OverrideEffect }[] = [];
  const roleLimits: { key: string; value: number | null }[] = [];
  const userLimits: { key: string; value: number | null }[] = [];
  let sanction: Sanction | null = null;
  let rank = 0;
  let loaded = false;

  if (bootstrapAdmin) {
    roles.add('super_admin');
    grants.push(ALL_PERMISSION);
    rank = BOOTSTRAP_RANK;
  }

  try {
    // Everything that decides access in one round trip; kind says which table each row is from
    const { rows } = await getPool().query(
      `WITH my_roles AS (
         SELECT id, key, rank FROM access_roles
         WHERE key = $2 OR id IN (SELECT role_id FROM access_user_roles WHERE user_id = $1)
       )
       SELECT 'role' AS kind, r.key, r.rank, rp.permission AS item, NULL::text AS effect,
              NULL::integer AS value, NULL::timestamptz AS until, NULL::text AS reason
       FROM my_roles r LEFT JOIN access_role_permissions rp ON rp.role_id = r.id
       UNION ALL
       SELECT 'role_limit', r.key, r.rank, l.limit_key, NULL, l.value, NULL, NULL
       FROM my_roles r JOIN access_role_limits l ON l.role_id = r.id
       UNION ALL
       SELECT 'override', NULL, NULL, permission, effect, NULL, NULL, NULL
       FROM access_user_overrides WHERE user_id = $1
       UNION ALL
       SELECT 'user_limit', NULL, NULL, limit_key, NULL, value, NULL, NULL
       FROM access_user_limits WHERE user_id = $1
       UNION ALL
       SELECT 'sanction', NULL, NULL, kind, NULL, NULL, until, reason
       FROM access_user_sanctions
       WHERE user_id = $1 AND lifted_at IS NULL AND (until IS NULL OR until > NOW())`,
      [user?.id ?? null, implicitRole]
    );
    for (const row of rows) {
      const value = row.value === null || row.value === undefined ? null : Number(row.value);
      switch (row.kind) {
        case 'role':
          roles.add(row.key);
          rank = Math.max(rank, Number(row.rank) || 0);
          if (row.item) grants.push(row.item);
          break;
        case 'role_limit':
          roleLimits.push({ key: row.item, value });
          break;
        case 'override':
          if (row.effect === 'grant' || row.effect === 'deny') overrides.push({ permission: row.item, effect: row.effect });
          break;
        case 'user_limit':
          userLimits.push({ key: row.item, value });
          break;
        case 'sanction': {
          const next: Sanction = {
            kind: row.item === 'ban' ? 'ban' : 'suspend',
            until: row.until ? new Date(row.until).toISOString() : null,
            reason: row.reason ?? null,
          };
          // A ban outranks a suspension; between two of a kind, the later end wins
          if (!sanction || (next.kind === 'ban' && sanction.kind !== 'ban')
            || (next.kind === sanction.kind && (!next.until || (sanction.until && next.until > sanction.until)))) {
            sanction = next;
          }
          break;
        }
      }
    }
    loaded = true;
  } catch (error) {
    console.error('Error loading user access:', error);
    grants.push(...DEFAULT_ROLE_GRANTS[implicitRole]);
    roleLimits.push(...Object.entries(DEFAULT_ROLE_LIMITS[implicitRole]).map(([key, value]) => ({ key, value })));
  }

  // Overrides, limits and sanctions don't apply to ADMIN_EMAILS users, so they can't be locked out
  if (bootstrapAdmin) sanction = null;
  const permissions = sanction
    ? resolvePermissions(DEFAULT_ROLE_GRANTS.guest)
    : resolvePermissions(grants, bootstrapAdmin ? [] : overrides);
  const limits = bootstrapAdmin ? resolveLimits([]) : resolveLimits(roleLimits, userLimits);
  const access: UserAccess = {
    userId: user?.id ?? null,
    email: user?.email ?? null,
    roles: [...roles],
    rank,
    permissions,
    bootstrapAdmin,
    limits,
    sanction,
  };
  if (loaded) cache.set(cacheKey, { access, expires: Date.now() + CACHE_TTL_MS });
  return access;
}

/** Access for the caller of an API route; signed-out callers get the guest role. */
export async function getRequestAccess(req: NextApiRequest): Promise<UserAccess> {
  return getUserAccess(await getSessionUser(req));
}

/**
 * The 403 response for a missing permission, naming it so the UI can explain.
 * Given the caller's access, a banned or suspended caller is told that instead.
 */
export function sendPermissionDenied(res: NextApiResponse, permission: string, access?: UserAccess): void {
  const sanction = access?.sanction;
  res.status(403).json({
    error: sanction ? describeSanction(sanction) : `You don't have permission for this: ${permissionLabel(permission)}`,
    code: 'PERMISSION_DENIED',
    permission,
    ...(sanction ? { sanction } : {}),
  });
}

/** The 403 response for a reached limit. */
export function sendLimitReached(res: NextApiResponse, key: string, limit: number, detail?: string): void {
  res.status(403).json({
    error: `${limitReachedMessage(key, limit)}${detail ? `. ${detail}` : ''}`,
    code: 'LIMIT_REACHED',
    limit: key,
    max: limit,
  });
}

/**
 * Require a signed-in caller holding a permission.
 * Returns their access, or sends 401/403 and returns null.
 */
export async function requirePermission(
  req: NextApiRequest,
  res: NextApiResponse,
  permission: string
): Promise<(UserAccess & { userId: string }) | null> {
  return requireAnyPermission(req, res, [permission]);
}

/** Like requirePermission, but any one of the permissions will do; a denial names the first. */
export async function requireAnyPermission(
  req: NextApiRequest,
  res: NextApiResponse,
  permissions: string[]
): Promise<(UserAccess & { userId: string }) | null> {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const access = await getUserAccess(user);
  if (!permissions.some(p => hasPermission(access, p))) {
    sendPermissionDenied(res, permissions[0], access);
    return null;
  }
  return access as UserAccess & { userId: string };
}

/**
 * Like requirePlayer, but returns the caller's access for routes that check several permissions
 * or table ownership. Sends 401/403 and returns null when signed out or acting as someone else.
 */
export async function requirePlayerAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  claimedPlayerId?: unknown
): Promise<(UserAccess & { userId: string }) | null> {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  if (claimedPlayerId != null && claimedPlayerId !== '' && String(claimedPlayerId) !== user.id) {
    res.status(403).json({ error: 'playerId does not match the authenticated user' });
    return null;
  }
  return (await getUserAccess(user)) as UserAccess & { userId: string };
}

/** Record an admin action. Failures are logged, never thrown, so they can't undo the action. */
export async function logAdminAction(
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, targetType, targetId, details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    console.error('Error writing admin audit log:', error);
  }
}
