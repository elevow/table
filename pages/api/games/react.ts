import type { NextApiRequest, NextApiResponse } from 'next';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { publishTableEvent } from '../../../src/lib/realtime/publisher';
import { getRoomSeats, loadPersistedRoomSeats, type GameSeats } from '../../../src/lib/shared/game-seats';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';
import { isTableReaction, REACTION_COOLDOWN_MS } from '../../../src/lib/shared/reactions';

const hasSeat = (seats: GameSeats | null, playerId: string) =>
  !!seats && Object.values(seats).some(seat => seat?.playerId === playerId);

/** Seated at the table, or dealt into its game (seat records can lag behind the game). */
async function isAtTable(tableId: string, playerId: string): Promise<boolean> {
  if (hasSeat(getRoomSeats(tableId), playerId)) return true;
  if (hasSeat(await loadPersistedRoomSeats(tableId), playerId)) return true;
  try {
    const engine = await getOrRestoreEngine(tableId);
    return !!engine?.getState().players.some(p => p.id === playerId);
  } catch {
    return false;
  }
}

/**
 * POST /api/games/react { tableId, emote }
 *
 * Show a quick reaction (from a fixed list) over your seat for everyone at the table.
 * Only seated players can react, at most once every two seconds.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { tableId, playerId: claimedPlayerId, emote } = (req.body || {}) as { tableId?: unknown; playerId?: string; emote?: unknown };
  const playerId = await requirePlayer(req, res, claimedPlayerId, 'game.react');
  if (!playerId) return;
  if (typeof tableId !== 'string' || !tableId) return res.status(400).json({ error: 'Missing tableId' });
  if (!isTableReaction(emote)) return res.status(400).json({ error: 'Unknown reaction' });

  // Counted before the seat lookup so spamming can't drive database reads
  const limit = rateLimit(`reaction:${playerId}`, { windowMs: REACTION_COOLDOWN_MS, max: 1, key: 'table-reaction' });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))));
    return res.status(429).json({ error: 'Too many reactions', code: 'RATE_LIMITED' });
  }

  try {
    if (!(await isAtTable(tableId, playerId))) {
      return res.status(403).json({ error: 'Only players at the table can react' });
    }
    await publishTableEvent(tableId, { type: 'reaction', playerId, emote });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error publishing reaction:', err);
    return res.status(500).json({ error: 'Unable to send reaction' });
  }
}
