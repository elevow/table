import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { runGameAction } from '../../../src/lib/server/game-action-pipeline';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

// An all-in runs the board out, with pauses between streets
export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId: claimedPlayerId, action, amount, expectedTurnSeq } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    action?: string;
    amount?: number;
    // turnSeq of the state the player acted on; omitted by older clients
    expectedTurnSeq?: number;
  };

  const playerId = await requirePlayer(req, res, claimedPlayerId);
  if (!playerId) return;

  if (!tableId || !action) {
    return res.status(400).json({ error: 'Missing tableId or action' });
  }

  try {
    // Get the active game engine from memory or restore from database
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    const currentState = engine.getState();

    // Refuse an action made on an earlier state, e.g. a duplicate submit arriving after the first
    // was applied and the turn came back to the same player on the next street
    if (typeof expectedTurnSeq === 'number' && expectedTurnSeq !== (currentState.turnSeq || 0)) {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }

    // Log current game state for debugging
    console.log('[action] Current activePlayer:', currentState.activePlayer, 'Action from:', playerId, 'Action:', action);

    // Build PlayerAction object
    const playerAction = {
      type: action.toLowerCase() as 'bet' | 'call' | 'raise' | 'fold' | 'check',
      playerId,
      tableId,
      amount,
      timestamp: Date.now(),
    };

    // Validate action type
    const validActions = ['fold', 'check', 'call', 'bet', 'raise'];
    if (!validActions.includes(playerAction.type)) {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    // Validate amount for bet/raise
    if ((playerAction.type === 'bet' || playerAction.type === 'raise') && typeof amount !== 'number') {
      return res.status(400).json({ error: `${playerAction.type} action requires an amount` });
    }

    const result = await runGameAction({
      tableId,
      engine,
      res,
      apply: () => engine.handleAction(playerAction),
      lastAction: { action, playerId, amount },
    });
    if (result.status === 'rejected') {
      return res.status(400).json({ error: result.error });
    }
    if (result.status === 'conflict') {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }

    // Sanitize the response for the requesting player - hide other players' hole cards
    // unless it's showdown or an all-in situation
    const sanitizedState = sanitizeStateForPlayer(result.state, playerId);

    return res.status(200).json({ success: true, gameState: sanitizedState });
  } catch (e: unknown) {
    console.error('Error processing poker action:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
