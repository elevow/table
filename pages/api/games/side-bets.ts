import { getPool } from '../../../src/lib/database/pool';
import { logAdminAction, requirePlayerAccess, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import { canOnTable, isTableOwner } from '../../../src/lib/auth/table-access';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';
import { handInPlay } from '../../../src/lib/server/close-table';
import { loadRoom, updateRoomConfig } from '../../../src/lib/server/room-config';
import { loadPools, setSideBetPlayer } from '../../../src/lib/server/side-bets';
import { publishTableEvent } from '../../../src/lib/realtime/publisher';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import {
  SIDE_BETS, isSideBetKey, isValidPick, parseSideBetStakes, type SideBetKey,
} from '../../../src/lib/shared/side-bets';
import { apiHandler } from '../../../src/lib/api/handler';

type SideBetAction =
  | { action: 'join'; bet: SideBetKey; pick?: string | null }
  | { action: 'leave'; bet: SideBetKey }
  | { action: 'configure'; stakes: Record<string, unknown> };

const MISSING_TABLES = '42P01';

/**
 * GET  /api/games/side-bets?tableId=
 * POST /api/games/side-bets { tableId, action: 'join' | 'leave' | 'configure', ... }
 *
 * Side bets at a table: which are on and for how much, who is in each, what is in the pots, and
 * the caller's own entries and picks. Seated players join (with a pick where the bet takes one)
 * and leave; a change made during a hand counts from the next hand. Whoever may configure the
 * table turns side bets on and off and sets their stakes. Side bets are separate money: nothing
 * here touches chips.
 */
export default apiHandler({ methods: ['GET', 'POST'] }, async (req, res) => {
  const body = (req.body || {}) as { tableId?: string; playerId?: string } & SideBetAction;
  const access = await requirePlayerAccess(req, res, req.method === 'POST' ? body.playerId : undefined);
  if (!access) return;
  const userId = access.userId;
  const tableId = req.method === 'GET'
    ? (typeof req.query.tableId === 'string' ? req.query.tableId : '')
    : (typeof body.tableId === 'string' ? body.tableId : '');
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });

  try {
    const room = await loadRoom(tableId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const stakes = parseSideBetStakes(room.configuration.sideBets);
    const canConfigure = canOnTable(access, room, 'room.configure').allowed;
    const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);
    const mySeat = Object.values(seats || {}).find(s => s?.playerId === userId) || null;
    const pool = getPool();

    if (req.method === 'GET') {
      let rows: any[] = [];
      let pools = { 'high-card-bingo': [] as Array<{ amount: number }>, 'bad-beat': [] as Array<{ amount: number }> };
      try {
        rows = (await pool.query(
          `SELECT player_id, player_name, bet, pick FROM side_bet_players WHERE room_id = $1 AND active ORDER BY player_name`,
          [tableId]
        )).rows;
        pools = await loadPools(pool, tableId);
      } catch (err: any) {
        if (err?.code !== MISSING_TABLES) throw err;
      }
      const sum = (shares: Array<{ amount: number }>) => Math.round(shares.reduce((s, x) => s + x.amount * 100, 0)) / 100;
      const bets = SIDE_BETS.filter(b => stakes[b]).map(bet => {
        const mine = rows.find(r => r.bet === bet && String(r.player_id) === userId);
        return {
          bet,
          stake: stakes[bet]!,
          // Only names: others' picks stay private until they win
          players: rows.filter(r => r.bet === bet).map(r => r.player_name || String(r.player_id).slice(0, 6)),
          joined: !!mine,
          pick: mine?.pick ?? null,
          pot: bet === 'high-card-bingo' || bet === 'bad-beat' ? sum(pools[bet]) : undefined,
        };
      });
      return res.status(200).json({ bets, stakes, canConfigure, seated: !!mySeat });
    }

    if (body.action === 'configure') {
      const auth = canOnTable(access, room, 'room.configure');
      if (!auth.allowed) {
        if (isTableOwner(access, room)) return sendPermissionDenied(res, 'room.configure', access);
        return res.status(403).json({ error: 'Only the host can change side bets' });
      }
      const next = parseSideBetStakes(body.stakes);
      if (auth.asAdmin) await logAdminAction(userId, 'table.side-bets', 'room', tableId, { stakes: next });
      await updateRoomConfig(tableId, { sideBets: next });
      await publishTableEvent(tableId, { type: 'side_bets' }).catch(() => {});
      return res.status(200).json({ ok: true, stakes: next });
    }

    if (body.action !== 'join' && body.action !== 'leave') return res.status(400).json({ error: 'Unknown side bet action' });
    const bet = body.bet;
    if (!isSideBetKey(bet)) return res.status(400).json({ error: 'Unknown side bet' });

    const engine = await getOrRestoreEngine(tableId).catch(() => null);
    const state = engine?.getState();
    const handStartedAt = handInPlay(state) && typeof state?.handStartedAt === 'number' ? state.handStartedAt : null;

    if (body.action === 'join') {
      if (!stakes[bet]) return res.status(409).json({ error: 'That side bet is not on at this table' });
      if (!mySeat) return res.status(403).json({ error: 'Take a seat to join side bets' });
      const pick = body.pick ?? null;
      if (!isValidPick(bet, pick)) return res.status(400).json({ error: 'Choose a valid pick for this side bet' });
      await setSideBetPlayer(pool, { roomId: tableId, playerId: userId, playerName: mySeat.playerName, bet, active: true, pick, handStartedAt });
    } else {
      // Off the table, the name already stored is kept
      await setSideBetPlayer(pool, { roomId: tableId, playerId: userId, playerName: mySeat?.playerName || '', bet, active: false, pick: null, handStartedAt });
    }
    await publishTableEvent(tableId, { type: 'side_bets' }).catch(() => {});
    return res.status(200).json({ ok: true, nextHand: !!handStartedAt });
  } catch (err: any) {
    if (err?.code === MISSING_TABLES) return res.status(503).json({ error: 'Side bets are not set up on this server yet' });
    console.error('Error handling side bets:', err);
    return res.status(500).json({ error: 'Unable to update side bets' });
  }
});
