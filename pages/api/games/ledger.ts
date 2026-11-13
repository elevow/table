import { getPool } from '../../../src/lib/database/pool';
import { getSessionUser } from '../../../src/lib/auth/auth-utils';
import { getUserAccess } from '../../../src/lib/auth/access-control';
import { canOnTable } from '../../../src/lib/auth/table-access';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';
import { ledgerToCsv, loadLedger, settlementPayments, summarizeLedger } from '../../../src/lib/server/chip-ledger';
import { loadRoom } from '../../../src/lib/server/room-config';
import { loadSideBetLedger } from '../../../src/lib/server/side-bets';
import { apiHandler } from '../../../src/lib/api/handler';

/**
 * GET /api/games/ledger?tableId=&format=csv
 *
 * The table's chip ledger (who bought in for what, who left with what, who is up or down at
 * poker and on side bets, and the payments that settle both together) plus the caller's session
 * stats and their side-bet results. Open to anyone who has played at
 * the table, to the host (with room.view_ledger) and to staff who can see all rooms.
 * format=csv downloads the ledger as a spreadsheet.
 */
// The host with room.view_ledger, or staff who can see every room
async function canSeeAsStaffOrHost(tableId: string, user: { id: string; email: string | null }): Promise<boolean> {
  const access = await getUserAccess(user);
  if (access.permissions.has('admin.rooms.view')) return true;
  const room = await loadRoom(tableId);
  return !!room && canOnTable(access, room, 'room.view_ledger').allowed;
}

export default apiHandler({ methods: 'GET' }, async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const userId = user.id;
  const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : '';
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });

  try {
    const [entries, sideBets] = await Promise.all([loadLedger(tableId), loadSideBetLedger(tableId)]);
    const engine = await getOrRestoreEngine(tableId);
    const players = engine?.getState().players || [];
    const onTable = new Map(players.map(p => [p.id, { name: p.name, stack: p.stack }]));

    const allowed = entries.some(e => e.playerId === userId) || sideBets.some(e => e.playerId === userId)
      || onTable.has(userId) || await canSeeAsStaffOrHost(tableId, user);
    if (!allowed) return res.status(403).json({ error: 'Only players at this table can see its ledger' });

    const lines = summarizeLedger(entries, onTable, sideBets);

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ledger-${tableId}.csv"`);
      return res.status(200).send(ledgerToCsv(lines));
    }

    // This session: hands since the caller's first buy-in at this table
    const myFirst = entries.find(e => e.playerId === userId && e.kind !== 'cash_out');
    const since = myFirst?.createdAt ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const handsResult = await getPool().query(
      `SELECT players, pot, winners FROM hand_records
       WHERE room_id = $1 AND player_ids @> ARRAY[$2]::text[] AND ended_at >= $3`,
      [tableId, userId, since]
    );
    let handsPlayed = 0;
    let handsWon = 0;
    let biggestPotWon = 0;
    for (const row of handsResult.rows) {
      const ps = typeof row.players === 'string' ? JSON.parse(row.players) : row.players;
      const me = Array.isArray(ps) ? ps.find((p: any) => p.id === userId) : null;
      if (!me) continue;
      handsPlayed += 1;
      if (Number(me.won) > 0) {
        handsWon += 1;
        biggestPotWon = Math.max(biggestPotWon, Number(row.pot) || 0);
      }
    }
    const myLine = lines.find(l => l.playerId === userId);

    return res.status(200).json({
      lines,
      payments: settlementPayments(lines),
      // The caller's side bets, newest first
      mySideBets: sideBets
        .filter(e => e.playerId === userId)
        .reverse()
        .slice(0, 50)
        .map(e => ({ handNumber: e.handNumber, bet: e.bet, note: e.note, amount: e.amount })),
      session: {
        handsPlayed,
        handsWon,
        biggestPotWon,
        boughtIn: myLine?.boughtIn ?? 0,
        net: myLine?.net ?? 0,
        sideBets: myLine?.sideBets ?? 0,
        total: myLine?.total ?? 0,
        since,
        // When the caller first bought in here, or null if they never have
        startedAt: myFirst?.createdAt ?? null,
      },
    });
  } catch (err) {
    console.error('Error loading ledger:', err);
    return res.status(500).json({ error: 'Unable to load the ledger' });
  }
});
