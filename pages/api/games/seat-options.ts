import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { broadcastGameState } from '../../../src/lib/server/game-action-pipeline';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

const OPTIONS = ['post-big-blind-now', 'leave-after-hand'] as const;
type SeatOption = typeof OPTIONS[number];

/**
 * POST /api/games/seat-options  { tableId, option, value }
 *
 * The signed-in player's choices about coming and going:
 * - post-big-blind-now: while waiting for the big blind, post one to be dealt in at the next hand
 * - leave-after-hand: stand up as soon as the current hand ends
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId: claimedPlayerId, option, value } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    option?: string;
    value?: boolean;
  };

  const playerId = await requirePlayer(req, res, claimedPlayerId);
  if (!playerId) return;
  if (!tableId || !OPTIONS.includes(option as SeatOption) || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'Missing tableId, option or value' });
  }

  try {
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    if (!engine.getState().players.some(p => p.id === playerId)) {
      return res.status(403).json({ error: 'Only a player in this game can change this' });
    }

    try {
      engine.setSeatOption(playerId, option as SeatOption, value);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : 'Not allowed' });
    }
    if ((await persistEngineState(tableId, engine)) === 'conflict') {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }

    const state = await broadcastGameState(tableId, res, engine.getState(), {
      action: option === 'leave-after-hand' ? (value ? 'leave_after_hand' : 'stay') : (value ? 'post_big_blind_now' : 'wait_for_big_blind'),
      playerId,
    });
    return res.status(200).json({ success: true, gameState: sanitizeStateForPlayer(state, playerId) });
  } catch (e: unknown) {
    console.error('Error changing seat option:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' });
  }
}
