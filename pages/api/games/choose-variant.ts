import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import { clearRunItState, enrichStateWithRunIt } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer, sanitizeStateForBroadcast } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, persistEngineState } from '../../../src/lib/poker/engine-persistence';
import { defaultBettingModeForVariant } from '../../../src/lib/game/variant-mapping';
import type { GameVariant } from '../../../src/types/poker';

const ALLOWED_VARIANTS: GameVariant[] = [
  'texas-holdem',
  'omaha',
  'omaha-hi-lo',
  'seven-card-stud',
  'seven-card-stud-hi-lo',
  'five-card-stud',
];

function isValidVariant(v: unknown): v is GameVariant {
  return typeof v === 'string' && ALLOWED_VARIANTS.includes(v as GameVariant);
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

  const { tableId, playerId, variant: rawVariant } = req.body ?? {};

  if (!tableId || !playerId) {
    return res.status(400).json({ error: 'Missing tableId or playerId' });
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
    await persistEngineState(tableId, engine);

    // Store chosen variant in room config for future hands
    const g: any = global as any;
    if (g.roomConfigs?.get(tableId)) {
      const roomConfig = g.roomConfigs.get(tableId);
      roomConfig.chosenVariant = chosenVariant;
      roomConfig.dcStepCount = 0;
      g.roomConfigs.set(tableId, roomConfig);
    }

    const gameState = engine.getState();
    const enrichedState = enrichStateWithRunIt(tableId, gameState);
    const broadcastSafeState = sanitizeStateForBroadcast(enrichedState);
    const seq = nextSeq(tableId);

    // Broadcast new game state to all players
    await publishGameStateUpdate(tableId, {
      gameState: broadcastSafeState,
      lastAction: { action: 'variant_chosen', playerId, variant: chosenVariant },
      timestamp: new Date().toISOString(),
      seq,
    });

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