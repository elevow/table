import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../../src/lib/database/pool';
import {
  UserAccess, clearAccessCache, getUserAccess, hasPermission, logAdminAction, requirePermission,
  requirePlayerAccess, sendPermissionDenied,
} from '../../../../../src/lib/auth/access-control';

type Kind = 'ban' | 'suspend';

const KIND_PERMISSION: Record<Kind, string> = { ban: 'admin.users.ban', suspend: 'admin.users.suspend' };

function isKind(value: unknown): value is Kind {
  return value === 'ban' || value === 'suspend';
}

/** The target, or sends why the actor can't ban or suspend them and returns null. */
async function loadTarget(res: NextApiResponse, actor: UserAccess & { userId: string }, userId: string) {
  if (userId === actor.userId) {
    res.status(400).json({ error: 'You can\'t ban or suspend yourself' });
    return null;
  }
  const { rows } = await getPool().query('SELECT id, email FROM users WHERE id::text = $1', [userId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  const target = await getUserAccess(rows[0]);
  if (target.bootstrapAdmin) {
    res.status(403).json({ error: 'Users in ADMIN_EMAILS can\'t be banned or suspended' });
    return null;
  }
  // Strictly below: staff of the same rank can't ban each other
  if (!actor.bootstrapAdmin && target.rank >= actor.rank) {
    res.status(403).json({ error: 'You can only ban or suspend users ranked below you' });
    return null;
  }
  return rows[0] as { id: string; email: string | null };
}

// POST { kind: 'ban' | 'suspend', reason?, until? (ISO; required for a suspension) }
//   Bans or suspends a user, replacing any active ban or suspension. A ban also signs them out.
// DELETE: lifts the user's active ban or suspension.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const userId = String(req.query.id || '');
  const body = req.body || {};

  let kind: Kind | null = null;
  let until: Date | null = null;
  let reason: string | null = null;
  if (req.method === 'POST') {
    if (!isKind(body.kind)) return res.status(400).json({ error: 'kind must be ban or suspend' });
    kind = body.kind;
    if (body.until != null && body.until !== '') {
      until = new Date(body.until);
      if (Number.isNaN(until.getTime())) return res.status(400).json({ error: 'until must be a date' });
      if (until.getTime() <= Date.now()) return res.status(400).json({ error: 'until must be in the future' });
    }
    if (kind === 'suspend' && !until) return res.status(400).json({ error: 'A suspension needs an end date' });
    reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
  }

  const actor = kind ? await requirePermission(req, res, KIND_PERMISSION[kind]) : await requirePlayerAccess(req, res);
  if (!actor) return;

  const pool = getPool();
  const client = await pool.connect();
  try {
    const target = await loadTarget(res, actor, userId);
    if (!target) return;

    const active = await client.query(
      `SELECT id, kind FROM access_user_sanctions
       WHERE user_id = $1 AND lifted_at IS NULL AND (until IS NULL OR until > NOW())`,
      [target.id]
    );
    const activeKinds = [...new Set<Kind>(active.rows.map(r => r.kind))];
    if (!kind && !activeKinds.length) return res.status(404).json({ error: 'This user isn\'t banned or suspended' });
    // Replacing or lifting a ban needs the ban permission, so a suspension can't undo one
    const missing = activeKinds.map(k => KIND_PERMISSION[k]).find(p => !hasPermission(actor, p));
    if (missing) return sendPermissionDenied(res, missing);

    await client.query('BEGIN');
    if (active.rows.length) {
      await client.query(
        'UPDATE access_user_sanctions SET lifted_at = NOW(), lifted_by = $2 WHERE id = ANY($1::uuid[])',
        [active.rows.map(r => r.id), actor.userId]
      );
    }
    let sanction = null;
    if (kind) {
      const inserted = await client.query(
        `INSERT INTO access_user_sanctions (user_id, kind, reason, until, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING kind, reason, until`,
        [target.id, kind, reason, until, actor.userId]
      );
      const row = inserted.rows[0];
      sanction = { kind: row.kind, reason: row.reason, until: row.until ? new Date(row.until).toISOString() : null };
      // A ban ends the user's sessions at once
      if (kind === 'ban') {
        await client.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'session'`, [target.id]);
      }
    }
    await client.query('COMMIT');
    clearAccessCache(target.id);

    if (kind) {
      await logAdminAction(actor.userId, `user.${kind}`, 'user', target.id, {
        reason,
        until: until ? until.toISOString() : null,
        ...(activeKinds.length ? { replaced: activeKinds } : {}),
      });
    } else {
      await logAdminAction(actor.userId, 'user.sanction.lift', 'user', target.id, { lifted: activeKinds });
    }
    return res.status(200).json({ sanction });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating ban or suspension:', error);
    return res.status(500).json({ error: 'Failed to update the ban or suspension' });
  } finally {
    client.release();
  }
}
