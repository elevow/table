import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { requirePermission } from '../../../src/lib/auth/access-control';

// GET: the 100 most recent admin actions, newest first.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requirePermission(req, res, 'admin.audit_log.view'))) return;
  try {
    const { rows } = await getPool().query(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
              u.username AS actor_username, u.email AS actor_email
       FROM admin_audit_log l
       LEFT JOIN users u ON u.id = l.actor_id
       ORDER BY l.created_at DESC
       LIMIT 100`
    );
    return res.status(200).json({ entries: rows });
  } catch (error) {
    console.error('Error loading audit log:', error);
    return res.status(500).json({ error: 'Failed to load audit log' });
  }
}
