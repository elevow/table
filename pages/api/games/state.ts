import type { NextApiRequest, NextApiResponse } from 'next';
import { enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';

/**
 * GET /api/games/state?tableId=xxx
 * 
 * Returns the current game state for the authenticated player, or a spectator view.
 * The state is sanitized to only show the requesting player's hole cards
 * (unless it's showdown or an all-in situation).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tableId = String(req.query.tableId || '');

  if (!tableId) {
    return res.status(400).json({ error: 'Missing tableId' });
  }

  // Hole cards are only revealed to the authenticated session's own player;
  // a playerId query param is ignored so callers cannot view another player's cards.
  const playerId = await getAuthenticatedUserId(req);

  try {
    // Get the active game engine from memory or restore from database
    const engine = await getOrRestoreEngine(tableId);
    
    if (!engine || typeof engine.getState !== 'function') {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    const gameState = engine.getState();
    const enrichedState = enrichStateWithRunIt(tableId, gameState);
    
    // Sanitize the state for the requesting player - they see their own cards
    // but other players' cards are hidden unless showdown/all-in
    const sanitizedState = playerId
      ? sanitizeStateForPlayer(enrichedState, playerId)
      : sanitizeStateForBroadcast(enrichedState);

    return res.status(200).json({ success: true, gameState: sanitizedState });
  } catch (e: unknown) {
    console.error('Error fetching game state:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
