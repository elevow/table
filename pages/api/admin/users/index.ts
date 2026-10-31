import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { requireAnyPermission } from '../../../../src/lib/auth/access-control';
import { PERMISSION_KEYS, isLimitKey } from '../../../../src/lib/auth/permissions';
import { getAdminEmails, isAdminEmail } from '../../../../src/utils/roleUtils';

// GET ?q=: users matching an email or username, with their extra roles, overrides, own limits
// and active ban or suspension. With no q, lists everyone who has any of those or is in ADMIN_EMAILS.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Staff who look up users (to suspend them, say) also see the roles
  const actor = await requireAnyPermission(req, res, ['roles.view', 'admin.users.view']);
  if (!actor) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const pattern = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  try {
    const { rows } = await getPool().query(
      `SELECT u.id, u.email, u.username,
              COALESCE((SELECT array_agg(r.key ORDER BY r.rank DESC)
                        FROM access_user_roles ur JOIN access_roles r ON r.id = ur.role_id
                        WHERE ur.user_id = u.id), '{}') AS roles,
              COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'effect', o.effect, 'reason', o.reason)
                                 ORDER BY o.permission)
                        FROM access_user_overrides o WHERE o.user_id = u.id), '[]') AS overrides,
              COALESCE((SELECT json_agg(json_build_object('key', l.limit_key, 'value', l.value, 'reason', l.reason)
                                 ORDER BY l.limit_key)
                        FROM access_user_limits l WHERE l.user_id = u.id), '[]') AS limits,
              (SELECT json_build_object('kind', s.kind, 'until', s.until, 'reason', s.reason)
               FROM access_user_sanctions s
               WHERE s.user_id = u.id AND s.lifted_at IS NULL AND (s.until IS NULL OR s.until > NOW())
               ORDER BY (s.kind = 'ban') DESC, s.until DESC NULLS FIRST
               LIMIT 1) AS sanction
       FROM users u
       WHERE CASE WHEN $1 = ''
         THEN EXISTS (SELECT 1 FROM access_user_roles WHERE user_id = u.id)
           OR EXISTS (SELECT 1 FROM access_user_overrides WHERE user_id = u.id)
           OR EXISTS (SELECT 1 FROM access_user_limits WHERE user_id = u.id)
           OR EXISTS (SELECT 1 FROM access_user_sanctions
                      WHERE user_id = u.id AND lifted_at IS NULL AND (until IS NULL OR until > NOW()))
           OR lower(u.email) = ANY($3::text[])
         ELSE u.email ILIKE $2 OR u.username ILIKE $2
       END
       ORDER BY u.username
       LIMIT 50`,
      [q, pattern, getAdminEmails()]
    );
    return res.status(200).json({
      users: rows.map(u => ({
        ...u,
        // Overrides of permissions since removed from the catalog are dropped, so saving clears them
        overrides: u.overrides.filter((o: { permission: string }) => PERMISSION_KEYS.includes(o.permission)),
        limits: (u.limits || []).filter((l: { key: string }) => isLimitKey(l.key)),
        sanction: u.sanction ?? null,
        bootstrapAdmin: !!u.email && isAdminEmail(u.email),
      })),
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return res.status(500).json({ error: 'Failed to load users' });
  }
}
