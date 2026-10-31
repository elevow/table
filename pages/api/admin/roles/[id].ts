import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { clearAccessCache, logAdminAction, requirePermission } from '../../../../src/lib/auth/access-control';
import { isPermissionKey } from '../../../../src/lib/auth/permissions';
import {
  LOCKED_PERMISSION_ROLES,
  RoleRow,
  canManageRank,
  changedLimitKeys,
  parseLimits,
  parsePermissionList,
  permissionsBeyondActor,
} from '../../../../src/lib/auth/role-admin';

// PATCH: rename, re-rank or change a role's permissions or limits ([{ key, value }], replacing all).
// DELETE: remove a custom role.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const actor = await requirePermission(req, res, 'roles.edit');
  if (!actor) return;
  const id = String(req.query.id || '');

  const pool = getPool();
  let role: RoleRow | undefined;
  try {
    const { rows } = await pool.query(
      'SELECT id, key, name, description, rank, built_in FROM access_roles WHERE id::text = $1',
      [id]
    );
    role = rows[0];
  } catch (error) {
    console.error('Error loading role:', error);
    return res.status(500).json({ error: 'Failed to load role' });
  }
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (!canManageRank(actor, role.rank)) {
    return res.status(403).json({ error: 'You can only change roles ranked at or below your own' });
  }

  if (req.method === 'DELETE') {
    if (role.built_in) return res.status(400).json({ error: 'Built-in roles can\'t be deleted' });
    try {
      await pool.query('DELETE FROM access_roles WHERE id = $1', [role.id]);
      clearAccessCache();
      await logAdminAction(actor.userId, 'role.delete', 'role', role.id, { key: role.key });
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error deleting role:', error);
      return res.status(500).json({ error: 'Failed to delete role' });
    }
  }

  const { name, description, rank, permissions, limits } = req.body || {};
  const updates: { name?: string; description?: string | null; rank?: number } = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name can\'t be empty' });
    updates.name = name.trim();
  }
  if (description !== undefined) {
    updates.description = typeof description === 'string' ? description.trim() || null : null;
  }
  if (rank !== undefined) {
    if (!Number.isInteger(rank)) return res.status(400).json({ error: 'rank must be a whole number' });
    if (!canManageRank(actor, rank)) return res.status(403).json({ error: 'You can\'t rank a role above your own' });
    updates.rank = rank;
  }

  let added: string[] = [];
  let removed: string[] = [];
  let nextPermissions: string[] | null = null;
  if (permissions !== undefined) {
    if (LOCKED_PERMISSION_ROLES.includes(role.key)) {
      return res.status(400).json({ error: `${role.name} always has every permission` });
    }
    const parsed = parsePermissionList(permissions);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    nextPermissions = parsed.permissions;
  }
  let nextLimits: { key: string; value: number | null }[] | null = null;
  let changedLimits: string[] = [];
  if (limits !== undefined) {
    const parsed = parseLimits(limits);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    nextLimits = parsed.limits.map(({ key, value }) => ({ key, value }));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (nextPermissions) {
      const current = await client.query('SELECT permission FROM access_role_permissions WHERE role_id = $1', [role.id]);
      const currentSet = new Set<string>(current.rows.map(r => r.permission));
      const nextSet = new Set(nextPermissions);
      added = nextPermissions.filter(p => !currentSet.has(p));
      removed = [...currentSet].filter(p => !nextSet.has(p));
      // Grants of permissions no longer in the catalog are cleared without the holder check
      const beyond = permissionsBeyondActor(actor, [...added, ...removed.filter(isPermissionKey)]);
      if (beyond.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: `You can't change permissions you don't hold: ${beyond.join(', ')}` });
      }
      if (removed.length) {
        await client.query('DELETE FROM access_role_permissions WHERE role_id = $1 AND permission = ANY($2::text[])', [role.id, removed]);
      }
      if (added.length) {
        await client.query(
          'INSERT INTO access_role_permissions (role_id, permission) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING',
          [role.id, added]
        );
      }
    }
    if (nextLimits) {
      const current = await client.query('SELECT limit_key, value FROM access_role_limits WHERE role_id = $1', [role.id]);
      changedLimits = changedLimitKeys(
        current.rows.map(r => ({ key: r.limit_key, value: r.value === null ? null : Number(r.value) })),
        nextLimits
      );
      if (changedLimits.length) {
        await client.query('DELETE FROM access_role_limits WHERE role_id = $1', [role.id]);
        for (const l of nextLimits) {
          await client.query('INSERT INTO access_role_limits (role_id, limit_key, value) VALUES ($1, $2, $3)', [role.id, l.key, l.value]);
        }
      }
    }
    const { rows } = await client.query(
      `UPDATE access_roles
       SET name = COALESCE($2, name),
           description = CASE WHEN $3 THEN $4 ELSE description END,
           rank = COALESCE($5, rank),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, key, name, description, rank, built_in`,
      [role.id, updates.name ?? null, 'description' in updates, updates.description ?? null, updates.rank ?? null]
    );
    await client.query('COMMIT');
    clearAccessCache();
    await logAdminAction(actor.userId, 'role.update', 'role', role.id, {
      key: role.key,
      ...updates,
      ...(added.length ? { added } : {}),
      ...(removed.length ? { removed } : {}),
      ...(changedLimits.length ? { limits: nextLimits } : {}),
    });
    return res.status(200).json({ role: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating role:', error);
    return res.status(500).json({ error: 'Failed to update role' });
  } finally {
    client.release();
  }
}
