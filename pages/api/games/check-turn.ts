import type { NextApiRequest, NextApiResponse } from 'next';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';

/**
 * GET /api/games/check-turn?tableId=xxx&playerId=yyy
 * 
 * Lightweight endpoint for players to poll if it's their turn.
 * Returns minimal data to reduce overhead compared to full state fetch.
 * 
 * This is used by clients to poll every 10 seconds when waiting for their turn,
 * complementing the existing Supabase Realtime notifications.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tableId = String(req.query.tableId || '');
  const playerId = String(req.query.playerId || '');

  if (!tableId || !playerId) {
    return res.status(400).json({ error: 'Missing tableId or playerId' });
  }

  try {
    // Get the active game engine from memory or restore from database
    const engine = await getOrRestoreEngine(tableId);
    
    if (!engine || typeof engine.getState !== 'function') {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    const gameState = engine.getState();
    
    // Return minimal turn status information
    return res.status(200).json({
      success: true,
      isMyTurn: gameState.activePlayer === playerId,
      activePlayer: gameState.activePlayer,
      tableState: gameState.stage || 'waiting',
      handNumber: gameState.handNumber || 0
    });
  } catch (e: unknown) {
    console.error('Error checking turn status:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
