import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeStateForPlayer } from '../../../src/lib/poker/state-sanitizer';
import { getOrRestoreEngine, STALE_STATE_RESPONSE } from '../../../src/lib/poker/engine-persistence';
import { runGameAction } from '../../../src/lib/server/game-action-pipeline';
import { resolveRunItTwiceDecision } from '../../../src/lib/server/run-it-twice-decision';
import { TIMEOUTS_BEFORE_SIT_OUT } from '../../../src/lib/shared/turn-clock';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

/**
 * POST /api/games/timeout
 *
 * Enforces the turn clock. There is no server process watching the clock, so every player's client
 * calls this once the countdown runs out; the server checks its own clock and, if the turn really
 * has expired, acts for the player (check when free, otherwise fold). An expired Run-It-Twice
 * decision runs the board once. Duplicate calls are refused because the turn has moved on.
 */
// An all-in after a timeout runs the board out, with pauses between streets
export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, playerId: claimedPlayerId, expectedTurnSeq } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    // turnSeq of the turn the caller saw run out
    expectedTurnSeq?: number;
  };

  const callerId = await requirePlayer(req, res, claimedPlayerId);
  if (!callerId) return;
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });

  try {
    const engine = await getOrRestoreEngine(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    const state = engine.getState();

    if (!state.players.some(p => p.id === callerId)) {
      return res.status(403).json({ error: 'Only a player at this table can enforce the turn clock' });
    }
    if (typeof expectedTurnSeq === 'number' && expectedTurnSeq !== (state.turnSeq || 0)) {
      return res.status(409).json(STALE_STATE_RESPONSE);
    }
    const deadline = state.turnDeadline;
    const now = Date.now();
    if (!state.activePlayer || typeof deadline !== 'number' || now < deadline) {
      return res.status(409).json({
        error: 'The turn has not timed out',
        code: 'NOT_TIMED_OUT',
        remainingMs: typeof deadline === 'number' ? deadline - now : null,
      });
    }

    const prompt = state.runItTwicePrompt;
    if (prompt) {
      // Nobody decided how many times to run it, so it runs once
      const result = await resolveRunItTwiceDecision({
        tableId,
        engine,
        res,
        playerId: prompt.playerId,
        runs: 1,
        reason: 'timeout',
      });
      if (result.status !== 'ok') return res.status(409).json(STALE_STATE_RESPONSE);
      return res.status(200).json({ success: true, gameState: sanitizeStateForPlayer(result.state, callerId) });
    }

    const timedOut = state.players.find(p => p.id === state.activePlayer);
    if (!timedOut) {
      return res.status(409).json({ error: 'The turn has not timed out', code: 'NOT_TIMED_OUT', remainingMs: null });
    }
    const action = timedOut.currentBet < state.currentBet ? 'fold' : 'check';
    const satOut = (timedOut.consecutiveTimeouts || 0) + 1 >= TIMEOUTS_BEFORE_SIT_OUT;

    const result = await runGameAction({
      tableId,
      engine,
      res,
      apply: () => { engine.handleTimeout(now); },
      lastAction: { action, playerId: timedOut.id, reason: 'timeout', satOut },
    });
    if (result.status === 'conflict') return res.status(409).json(STALE_STATE_RESPONSE);
    if (result.status === 'rejected') return res.status(409).json({ error: result.error, code: 'NOT_TIMED_OUT' });

    return res.status(200).json({ success: true, gameState: sanitizeStateForPlayer(result.state, callerId) });
  } catch (e: unknown) {
    console.error('Error enforcing turn clock:', e);
    const errorMessage =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Internal server error';
    return res.status(500).json({ error: errorMessage });
  }
}
