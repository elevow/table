/**
 * Head to head: a side bet between two players on who does better at poker from the moment the
 * challenge is accepted. It settles when either player leaves the table (which also happens to
 * everyone when the table closes). Separate money, like every side bet: the result goes to the
 * side-bet ledger, never to a chip stack.
 */
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../database/pool';
import * as GameSeats from '../shared/game-seats';
import { getOrRestoreEngine } from '../poker/engine-persistence';
import { formatMoney } from '../shared/side-bets';
import { postSystemChatMessage } from '../utils/post-hand-result';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export type ChallengeStatus = 'pending' | 'active' | 'settled' | 'cancelled';

export interface Challenge {
  id: string;
  challengerId: string;
  challengerName: string;
  opponentId: string;
  opponentName: string;
  stake: number;
  status: ChallengeStatus;
  challengerStart: number | null;
  opponentStart: number | null;
}

function rowToChallenge(r: any): Challenge {
  return {
    id: String(r.id),
    challengerId: String(r.challenger_id),
    challengerName: r.challenger_name || String(r.challenger_id).slice(0, 6),
    opponentId: String(r.opponent_id),
    opponentName: r.opponent_name || String(r.opponent_id).slice(0, 6),
    stake: Number(r.stake),
    status: r.status,
    challengerStart: r.challenger_start == null ? null : Number(r.challenger_start),
    opponentStart: r.opponent_start == null ? null : Number(r.opponent_start),
  };
}

const CHALLENGE_COLUMNS = 'id, challenger_id, challenger_name, opponent_id, opponent_name, stake, status, challenger_start, opponent_start';

/**
 * A player's poker result at the table right now: what they cashed out, plus the chips in front
 * of them if they are still seated, less everything they bought in for.
 */
