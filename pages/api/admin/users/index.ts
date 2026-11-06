import { getPool } from '../../../../src/lib/database/pool';
import { requireAnyPermission } from '../../../../src/lib/auth/access-control';
import { PERMISSION_KEYS, isLimitKey } from '../../../../src/lib/auth/permissions';
import { getAdminEmails, isAdminEmail } from '../../../../src/utils/roleUtils';
import { apiHandler } from '../../../../src/lib/api/handler';

export const USER_SEARCH_LIMIT = 200;

/**
 * The ILIKE pattern for a search. Plain text matches anywhere in the email or username; with a *
 * the search is a wildcard pattern over the whole value ("gene*" starts with gene, "*@gmail.com"
 * ends with it), and * alone is everyone.
 */
export function userSearchPattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, c => `\\${c}`);
  return q.includes('*') ? escaped.replace(/\*+/g, '%') : `%${escaped}%`;
}

// GET ?q=: users matching an email or username, with their extra roles, overrides, own limits
// and active ban or suspension. With no q, lists everyone who has any of those or is in ADMIN_EMAILS.
export default apiHandler({ methods: 'GET' }, async (req, res) => {
  // Staff who look up users (to suspend them, say) also see the roles
  const actor = await requireAnyPermission(req, res, ['roles.view', 'admin.users.view']);
  if (!actor) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const pattern = userSearchPattern(q);
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
         WHEN $2 = '%' THEN TRUE
         ELSE u.email ILIKE $2 OR u.username ILIKE $2
       END
       ORDER BY u.username
       LIMIT $4`,
      // One extra row says whether there are more than the limit
      [q, pattern, getAdminEmails(), USER_SEARCH_LIMIT + 1]
    );
    return res.status(200).json({
      more: rows.length > USER_SEARCH_LIMIT,
      users: rows.slice(0, USER_SEARCH_LIMIT).map(u => ({
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
});
