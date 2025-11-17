import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';

function getIo(res: NextApiResponse): any | null {
  try {
    // @ts-ignore
    const io = (res as any)?.socket?.server?.io;
    return io || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId, action, amount } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    action?: string;
    amount?: number;
  };

  if (!tableId || !playerId || !action) {
    return res.status(400).json({ error: 'Missing tableId, playerId, or action' });
  }

  try {
    // Get the active game engine from global storage
    const g: any = global as any;
    const engine = g?.activeGames?.get(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    // Log current game state for debugging
    const currentState = engine.getState();
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

    // Process the action using handleAction
    try {
      engine.handleAction(playerAction);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || 'Action failed' });
    }

    // Get updated game state
    const gameState = engine.getState();

    // Broadcast via Supabase Realtime
    try {
      const seq = nextSeq(tableId);
      await publishGameStateUpdate(tableId, {
        gameState,
        lastAction: { action, playerId, amount },
        timestamp: new Date().toISOString(),
        seq,
      } as any);
    } catch (e) {
      console.warn('Failed to publish game state to Supabase:', e);
    }

    // Also emit over socket if available (hybrid compatibility)
    try {
      const io = getIo(res);
      if (io) {
        const seq = nextSeq(tableId);
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState,
          lastAction: { action, playerId, amount },
          timestamp: new Date().toISOString(),
          seq,
        });
      }
    } catch (e) {
      console.warn('Failed to emit via socket:', e);
    }

    return res.status(200).json({ success: true, gameState });
  } catch (e: any) {
    console.error('Error processing poker action:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
}
