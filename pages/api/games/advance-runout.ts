import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import {
  enrichStateWithRunIt,
  isAutoRunoutEligible,
} from '../../../src/lib/poker/run-it-twice-manager';
import { clearSupabaseAutoRunout } from '../../../src/lib/poker/supabase-auto-runout';
import type { TableState } from '../../../src/types/poker';

function getIo(res: NextApiResponse): any | null {
  try {
    // @ts-ignore
    const io = (res as any)?.socket?.server?.io;
    return io || null;
  } catch {
    return null;
  }
}

// Server-side lock to prevent duplicate reveals
// Tracks what stage we've already revealed TO (the resulting stage after reveal)
const getRunoutLocks = (): Map<string, { lastAdvanceTime: number; lastRevealedStage: string }> => {
  const g = global as any;
  if (!g.__runoutLocks) {
    g.__runoutLocks = new Map();
  }
  return g.__runoutLocks;
};

/**
 * API endpoint to advance the auto-runout to the next street.
 * This is called by the client every 5 seconds when an all-in has occurred
 * and there are remaining community cards to reveal.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId } = (req.body || {}) as { tableId?: string };

  if (!tableId) {
    return res.status(400).json({ error: 'Missing tableId' });
  }

  try {
    // Clear any server-side auto-runout timers since client is now polling
    clearSupabaseAutoRunout(tableId);
    
    // Get the active game engine
    const g: any = global as any;
    const engine = g?.activeGames?.get(tableId);
    if (!engine) {
      return res.status(404).json({ error: 'No active game found for this table' });
    }

    const state = engine.getState();
    const communityLen = Array.isArray(state.communityCards) ? state.communityCards.length : 0;
    
    console.log('[advance-runout] called for tableId:', tableId, 'stage:', state.stage, 'communityCards:', communityLen);

    // Check if we should advance the runout
    if (!isAutoRunoutEligible(state)) {
      console.log('[advance-runout] not eligible for auto-runout');
      return res.status(200).json({ success: false, reason: 'not_eligible' });
    }

    if (state.runItTwicePrompt) {
      console.log('[advance-runout] waiting for run-it-twice prompt');
      return res.status(200).json({ success: false, reason: 'waiting_for_prompt' });
    }

    if (state.stage === 'showdown') {
      console.log('[advance-runout] already at showdown');
      return res.status(200).json({ success: false, reason: 'already_showdown' });
    }
    
    // Determine next street to reveal based on community cards
    let nextStreet: 'flop' | 'turn' | 'river' | 'showdown' | null = null;
    if (communityLen < 3) {
      nextStreet = 'flop';
    } else if (communityLen < 4) {
      nextStreet = 'turn';
    } else if (communityLen < 5) {
      nextStreet = 'river';
    } else {
      nextStreet = 'showdown';
    }

    if (!nextStreet) {
      console.log('[advance-runout] no more streets to reveal');
      return res.status(200).json({ success: false, reason: 'no_more_streets' });
    }

    // Check for duplicate requests using server-side lock
    // We track what stage we've already revealed TO, not what we started with
    const locks = getRunoutLocks();
    const lock = locks.get(tableId);
    const now = Date.now();
    
    // If we've already revealed TO this stage within the last 4 seconds, skip
    if (lock && lock.lastRevealedStage === nextStreet && (now - lock.lastAdvanceTime) < 4000) {
      console.log('[advance-runout] duplicate request detected for', nextStreet, '- skipping (last advance:', now - lock.lastAdvanceTime, 'ms ago)');
      return res.status(200).json({ success: false, reason: 'duplicate_request', street: nextStreet });
    }

    // Update the lock with the stage we're about to reveal TO
    locks.set(tableId, { lastAdvanceTime: now, lastRevealedStage: nextStreet });

    console.log('[advance-runout] advancing to', nextStreet);

    const broadcastState = async (gameState: TableState, lastAction: any) => {
      const enrichedState = enrichStateWithRunIt(tableId, gameState);
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

    if (nextStreet === 'showdown') {
      // Finalize to showdown
      const ritEnabled = !!state.runItTwice?.enabled;
      try {
        if (ritEnabled && typeof engine.runItTwiceNow === 'function') {
          engine.runItTwiceNow();
        } else if (typeof engine.finalizeToShowdown === 'function') {
          engine.finalizeToShowdown();
        }
      } catch (err) {
        console.log('[advance-runout] error during finalize:', err);
        if (typeof engine.finalizeToShowdown === 'function') {
          try { engine.finalizeToShowdown(); } catch { /* ignore */ }
        }
      }
      const finalState = engine.getState();
      const resolved: TableState = {
        ...finalState,
        stage: finalState.stage || 'showdown',
        activePlayer: '' as any,
      };
      const enrichedState = await broadcastState(resolved, { action: 'auto_runout_showdown' });
      console.log('[advance-runout] showdown broadcast complete');
      return res.status(200).json({ success: true, street: 'showdown', gameState: enrichedState });
    }

    // Reveal the next street
    if (typeof engine.previewRabbitHunt !== 'function') {
      console.log('[advance-runout] previewRabbitHunt not available');
      return res.status(200).json({ success: false, reason: 'preview_not_available' });
    }

    // Prepare rabbit preview if needed
    try {
      const known = state.players?.flatMap((p: any) => p.holeCards || []) || [];
      engine.prepareRabbitPreview?.({ community: state.communityCards, known });
    } catch {
      // preview preparation is best-effort
    }

    const preview = engine.previewRabbitHunt(nextStreet) as { cards?: any[] } | void;
    const cards = Array.isArray(preview?.cards) ? preview!.cards! : [];
    console.log('[advance-runout] preview cards for', nextStreet, ':', cards);

    const projectedCommunity = Array.isArray(state.communityCards)
      ? [...state.communityCards, ...cards]
      : cards;

    const staged: TableState = {
      ...state,
      communityCards: projectedCommunity,
      stage: nextStreet,
      activePlayer: '' as any,
    };

    // Also update the engine state to keep it in sync
    try {
      const engineState = engine.getState();
      engineState.communityCards = projectedCommunity;
      engineState.stage = nextStreet;
    } catch {
      // Engine state update is best-effort
    }

    const enrichedState = await broadcastState(staged, { action: `auto_runout_${nextStreet}` });
    console.log('[advance-runout]', nextStreet, 'broadcast complete');

    return res.status(200).json({ success: true, street: nextStreet, gameState: enrichedState });
  } catch (e: any) {
    console.error('Error advancing runout:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
}
