import type { NextApiRequest, NextApiResponse } from 'next';
import { getRunItState } from '../../../src/lib/poker/run-it-twice-manager';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { RUN_IT_TWICE_DECISIONS_ENABLED } from '../../../src/lib/shared/feature-flags';
import { resolveRunItTwiceDecision } from '../../../src/lib/server/run-it-twice-decision';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

// Running the board out several times, with pauses between streets, can take a while
export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId: claimedPlayerId, runs } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    runs?: number;
  };

  const playerId = await requirePlayer(req, res, claimedPlayerId, typeof runs === 'number' && runs > 1 ? 'game.run_it_twice' : undefined);
  if (!playerId) return;

  if (!tableId || typeof runs !== 'number') {
    return res.status(400).json({ error: 'Missing tableId or runs' });
  }

  try {
    // Get the active game engine from memory or restore from database
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    const gameState = engine.getState();
    const hasPersistedPrompt = Object.prototype.hasOwnProperty.call(gameState, 'runItTwicePrompt');
    const prompt = hasPersistedPrompt ? gameState.runItTwicePrompt : getRunItState(tableId).prompt;
    if (!prompt || prompt.playerId !== playerId) {
      return res.status(400).json({ error: 'No active Run-It-Twice prompt for this player' });
    }
    if ((!RUN_IT_TWICE_DECISIONS_ENABLED || !gameState.allowRunItTwice) && runs > 1) {
      return res.status(403).json({ error: 'Run-It-Twice is temporarily disabled' });
    }

    // Validate runs parameter
    const activePlayers = (gameState.players || []).filter((p: { isFolded?: boolean; folded?: boolean }) => !(p.isFolded || p.folded)).length || 0;
    const maxRuns = Math.max(1, activePlayers);
    if (runs < 1 || runs > maxRuns) {
      return res.status(400).json({ error: `Runs must be 1-${maxRuns}` });
    }

    const result = await resolveRunItTwiceDecision({ tableId, engine, res, playerId, runs });
    if (result.status === 'conflict') {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }
    if (result.status === 'rejected') {
      return res.status(400).json({ error: result.error });
    }

    // Sanitize the response for the requesting player - hide other players' hole cards
    // unless it's showdown or an all-in situation
    // Note: In RIT scenarios, this should typically show all cards since it's an all-in situation
    const sanitizedState = sanitizeStateForPlayer(result.state, playerId);

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
