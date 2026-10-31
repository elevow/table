import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../../src/lib/database/pool';
import { clearAccessCache, getUserAccess, logAdminAction, requirePermission } from '../../../../../src/lib/auth/access-control';
import { PERMISSION_KEYS } from '../../../../../src/lib/auth/permissions';
import {
  IMPLICIT_ROLES, LimitInput, canManageRank, changedLimitKeys, parseLimits, permissionsBeyondActor,
} from '../../../../../src/lib/auth/role-admin';

interface OverrideInput {
  permission: string;
  effect: 'grant' | 'deny';
  reason: string | null;
}

function parseOverrides(value: unknown): { overrides: OverrideInput[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'overrides must be an array' };
  const out = new Map<string, OverrideInput>();
  for (const o of value) {
    if (!o || typeof o.permission !== 'string' || !PERMISSION_KEYS.includes(o.permission)) {
      return { error: `Unknown permission: ${o?.permission}` };
    }
    if (o.effect !== 'grant' && o.effect !== 'deny') return { error: 'effect must be grant or deny' };
    out.set(o.permission, {
      permission: o.permission,
      effect: o.effect,
      reason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 500) || null : null,
    });
  }
  return { overrides: [...out.values()] };
}

// PUT { roles: string[], overrides?: [{ permission, effect, reason }], limits?: [{ key, value, reason }] }
// Replaces a user's extra roles (and overrides and limits, when given).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const actor = await requirePermission(req, res, 'roles.assign');
  if (!actor) return;
  const userId = String(req.query.id || '');
  const { roles, overrides, limits } = req.body || {};
  if (!Array.isArray(roles) || roles.some(r => typeof r !== 'string')) {
    return res.status(400).json({ error: 'roles must be an array of role keys' });
  }
  const roleKeys = [...new Set(roles as string[])].filter(k => !IMPLICIT_ROLES.includes(k));
  let parsedOverrides: OverrideInput[] | null = null;
  if (overrides !== undefined) {
    const parsed = parseOverrides(overrides);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    parsedOverrides = parsed.overrides;
  }
  let parsedLimits: LimitInput[] | null = null;
  if (limits !== undefined) {
    const parsed = parseLimits(limits);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    parsedLimits = parsed.limits;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const target = await client.query('SELECT id, email FROM users WHERE id::text = $1', [userId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'User not found' });
    const targetAccess = await getUserAccess(target.rows[0]);
    if (targetAccess.bootstrapAdmin && !actor.bootstrapAdmin) {
      return res.status(403).json({ error: 'Users in ADMIN_EMAILS can only be changed by another ADMIN_EMAILS user' });
    }
    if (!canManageRank(actor, targetAccess.rank)) {
      return res.status(403).json({ error: 'You can\'t change a user ranked above you' });
    }

    const allRoles = await client.query('SELECT id, key, rank FROM access_roles');
    const byKey = new Map<string, { id: string; key: string; rank: number }>(allRoles.rows.map(r => [r.key, r]));
    const unknown = roleKeys.filter(k => !byKey.has(k));
    if (unknown.length) return res.status(400).json({ error: `Unknown roles: ${unknown.join(', ')}` });

    const current = await client.query(
      'SELECT r.key FROM access_user_roles ur JOIN access_roles r ON r.id = ur.role_id WHERE ur.user_id = $1',
      [userId]
    );
    const currentKeys = new Set<string>(current.rows.map(r => r.key));
    const added = roleKeys.filter(k => !currentKeys.has(k));
    const removed = [...currentKeys].filter(k => !roleKeys.includes(k));
    const tooHigh = [...added, ...removed].filter(k => !canManageRank(actor, byKey.get(k)?.rank ?? 0));
    if (tooHigh.length) {
      return res.status(403).json({ error: `You can't assign or remove roles ranked above you: ${tooHigh.join(', ')}` });
    }

    let overrideChanges: string[] = [];
    if (parsedOverrides) {
      const existing = await client.query('SELECT permission, effect FROM access_user_overrides WHERE user_id = $1', [userId]);
      const before = new Map<string, string>(existing.rows.map(r => [r.permission, r.effect]));
      const after = new Map(parsedOverrides.map(o => [o.permission, o.effect]));
      overrideChanges = [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p));
      // Overrides of permissions no longer in the catalog are cleared without the holder check
      const beyond = permissionsBeyondActor(actor, overrideChanges.filter(p => PERMISSION_KEYS.includes(p)));
      if (beyond.length) {
        return res.status(403).json({ error: `You can't override permissions you don't hold: ${beyond.join(', ')}` });
      }
    }

    let limitChanges: string[] = [];
    if (parsedLimits) {
      const existing = await client.query('SELECT limit_key, value FROM access_user_limits WHERE user_id = $1', [userId]);
      limitChanges = changedLimitKeys(
        existing.rows.map(r => ({ key: r.limit_key, value: r.value === null ? null : Number(r.value) })),
        parsedLimits
      );
    }

    await client.query('BEGIN');
    if (removed.length) {
      await client.query(
        'DELETE FROM access_user_roles WHERE user_id = $1 AND role_id = ANY($2::uuid[])',
        [userId, removed.map(k => byKey.get(k)!.id)]
      );
    }
    if (added.length) {
      await client.query(
        `INSERT INTO access_user_roles (user_id, role_id, granted_by)
         SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`,
        [userId, added.map(k => byKey.get(k)!.id), actor.userId]
      );
    }
    if (parsedOverrides && overrideChanges.length) {
      await client.query('DELETE FROM access_user_overrides WHERE user_id = $1', [userId]);
      for (const o of parsedOverrides) {
        await client.query(
          `INSERT INTO access_user_overrides (user_id, permission, effect, reason, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, o.permission, o.effect, o.reason, actor.userId]
        );
      }
    }
    if (parsedLimits && limitChanges.length) {
      await client.query('DELETE FROM access_user_limits WHERE user_id = $1', [userId]);
      for (const l of parsedLimits) {
        await client.query(
          `INSERT INTO access_user_limits (user_id, limit_key, value, reason, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, l.key, l.value, l.reason, actor.userId]
        );
      }
    }
    await client.query('COMMIT');
    clearAccessCache(userId);

    if (added.length || removed.length || overrideChanges.length || limitChanges.length) {
      await logAdminAction(actor.userId, 'user.access.update', 'user', userId, {
        ...(added.length ? { addedRoles: added } : {}),
        ...(removed.length ? { removedRoles: removed } : {}),
        ...(overrideChanges.length ? { overrides: parsedOverrides } : {}),
        ...(limitChanges.length ? { limits: parsedLimits } : {}),
      });
    }
    return res.status(200).json({ roles: roleKeys, overrides: parsedOverrides ?? undefined, limits: parsedLimits ?? undefined });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating user access:', error);
    return res.status(500).json({ error: 'Failed to update user access' });
  } finally {
    client.release();
  }
}
