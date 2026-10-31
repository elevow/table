import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import { clearRunItState, enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { defaultBettingModeForVariant } from '../../../src/lib/game/variant-mapping';
import type { GameVariant } from '../../../src/types/poker';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { getDealerChoiceChooserId } from '../../../src/lib/poker/dealer-choice';
import { ALL_VARIANTS } from '../../../src/lib/poker/variant-rules';

const ALLOWED_VARIANTS: GameVariant[] = [...ALL_VARIANTS];

function isValidVariant(v: unknown): v is GameVariant {
  return typeof v === 'string' && ALLOWED_VARIANTS.includes(v as GameVariant);
}

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

/**
 * POST /api/games/choose-variant
 *
 * Called by the dealer in a Dealer's Choice game to select which poker
 * variant will be played for the next hand. The game must currently be
 * in the 'awaiting-dealer-choice' stage.
 *
 * Body: { tableId, playerId, variant }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tableId, playerId: claimedPlayerId, variant: rawVariant } = req.body ?? {};

  const playerId = await requirePlayer(req, res, claimedPlayerId, 'game.play');
  if (!playerId) return;

  if (!tableId) {
    return res.status(400).json({ error: 'Missing tableId' });
  }

  if (!isValidVariant(rawVariant)) {
    return res.status(400).json({
      error: `Invalid variant. Must be one of: ${ALLOWED_VARIANTS.join(', ')}`,
    });
  }

  const chosenVariant: GameVariant = rawVariant;

  try {
    const engine = await getOrRestoreEngine(tableId);
    if (!engine || typeof engine.getState !== 'function') {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    const currentState = engine.getState();
    if (currentState.stage !== 'awaiting-dealer-choice') {
      return res.status(409).json({
        error: 'Game is not waiting for a dealer variant choice',
        stage: currentState.stage,
      });
    }

    if (getDealerChoiceChooserId(currentState) !== playerId) {
      return res.status(403).json({ error: 'Only the dealer can choose the variant' });
    }
    if (currentState.paused) {
      return res.status(409).json({ error: 'The host has paused the game', code: 'PAUSED' });
    }
    if (typeof engine.canStartNewHand === 'function' && !engine.canStartNewHand()) {
      return res.status(409).json({ error: 'Waiting for at least two players to sit in', code: 'NOT_ENOUGH_PLAYERS_SITTING_IN' });
    }

    // Apply the chosen variant and matching betting mode
    if (typeof engine.setVariant === 'function') {
      engine.setVariant(chosenVariant);
    }
    const bettingMode = defaultBettingModeForVariant(chosenVariant);
    if (typeof engine.setBettingMode === 'function') {
      engine.setBettingMode(bettingMode);
    }

    // Clear Run-It-Twice state and start the new hand
    clearRunItState(tableId);
    engine.startNewHand();

    // Persist updated engine state for serverless recovery
    if ((await persistEngineState(tableId, engine)) === 'conflict') {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }

    // Store chosen variant in room config for future hands
    const g: any = global as any;
    if (g.roomConfigs?.get(tableId)) {
      const roomConfig = g.roomConfigs.get(tableId);
      roomConfig.chosenVariant = chosenVariant;
      g.roomConfigs.set(tableId, roomConfig);
    }

    const gameState = engine.getState();
    const enrichedState = enrichStateWithRunIt(tableId, gameState);
    const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
    const lastAction = { action: 'variant_chosen', playerId, variant: chosenVariant };
    const seq = nextSeq(tableId);

    // Broadcast new game state via Supabase Realtime (swallow errors like other handlers)
    try {
      await publishGameStateUpdate(tableId, {
        gameState: broadcastSafeState,
        lastAction,
        timestamp: new Date().toISOString(),
        seq,
      });
    } catch (e) {
      console.warn('[choose-variant] Failed to publish game state to Supabase:', e);
    }

    // Also emit over socket.io for non-Supabase clients
    try {
      const io = getIo(res);
      if (io) {
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState: broadcastSafeState,
          lastAction,
          timestamp: new Date().toISOString(),
          seq,
        });
      }
    } catch (e) {
      console.warn('[choose-variant] Failed to emit via socket:', e);
    }

    const sanitizedState = sanitizeStateForPlayer(enrichedState, playerId);
    return res.status(200).json({ success: true, gameState: sanitizedState });
  } catch (e: unknown) {
    console.error('[choose-variant] Error:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}