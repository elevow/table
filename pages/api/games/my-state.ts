import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';

/**
 * API endpoint to get the current player's personalized game state.
 * Returns the game state with the player's own hole cards visible.
 * 
 * This is needed because Supabase broadcasts hide all hole cards for privacy,
 * but players need to see their own cards.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tableId = String(req.query.tableId || '');
  const playerId = String(req.query.playerId || '');

  if (!tableId || !playerId) {
    return res.status(400).json({ error: 'Missing tableId or playerId' });
  }

  try {
    const g = global as any;
    const engine = g?.activeGames?.get(tableId);

    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    const state = engine.getState();
    const enrichedState = enrichStateWithRunIt(tableId, state);
    const sanitizedState = sanitizeStateForPlayer(enrichedState, playerId);

    return res.status(200).json({ success: true, gameState: sanitizedState });
  } catch (e: any) {
    console.error('Error getting player state:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
}
