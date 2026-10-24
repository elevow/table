import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';
import { ledgerToCsv, loadLedger, settlementPayments, summarizeLedger } from '../../../src/lib/server/chip-ledger';
import { isRoomHost } from '../../../src/lib/server/room-config';

/**
 * GET /api/games/ledger?tableId=&format=csv
 *
 * The table's chip ledger (who bought in for what, who left with what, who is up or down, and
 * the payments that settle it) plus the caller's session stats. Open to anyone who has played at
 * the table and to the host. format=csv downloads the ledger as a spreadsheet.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : '';
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });

  try {
    const entries = await loadLedger(tableId);
    const engine = await getOrRestoreEngine(tableId);
    const players = engine?.getState().players || [];
    const onTable = new Map(players.map(p => [p.id, { name: p.name, stack: p.stack }]));

    const allowed = entries.some(e => e.playerId === userId) || onTable.has(userId) || await isRoomHost(tableId, userId);
    if (!allowed) return res.status(403).json({ error: 'Only players at this table can see its ledger' });

    const lines = summarizeLedger(entries, onTable);

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
      session: {
        handsPlayed,
        handsWon,
        biggestPotWon,
        boughtIn: myLine?.boughtIn ?? 0,
        net: myLine?.net ?? 0,
        since,
      },
    });
  } catch (err) {
    console.error('Error loading ledger:', err);
    return res.status(500).json({ error: 'Unable to load the ledger' });
  }
}
