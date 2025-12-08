import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import {
  getRunItState,
  disableRunItPrompt,
  enrichStateWithRunIt,
  isAutoRunoutEligible,
} from '../../../src/lib/poker/run-it-twice-manager';
import { clearSupabaseAutoRunout } from '../../../src/lib/poker/supabase-auto-runout';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState } from '../../../src/lib/poker/engine-persistence';
import type { TableState } from '../../../src/types/poker';
import { postHandResultToChat } from '../../../src/lib/utils/post-hand-result';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId, runs } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    runs?: number;
  };

  if (!tableId || !playerId || typeof runs !== 'number') {
    return res.status(400).json({ error: 'Missing tableId, playerId, or runs' });
  }

  try {
    const meta = getRunItState(tableId);
    
    // Validate that this player has an active prompt
    if (!meta.prompt || meta.prompt.playerId !== playerId) {
      return res.status(400).json({ error: 'No active Run-It-Twice prompt for this player' });
    }

    // Get the active game engine from memory or restore from database
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    clearSupabaseAutoRunout(tableId);

    const autoRunoutDebug = !!process.env.AUTO_RUNOUT_DEBUG;
    const gameState = engine.getState();

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
          if (typeof lastAction === 'object' && lastAction !== null && 'action' in lastAction && (lastAction as { action: string }).action === 'run_it_twice_enabled') {
            io.to(`table_${tableId}`).emit('rit_enabled', { tableId, runs: (lastAction as { runs?: number }).runs, rit: broadcastSafeState.runItTwice });
          }
        }
      } catch (e) {
        console.warn('Failed to emit via socket:', e);
      }

      return enrichedState;
    };

    // Validate runs parameter
    const activePlayers = (gameState.players || []).filter((p: { isFolded?: boolean; folded?: boolean }) => !(p.isFolded || p.folded)).length || 0;
    const maxRuns = Math.max(1, activePlayers);
    if (runs < 1 || runs > maxRuns) {
      return res.status(400).json({ error: `Runs must be 1-${maxRuns}` });
    }

    let updatedState: TableState;
    let actionName: 'run_it_twice_declined' | 'run_it_twice_enabled';

    if (runs === 1) {
      if (autoRunoutDebug) {
        console.log(`[enable-rit.ts] Player ${playerId} declined Run-It-Twice for table ${tableId}`);
      }
      disableRunItPrompt(tableId, true);
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
        console.log(`[enable-rit.ts] Player ${playerId} accepted Run-It-Twice with ${runs} runs for table ${tableId}`);
      }
      if (typeof engine.enableRunItTwice === 'function') {
        engine.enableRunItTwice(runs);
      }
      disableRunItPrompt(tableId, true);
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
    await persistEngineState(tableId, engine);

    const enrichedState = await broadcastState(updatedState, { action: actionName, playerId, runs });

    // Server-side scheduling removed - client now handles auto-runout scheduling
    // Clear any existing server-side timers since client is polling
    if (isAutoRunoutEligible(updatedState)) {
      clearSupabaseAutoRunout(tableId);
    }

    // Sanitize the response for the requesting player - hide other players' hole cards
    // unless it's showdown or an all-in situation
    // Note: In RIT scenarios, this should typically show all cards since it's an all-in situation
    const sanitizedState = sanitizeStateForPlayer(enrichedState, playerId);

    return res.status(200).json({ success: true, runs, gameState: sanitizedState });
  } catch (e: unknown) {
    console.error('Error processing Run-It-Twice response:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
