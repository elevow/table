import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { buildTournamentReport } from '../../../src/lib/tournament/tournament-reporting';
import { requirePermission } from '../../../src/lib/auth/access-control';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  if (!(await requirePermission(req, res, 'tournament.report'))) return;
  try {
    const { tournamentId } = req.query || {} as any;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const t = await tournamentManager.get(tournamentId as string);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const report = buildTournamentReport(t);
    return res.status(200).json(report);
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