export async function currentPokerNet(roomId: string, playerId: string): Promise<number> {
  const result = await getPool().query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'cash_out' THEN amount ELSE -amount END), 0) AS net
     FROM chip_ledger WHERE room_id = $1 AND player_id = $2`,
    [roomId, playerId]
  );
  const ledgerNet = Number(result.rows[0]?.net) || 0;
  const seats = await GameSeats.loadPersistedRoomSeats(roomId) || GameSeats.getRoomSeats(roomId);
  const seat = Object.values(seats || {}).find(s => s?.playerId === playerId);
  if (!seat) return ledgerNet;
  const engine = await getOrRestoreEngine(roomId).catch(() => null);
  const inGame = engine?.getState().players.find(p => p.id === playerId);
  return ledgerNet + (inGame ? inGame.stack : Number(seat.chips) || 0);
}

/** Challenges at the table that are waiting for an answer or under way. */
export async function loadOpenChallenges(db: Queryable, roomId: string): Promise<Challenge[]> {
  const result = await db.query(
    `SELECT ${CHALLENGE_COLUMNS} FROM side_bet_challenges
     WHERE room_id = $1 AND status IN ('pending', 'active') ORDER BY created_at`,
    [roomId]
  );
  return result.rows.map(rowToChallenge);
}

export async function createChallenge(db: Queryable, args: {
  roomId: string; challengerId: string; challengerName: string; opponentId: string; opponentName: string; stake: number;
}): Promise<{ ok: true; challenge: Challenge } | { ok: false; error: string }> {
  if (args.challengerId === args.opponentId) return { ok: false, error: 'Challenge another player' };
  const existing = await db.query(
    `SELECT 1 FROM side_bet_challenges
     WHERE room_id = $1 AND status IN ('pending', 'active')
       AND ((challenger_id = $2 AND opponent_id = $3) OR (challenger_id = $3 AND opponent_id = $2))
     LIMIT 1`,
    [args.roomId, args.challengerId, args.opponentId]
  );
  if (existing.rows.length) return { ok: false, error: 'You already have a head to head with that player' };
  const result = await db.query(
    `INSERT INTO side_bet_challenges (room_id, challenger_id, challenger_name, opponent_id, opponent_name, stake)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CHALLENGE_COLUMNS}`,
    [args.roomId, args.challengerId, args.challengerName, args.opponentId, args.opponentName, args.stake]
  );
  return { ok: true, challenge: rowToChallenge(result.rows[0]) };
}

/**
 * The opponent accepts a pending challenge: both players' poker results are noted now, and the
 * head to head is decided by how each changes from here.
 */
export async function acceptChallenge(db: Queryable, roomId: string, challengeId: string, playerId: string): Promise<{ ok: boolean; error?: string }> {
  const found = await db.query(
    `SELECT ${CHALLENGE_COLUMNS} FROM side_bet_challenges WHERE id::text = $1 AND room_id = $2 AND status = 'pending'`,
    [challengeId, roomId]
  );
  const challenge = found.rows[0] ? rowToChallenge(found.rows[0]) : null;
  if (!challenge || challenge.opponentId !== playerId) return { ok: false, error: 'That challenge is no longer waiting for you' };
  const [challengerStart, opponentStart] = await Promise.all([
    currentPokerNet(roomId, challenge.challengerId),
    currentPokerNet(roomId, challenge.opponentId),
  ]);
  const updated = await db.query(
    `UPDATE side_bet_challenges SET status = 'active', challenger_start = $2, opponent_start = $3, accepted_at = NOW()
     WHERE id::text = $1 AND status = 'pending'`,
    [challengeId, challengerStart, opponentStart]
  );
  return (updated.rowCount ?? 0) > 0 ? { ok: true } : { ok: false, error: 'That challenge is no longer waiting for you' };
}

/** Either player withdraws a challenge that hasn't been accepted (the opponent declining it). */
export async function cancelChallenge(db: Queryable, roomId: string, challengeId: string, playerId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE side_bet_challenges SET status = 'cancelled', settled_at = NOW()
     WHERE id::text = $1 AND room_id = $2 AND status = 'pending' AND (challenger_id = $3 OR opponent_id = $3)`,
    [challengeId, roomId, playerId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Who won a head to head: the player whose poker result went up more (or down less) since it
 * was accepted. Null for a tie.
 */
export function headToHeadResult(challenge: Pick<Challenge, 'challengerStart' | 'opponentStart'>, challengerNow: number, opponentNow: number) {
  const challengerChange = Math.round((challengerNow - (challenge.challengerStart ?? 0)) * 100) / 100;
  const opponentChange = Math.round((opponentNow - (challenge.opponentStart ?? 0)) * 100) / 100;
  const winner = challengerChange === opponentChange ? null : challengerChange > opponentChange ? 'challenger' as const : 'opponent' as const;
  return { challengerChange, opponentChange, winner };
}

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${formatMoney(Math.abs(n))}`;

/**
 * A player has left the table: settle every head to head they were in and call off any still
 * waiting for an answer. Never throws; a failure only costs the head to head.
 */
export async function settleChallengesFor(roomId: string, playerId: string): Promise<void> {
  let challenges: Challenge[];
  let pool: Pool;
  try {
    pool = getPool();
    challenges = (await loadOpenChallenges(pool, roomId)).filter(c => c.challengerId === playerId || c.opponentId === playerId);
  } catch (err: any) {
    // No database, or none with the challenges table yet: leaving the table must still work
    if (err?.code !== '42P01') console.warn('[head-to-head] Could not load challenges:', err);
    return;
  }
  for (const c of challenges) {
    try {
      if (c.status === 'pending') {
        await pool.query(`UPDATE side_bet_challenges SET status = 'cancelled', settled_at = NOW() WHERE id = $1 AND status = 'pending'`, [c.id]);
        continue;
      }
      const [challengerNow, opponentNow] = await Promise.all([
        currentPokerNet(roomId, c.challengerId),
        currentPokerNet(roomId, c.opponentId),
      ]);
      const result = headToHeadResult(c, challengerNow, opponentNow);
      // Only the request that marks it settled pays it
      const marked = await pool.query(
        `UPDATE side_bet_challenges SET status = 'settled', settled_at = NOW() WHERE id = $1 AND status = 'active'`,
        [c.id]
      );
      if ((marked.rowCount ?? 0) === 0) continue;
      const summary = `${c.challengerName} ${signed(result.challengerChange)}, ${c.opponentName} ${signed(result.opponentChange)}`;
      if (!result.winner) {
        await postSystemChatMessage(roomId, `Side bet · Head to head: ${summary}. A tie, so it's a push`).catch(() => {});
        continue;
      }
      const [winnerId, winnerName, loserId, loserName] = result.winner === 'challenger'
        ? [c.challengerId, c.challengerName, c.opponentId, c.opponentName]
        : [c.opponentId, c.opponentName, c.challengerId, c.challengerName];
      for (const [id, name, amount, other] of [[winnerId, winnerName, c.stake, loserName], [loserId, loserName, -c.stake, winnerName]] as const) {
        await pool.query(
          `INSERT INTO side_bet_entries (room_id, hand_id, hand_number, bet, player_id, player_name, amount, note)
           VALUES ($1, $2, 0, 'head-to-head', $3, $4, $5, $6)
           ON CONFLICT (hand_id, bet, player_id) DO NOTHING`,
          [roomId, `h2h:${c.id}`, id, name, amount, `Head to head vs ${other}`]
        );
      }
      await postSystemChatMessage(roomId, `Side bet · Head to head: ${summary}. ${winnerName} wins ${formatMoney(c.stake)}`).catch(() => {});
    } catch (err) {
      console.warn('[head-to-head] Could not settle a challenge:', err);
    }
  }
}
