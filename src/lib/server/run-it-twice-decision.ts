import type { NextApiResponse } from 'next';
import { disableRunItPrompt, enrichStateWithRunIt, isAutoRunoutEligible } from '../poker/run-it-twice-manager';
import { clearSupabaseAutoRunout, runSupabaseAutoRunoutSync } from '../poker/supabase-auto-runout';
import { persistEngineState, StaleGameStateError } from '../poker/engine-persistence';
import { sanitizeStateForBroadcast } from '../poker/state-sanitizer';
import type { PokerEngine } from '../poker/poker-engine';
import type { TableState } from '../../types/poker';
import { postHandResultToChat } from '../utils/post-hand-result';
import { broadcastGameState, getIo } from './game-action-pipeline';

const revealAllHoleCards = (engine: any, state: TableState): TableState => {
  try {
    const engineState = engine?.getState?.();
    if (!engineState) return state;
    const enginePlayers = Array.isArray(engineState.players) ? engineState.players : [];
    const mergedPlayers = Array.isArray(state.players)
      ? state.players.map((player: any) => {
          const engPlayer = enginePlayers.find((ep: any) => ep.id === player.id);
          const engCards = Array.isArray(engPlayer?.holeCards) ? engPlayer.holeCards : [];
          if (!engCards.length) return player;
          const alreadyVisible = Array.isArray(player.holeCards) && player.holeCards.length >= engCards.length;
          if (alreadyVisible) return player;
          return { ...player, holeCards: engCards };
        })
      : state.players;
    return { ...state, players: mergedPlayers } as TableState;
  } catch {
    return state;
  }
};

/**
 * Carry out the Run-It-Twice decision for the current prompt: run the board `runs` times (1 means
 * declined), save, broadcast and run the board out. Callers check who may decide and how many runs
 * are allowed. A 'conflict' means another request changed the game first.
 */
export async function resolveRunItTwiceDecision(opts: {
  tableId: string;
  engine: PokerEngine;
  res: NextApiResponse;
  playerId: string;
  runs: number;
  // Recorded on the broadcast, e.g. when the clock decided for the player
  reason?: string;
}): Promise<{ status: 'ok'; state: TableState } | { status: 'conflict' }> {
  const { tableId, engine, res, playerId, runs, reason } = opts;
  const autoRunoutDebug = !!process.env.AUTO_RUNOUT_DEBUG;
  const gameState = engine.getState();
  clearSupabaseAutoRunout(tableId);

  let updatedState: TableState;
  let actionName: 'run_it_twice_declined' | 'run_it_twice_enabled';

  if (runs === 1) {
    if (autoRunoutDebug) {
      console.log(`[rit-decision] Player ${playerId} declined Run-It-Twice for table ${tableId}`);
    }
    disableRunItPrompt(tableId, true);
    engine.setRunItTwicePrompt(null, true);
    const baseState: TableState = {
      ...gameState,
      runItTwicePrompt: null,
      runItTwicePromptDisabled: true,
      activePlayer: '' as any,
    };
    updatedState = revealAllHoleCards(engine, baseState);
    actionName = 'run_it_twice_declined';
  } else {
    if (autoRunoutDebug) {
      console.log(`[rit-decision] Player ${playerId} accepted Run-It-Twice with ${runs} runs for table ${tableId}`);
    }
    if (typeof engine.enableRunItTwice === 'function') {
      engine.enableRunItTwice(runs);
    }
    disableRunItPrompt(tableId, true);
    engine.setRunItTwicePrompt(null, true);
    const baseState: TableState = {
      ...engine.getState(),
      runItTwicePrompt: null,
      runItTwicePromptDisabled: true,
      activePlayer: '' as any,
    };
    updatedState = revealAllHoleCards(engine, baseState);
    actionName = 'run_it_twice_enabled';
  }

  // Persist engine state for serverless recovery
  if ((await persistEngineState(tableId, engine)) === 'conflict') {
    return { status: 'conflict' };
  }

  const lastAction = reason ? { action: actionName, playerId, runs, reason } : { action: actionName, playerId, runs };
  const enrichedState = await broadcastGameState(tableId, res, updatedState, lastAction);
  try {
    const io = getIo(res);
    if (io && actionName === 'run_it_twice_enabled') {
      io.to(`table_${tableId}`).emit('rit_enabled', { tableId, runs, rit: sanitizeStateForBroadcast(enrichedState).runItTwice });
    }
  } catch (e) {
    console.warn('Failed to emit via socket:', e);
  }

  // Run auto-runout synchronously if eligible, keeping the API handler alive
  if (isAutoRunoutEligible(updatedState)) {
    // Track whether we've already posted the hand result for auto-runout
    let handResultPosted = false;
    // Use synchronous runout that awaits delays - this keeps the serverless function alive
    await runSupabaseAutoRunoutSync(tableId, engine, async (state, meta) => {
      // Stop the runout rather than broadcast a state another request has replaced
      if ((await persistEngineState(tableId, engine)) === 'conflict') throw new StaleGameStateError(tableId);
      await broadcastGameState(tableId, res, state, meta);
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

  // Final state after the runout completes
  return { status: 'ok', state: enrichStateWithRunIt(tableId, engine.getState()) };
}
