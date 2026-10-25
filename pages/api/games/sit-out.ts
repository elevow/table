import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { broadcastGameState } from '../../../src/lib/server/game-action-pipeline';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

/**
 * POST /api/games/sit-out  { tableId, sittingOut }
 *
 * Sit the signed-in player out from the next hand on (keeping their seat and stack), or back in.
 * A hand already in progress is unaffected.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId: claimedPlayerId, sittingOut } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    sittingOut?: boolean;
  };

  const playerId = await requirePlayer(req, res, claimedPlayerId);
  if (!playerId) return;
  if (!tableId || typeof sittingOut !== 'boolean') {
    return res.status(400).json({ error: 'Missing tableId or sittingOut' });
  }

  try {
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    if (!engine.getState().players.some(p => p.id === playerId)) {
      return res.status(403).json({ error: 'Only a player in this game can sit out or back in' });
    }

    engine.setSittingOut(playerId, sittingOut);
    if ((await persistEngineState(tableId, engine)) === 'conflict') {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }

    const state = await broadcastGameState(tableId, res, engine.getState(), {
      action: sittingOut ? 'sit_out' : 'sit_in',
      playerId,
    });
    return res.status(200).json({ success: true, gameState: sanitizeStateForPlayer(state, playerId) });
  } catch (e: unknown) {
    console.error('Error changing sit-out status:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
