import type { NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../realtime/publisher';
import { nextSeq } from '../realtime/sequence';
import {
  enrichStateWithRunIt,
  maybeCreateRunItPrompt,
  isAutoRunoutEligible,
} from '../poker/run-it-twice-manager';
import { runSupabaseAutoRunoutSync, clearSupabaseAutoRunout } from '../poker/supabase-auto-runout';
import { sanitizeStateForBroadcast } from '../poker/state-sanitizer';
import { persistEngineState, StaleGameStateError } from '../poker/engine-persistence';
import type { PokerEngine } from '../poker/poker-engine';
import { RUN_IT_TWICE_DECISIONS_ENABLED } from '../shared/feature-flags';
import type { Card, GameStage, TableState } from '../../types/poker';
import { finishHand } from './hand-records';

// Socket.io server type (simplified to avoid external dependency)
type SocketIOServer = {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
};

export function getIo(res: NextApiResponse): SocketIOServer | null {
  try {
    // @ts-ignore
    const io = (res as any)?.socket?.server?.io;
    return io || null;
  } catch {
    return null;
  }
}

/**
 * Send a game state to everyone at the table (hidden cards stripped) and return it with the
 * Run-It-Twice view applied, for the caller to sanitize for its own player.
 */
export async function broadcastGameState(
  tableId: string,
  res: NextApiResponse,
  state: TableState,
  lastAction: unknown
): Promise<TableState> {
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
}

export type GameActionResult =
  | { status: 'ok'; state: TableState }
  | { status: 'conflict' }
  | { status: 'rejected'; error: string };

/**
 * Apply one betting decision to a table and carry out everything that follows it: save the game,
 * offer Run It Twice or run the board out, broadcast each step and post the result to chat.
 *
 * `apply` changes the engine (a player's action, or the clock acting for them) and throws if the
 * decision is not allowed. A 'conflict' means another request changed the game first.
 */
export async function runGameAction(opts: {
  tableId: string;
  engine: PokerEngine;
  res: NextApiResponse;
  apply: () => void;
  lastAction: unknown;
}): Promise<GameActionResult> {
  const { tableId, engine, res, apply, lastAction } = opts;
  const currentState = engine.getState();
  clearSupabaseAutoRunout(tableId);

  // Snapshot community cards/stage before applying the action so we can detect premature board reveals
  const preActionCommunity: Card[] = Array.isArray(currentState?.communityCards)
    ? currentState.communityCards.map((card: Card) => ({ ...card }))
    : [];
  const preActionStage: GameStage | undefined = currentState?.stage;

  try {
    apply();
  } catch (e: any) {
    return { status: 'rejected', error: e?.message || 'Action failed' };
  }

  // Persist the updated engine state to database for serverless recovery. A conflict means
  // another request (e.g. a duplicate submit) changed the game first, so this action is dropped.
  if ((await persistEngineState(tableId, engine)) === 'conflict') {
    return { status: 'conflict' };
  }

  let gameState = engine.getState();

  // Check if we should issue a Run-It-Twice prompt
  const autoRunoutDebug = !!process.env.AUTO_RUNOUT_DEBUG;
  const autoEligible = isAutoRunoutEligible(gameState);
  let issuedPrompt = null;
  if (autoEligible && RUN_IT_TWICE_DECISIONS_ENABLED) {
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
      console.log('[game-action] Issued Run-It-Twice prompt:', issuedPrompt);
    }
  }

  if (issuedPrompt) {
    engine.setRunItTwicePrompt(issuedPrompt);
    gameState = engine.getState();
    if ((await persistEngineState(tableId, engine)) === 'conflict') {
      return { status: 'conflict' };
    }
  } else if (autoEligible) {
    engine.setAutoRunoutProgress(gameState.stage, gameState.communityCards);
    gameState = engine.getState();
    if ((await persistEngineState(tableId, engine)) === 'conflict') {
      return { status: 'conflict' };
    }
  }

  const enrichedState = await broadcastGameState(tableId, res, gameState, lastAction);

  // Post hand result to chat when the game reaches showdown
  if (enrichedState.stage === 'showdown' && preActionStage !== 'showdown') {
    try {
      await finishHand(tableId, enrichedState);
    } catch (chatError) {
      // Log but don't fail the action if chat posting fails
      console.warn('Failed to post hand result to chat:', chatError);
    }
  }

  const shouldScheduleAutoRunout = autoEligible && !issuedPrompt;
  if (shouldScheduleAutoRunout) {
    // Track whether we've already posted the hand result for auto-runout
    let handResultPosted = false;
    await runSupabaseAutoRunoutSync(tableId, engine, async (state, meta) => {
      // Stop the runout rather than broadcast a state another request has replaced
      if ((await persistEngineState(tableId, engine)) === 'conflict') throw new StaleGameStateError(tableId);
      await broadcastGameState(tableId, res, state, meta);
      // Post hand result to chat when auto-runout reaches showdown
      if (state.stage === 'showdown' && !handResultPosted) {
        handResultPosted = true;
        try {
          await finishHand(tableId, state);
        } catch (chatError) {
          console.warn('Failed to post hand result to chat (auto-runout):', chatError);
        }
      }
    });
  }

  // After a runout, answer with where it ended so the caller's view isn't rolled back to before it
  const finalState = shouldScheduleAutoRunout ? enrichStateWithRunIt(tableId, engine.getState()) : enrichedState;
  return { status: 'ok', state: finalState };
}
