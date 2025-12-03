import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import {
  enrichStateWithRunIt,
  maybeCreateRunItPrompt,
  isAutoRunoutEligible,
} from '../../../src/lib/poker/run-it-twice-manager';
import { scheduleSupabaseAutoRunout, clearSupabaseAutoRunout } from '../../../src/lib/poker/supabase-auto-runout';
import type { Card, GameStage, TableState } from '../../../src/types/poker';
import { postHandResultToChat } from '../../../src/lib/utils/post-hand-result';

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
    clearSupabaseAutoRunout(tableId);

    // Log current game state for debugging
    const currentState = engine.getState();
    console.log('[action] Current activePlayer:', currentState.activePlayer, 'Action from:', playerId, 'Action:', action);

    // Snapshot community cards/stage before applying the action so we can detect premature board reveals
    const preActionCommunity: Card[] = Array.isArray(currentState?.communityCards)
      ? currentState.communityCards.map((card: Card) => ({ ...card }))
      : [];
    const preActionStage: GameStage | undefined = currentState?.stage;

    const broadcastState = async (state: TableState, lastAction: any) => {
      const enrichedState = enrichStateWithRunIt(tableId, state);
      try {
        const seq = nextSeq(tableId);
        await publishGameStateUpdate(tableId, {
          gameState: enrichedState,
          lastAction,
          timestamp: new Date().toISOString(),
          seq,
        } as any);
      } catch (e) {
        console.warn('Failed to publish game state to Supabase:', e);
      }

      try {
        const io = getIo(res);
        if (io) {
          const seq = nextSeq(tableId);
          io.to(`table_${tableId}`).emit('game_state_update', {
            gameState: enrichedState,
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

    // Post hand result to chat when the game reaches showdown
    if (enrichedState.stage === 'showdown' && preActionStage !== 'showdown') {
      try {
        await postHandResultToChat(tableId, enrichedState);
      } catch (chatError) {
        // Log but don't fail the action if chat posting fails
        console.warn('Failed to post hand result to chat:', chatError);
      }
    }

    const shouldScheduleAutoRunout = autoEligible && !issuedPrompt;
    if (shouldScheduleAutoRunout) {
      // Track whether we've already posted the hand result for auto-runout
      let handResultPosted = false;
      scheduleSupabaseAutoRunout(tableId, engine, async (state, meta) => {
        await broadcastState(state, meta);
        // Post hand result to chat when auto-runout reaches showdown
        if (state.stage === 'showdown' && !handResultPosted) {
          handResultPosted = true;
          try {
            await postHandResultToChat(tableId, state);
          } catch (chatError) {
            console.warn('Failed to post hand result to chat (auto-runout):', chatError);
          }
        }
      });
    }

    return res.status(200).json({ success: true, gameState: enrichedState });
  } catch (e: any) {
    console.error('Error processing poker action:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
}
