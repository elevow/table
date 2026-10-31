import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { logAdminAction, requireAnyPermission, requirePermission } from '../../../../src/lib/auth/access-control';
import { LIMIT_DEFS, PERMISSION_GROUPS, isLimitKey, isPermissionKey } from '../../../../src/lib/auth/permissions';
import {
  canManageRank,
  parsePermissionList,
  permissionsBeyondActor,
  roleKeyFromName,
} from '../../../../src/lib/auth/role-admin';

// GET: every role with its permissions, limits and member count, plus the permission and limit catalogs.
// POST: create a custom role.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Staff who look up users (to suspend them, say) also see the roles
    const actor = await requireAnyPermission(req, res, ['roles.view', 'admin.users.view']);
    if (!actor) return;
    try {
      const { rows } = await getPool().query(
        `SELECT r.id, r.key, r.name, r.description, r.rank, r.built_in,
                COALESCE(array_agg(DISTINCT rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions,
                (SELECT COUNT(*)::int FROM access_user_roles ur WHERE ur.role_id = r.id) AS member_count,
                COALESCE((SELECT json_agg(json_build_object('key', l.limit_key, 'value', l.value))
                          FROM access_role_limits l WHERE l.role_id = r.id), '[]') AS limits
         FROM access_roles r
         LEFT JOIN access_role_permissions rp ON rp.role_id = r.id
         GROUP BY r.id
         ORDER BY r.rank, r.name`
      );
      return res.status(200).json({
        // Grants of permissions since removed from the catalog are dropped, so saving a role clears them
        roles: rows.map(r => ({
          ...r,
          permissions: r.permissions.filter(isPermissionKey),
          limits: (r.limits || []).filter((l: { key: string }) => isLimitKey(l.key)),
        })),
        groups: PERMISSION_GROUPS,
        limitDefs: LIMIT_DEFS,
        me: { rank: actor.rank, bootstrapAdmin: actor.bootstrapAdmin, permissions: [...actor.permissions] },
      });
    } catch (error) {
      console.error('Error listing roles:', error);
      return res.status(500).json({ error: 'Failed to load roles' });
    }
  }

  if (req.method === 'POST') {
    const actor = await requirePermission(req, res, 'roles.edit');
    if (!actor) return;
    const { name, description, rank, permissions } = req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const key = roleKeyFromName(cleanName);
    if (!cleanName || !key) return res.status(400).json({ error: 'name is required' });
    const roleRank = Number.isInteger(rank) ? rank : 0;
    if (!canManageRank(actor, roleRank)) {
      return res.status(403).json({ error: 'You can only create roles ranked at or below your own' });
    }
    const parsed = parsePermissionList(permissions ?? []);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const beyond = permissionsBeyondActor(actor, parsed.permissions);
    if (beyond.length) return res.status(403).json({ error: `You can't grant permissions you don't hold: ${beyond.join(', ')}` });

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO access_roles (key, name, description, rank) VALUES ($1, $2, $3, $4)
         RETURNING id, key, name, description, rank, built_in`,
        [key, cleanName, typeof description === 'string' ? description.trim() || null : null, roleRank]
      );
      const role = rows[0];
      if (parsed.permissions.length) {
        await client.query(
          'INSERT INTO access_role_permissions (role_id, permission) SELECT $1, unnest($2::text[])',
          [role.id, parsed.permissions]
        );
      }
      await client.query('COMMIT');
      await logAdminAction(actor.userId, 'role.create', 'role', role.id, { key, rank: roleRank, permissions: parsed.permissions });
      return res.status(201).json({ role: { ...role, permissions: parsed.permissions, member_count: 0 } });
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (error?.code === '23505') return res.status(409).json({ error: 'A role with that name already exists' });
      console.error('Error creating role:', error);
      return res.status(500).json({ error: 'Failed to create role' });
    } finally {
      client.release();
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
