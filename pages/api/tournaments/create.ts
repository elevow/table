import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requirePermission } from '../../../src/lib/auth/access-control';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const access = await requirePermission(req, res, 'tournament.create');
  if (!access) return;
  try {
    const { name, config } = req.body || {};
    if (!name || !config) return res.status(400).json({ error: 'Missing name or config' });
    const created = await tournamentManager.create({ name, config, createdBy: access.userId });
    return res.status(201).json(created);
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
