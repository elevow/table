import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { broadcastGameState } from '../../../src/lib/server/game-action-pipeline';
import { markCardsShown } from '../../../src/lib/server/hand-records';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

/**
 * POST /api/games/show-cards  { tableId }
 *
 * After a hand ends, the signed-in player turns their cards face up for the table. Without this,
 * a player who lost at showdown, folded, or won uncontested keeps their cards hidden.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId: claimedPlayerId } = (req.body || {}) as { tableId?: string; playerId?: string };

  const playerId = await requirePlayer(req, res, claimedPlayerId);
  if (!playerId) return;
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });

  try {
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    try {
      engine.showCards(playerId);
    } catch (e: any) {
      return res.status(409).json({ error: e?.message || 'Cannot show cards now' });
    }
    if ((await persistEngineState(tableId, engine)) === 'conflict') {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }

    const handId = engine.getState().handId;
    if (handId) {
      // Hand history shows the cards to the others in the hand from now on
      markCardsShown(handId, playerId).catch(err => console.warn('Failed to mark shown cards in history:', err));
    }
    const state = await broadcastGameState(tableId, res, engine.getState(), { action: 'show_cards', playerId });
    return res.status(200).json({ success: true, gameState: sanitizeStateForPlayer(state, playerId) });
  } catch (e: unknown) {
    console.error('Error showing cards:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
