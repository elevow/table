import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requirePermission } from '../../../src/lib/auth/access-control';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const access = await requirePermission(req, res, 'tournament.create');
  if (!access) return;
  try {
    const { name, config } = req.body || {};
    if (!name || !config) return res.status(400).json({ error: 'Missing name or config' });
    // Anyone who can create a tournament can make it private; the invite code is the server's
    const visibility = req.body?.visibility === 'private' ? 'private' : 'public';
    const created = await tournamentManager.create({ name, config, createdBy: access.userId, visibility });
    // The director gets the invite link from the director controls
    return res.status(201).json(withoutTournamentInvite(created));
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
