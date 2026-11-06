import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { buildTournamentReport } from '../../../src/lib/tournament/tournament-reporting';
import { requirePermission } from '../../../src/lib/auth/access-control';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
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
});
