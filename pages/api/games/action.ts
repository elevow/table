import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import {
  enrichStateWithRunIt,
  maybeCreateRunItPrompt,
  isAutoRunoutEligible,
} from '../../../src/lib/poker/run-it-twice-manager';
import { scheduleSupabaseAutoRunout, clearSupabaseAutoRunout } from '../../../src/lib/poker/supabase-auto-runout';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState } from '../../../src/lib/poker/engine-persistence';
import type { Card, GameStage, TableState } from '../../../src/types/poker';

// Socket.io server type (simplified to avoid external dependency)
type SocketIOServer = {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
};

function getIo(res: NextApiResponse): SocketIOServer | null {
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
    // Get the active game engine from memory or restore from database
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    clearSupabaseAutoRunout(tableId);

    // Log current game state for debugging
    const currentState = engine.getState();
    console.log('[action] Current activePlayer:', currentState.activePlayer, 'Action from:', playerId, 'Action:', action);

    // Snapshot community cards/stage before applying the action so we can detect premature board reveals
    const preActionCommunity: Card[] = Array.isArray(currentState?.communityCards)
      ? currentState.communityCards.map((card: Card) => ({ ...card }))
      : [];
    const preActionStage: GameStage | undefined = currentState?.stage;

    const broadcastState = async (state: TableState, lastAction: unknown) => {
      const enrichedState = enrichStateWithRunIt(tableId, state);
      // Sanitize state for broadcast - hide all hole cards unless showdown/all-in
      const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
      try {
        const seq = nextSeq(tableId);
        await publishGameStateUpdate(tableId, {
          gameState: broadcastSafeState,
          lastAction,
          timestamp: new Date().toISOString(),
          seq,
        });
      } catch (e) {
        console.warn('Failed to publish game state to Supabase:', e);
      }

      try {
        const io = getIo(res);
        if (io) {
          const seq = nextSeq(tableId);
          io.to(`table_${tableId}`).emit('game_state_update', {
            gameState: broadcastSafeState,
            lastAction,
            timestamp: new Date().toISOString(),
            seq,
          });
        }
      } catch (e) {
        console.warn('Failed to emit via socket:', e);
      }

      return enrichedState;
    };

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

    // Persist the updated engine state to database for serverless recovery
    await persistEngineState(tableId, engine);

    // Get updated game state
    let gameState = engine.getState();

    // Check if we should issue a Run-It-Twice prompt
    const autoRunoutDebug = !!process.env.AUTO_RUNOUT_DEBUG;
    const autoEligible = isAutoRunoutEligible(gameState);
    let issuedPrompt = null;
    if (autoEligible) {
      const postCommunityCount = Array.isArray(gameState.communityCards) ? gameState.communityCards.length : 0;
      const preCommunityCount = preActionCommunity.length;
      const boardAdvanced = postCommunityCount > preCommunityCount;
      const promptOptions = boardAdvanced
        ? {
            communityOverride: preActionCommunity,
            boardVisibleCount: preCommunityCount,
            stageOverride: preActionStage,
          }
        : undefined;
      issuedPrompt = maybeCreateRunItPrompt(tableId, gameState, promptOptions);
      if (autoRunoutDebug && issuedPrompt) {
        console.log('[action.ts] Issued Run-It-Twice prompt:', issuedPrompt);
      }
    }

    if (issuedPrompt) {
      gameState = { ...gameState, activePlayer: issuedPrompt.playerId };
    }

    const enrichedState = await broadcastState(gameState, { action, playerId, amount });

    const shouldScheduleAutoRunout = autoEligible && !issuedPrompt;
    if (shouldScheduleAutoRunout) {
      scheduleSupabaseAutoRunout(tableId, engine, (state, meta) => broadcastState(state, meta).then(() => {}));
    }

    // Sanitize the response for the requesting player - hide other players' hole cards
    // unless it's showdown or an all-in situation
    const sanitizedState = sanitizeStateForPlayer(enrichedState, playerId);

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
