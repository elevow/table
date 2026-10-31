import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { broadcastGameState } from '../../../src/lib/server/game-action-pipeline';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

/**
 * POST /api/games/straddle { tableId, wants }
 *
 * Ask to straddle next hand (posted only if you are under the gun then), or cancel the request.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { tableId, playerId: claimedPlayerId, wants } = (req.body || {}) as { tableId?: string; playerId?: string; wants?: boolean };
  const playerId = await requirePlayer(req, res, claimedPlayerId, wants === true ? 'game.straddle' : undefined);
  if (!playerId) return;
  if (!tableId || typeof wants !== 'boolean') return res.status(400).json({ error: 'Missing tableId or wants' });

  try {
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) return res.status(404).json({ error: 'No active game found for this table' });
    try {
      engine.setWantsStraddle(playerId, wants);
    } catch (e: any) {
      return res.status(409).json({ error: e?.message || 'Cannot straddle' });
    }
    if ((await persistEngineState(tableId, engine)) === 'conflict') return res.status(409).json(STALE_STATE_RESPONSE);
    const state = await broadcastGameState(tableId, res, engine.getState(), { action: wants ? 'straddle_requested' : 'straddle_cancelled', playerId });
    return res.status(200).json({ success: true, gameState: sanitizeStateForPlayer(state, playerId) });
  } catch (err) {
    console.error('Error updating straddle:', err);
    return res.status(500).json({ error: 'Unable to update straddle' });
  }
}
