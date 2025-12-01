import type { NextApiRequest, NextApiResponse } from 'next';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { nextSeq } from '../../../src/lib/realtime/sequence';
import {
  enrichStateWithRunIt,
  isAutoRunoutEligible,
} from '../../../src/lib/poker/run-it-twice-manager';
import { clearSupabaseAutoRunout } from '../../../src/lib/poker/supabase-auto-runout';
import type { TableState, Card } from '../../../src/types/poker';

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

// Generate a standard 52-card deck
const generateDeck = (): Card[] => {
  const ranks: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return deck;
};

// Simple seeded random number generator for deterministic card dealing
const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

// Shuffle an array using Fisher-Yates with seeded RNG
const shuffleWithSeed = <T>(array: T[], seed: number): T[] => {
  const result = [...array];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

// Generate the next cards for the runout using deterministic seeding
const generateNextCards = (
  tableId: string,
  communityCards: Card[],
  holeCards: Card[],
  street: 'flop' | 'turn' | 'river'
): Card[] => {
  // Create a deterministic seed from the tableId and existing cards
  // This ensures that given the same state, we always generate the same future cards
  const existingCards = [...communityCards, ...holeCards];
  const cardString = existingCards.map(c => `${c.rank}${c.suit}`).sort().join(',');
  const seedString = `${tableId}:${cardString}`;
  let seed = 0;
  for (let i = 0; i < seedString.length; i++) {
    seed = ((seed << 5) - seed + seedString.charCodeAt(i)) >>> 0;
  }

  // Generate a shuffled deck excluding cards already in use
  const deck = generateDeck();
  const usedCardKeys = new Set(existingCards.map(c => `${c.rank}${c.suit}`));
  const availableCards = deck.filter(c => !usedCardKeys.has(`${c.rank}${c.suit}`));
  const shuffledDeck = shuffleWithSeed(availableCards, seed);

  // Deal the appropriate number of cards for the street
  const cardsNeeded = street === 'flop' ? Math.max(0, 3 - communityCards.length) :
                      street === 'turn' ? Math.max(0, 4 - communityCards.length) :
                      Math.max(0, 5 - communityCards.length);
  
  return shuffledDeck.slice(0, cardsNeeded);
};

/**
 * API endpoint to advance the auto-runout to the next street.
 * This is called by the client every 5 seconds when an all-in has occurred
 * and there are remaining community cards to reveal.
 * 
 * In serverless environments, the game engine may not be in memory, so we
 * accept the current game state from the client and generate cards deterministically.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tableId, gameState: clientGameState } = (req.body || {}) as { 
    tableId?: string;
    gameState?: TableState;
  };

  if (!tableId) {
    return res.status(400).json({ error: 'Missing tableId' });
  }

  try {
    // Clear any server-side auto-runout timers since client is now polling
    clearSupabaseAutoRunout(tableId);
    
    // Try to get state from in-memory engine first, fall back to client-provided state
    const g: any = global as any;
    const engine = g?.activeGames?.get(tableId);
    
    let state: TableState;
    let useEngineForCards = false;
    
    if (engine) {
      state = engine.getState();
      useEngineForCards = typeof engine.previewRabbitHunt === 'function';
      console.log('[advance-runout] using in-memory engine');
    } else if (clientGameState) {
      state = clientGameState;
      console.log('[advance-runout] using client-provided game state (serverless fallback)');
    } else {
      console.log('[advance-runout] no game state available');
      return res.status(404).json({ error: 'No active game found for this table' });
    }
    
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
      if (engine) {
        const ritEnabled = !!state.runItTwice?.enabled;
        try {
          if (ritEnabled && typeof engine.runItTwiceNow === 'function') {
            engine.runItTwiceNow();
          } else if (typeof engine.finalizeToShowdown === 'function') {
            engine.finalizeToShowdown();
          }
          state = engine.getState();
        } catch (err) {
          console.log('[advance-runout] error during finalize:', err);
        }
      }
      
      const resolved: TableState = {
        ...state,
        stage: 'showdown',
        activePlayer: '' as any,
      };
      const enrichedState = await broadcastState(resolved, { action: 'auto_runout_showdown' });
      console.log('[advance-runout] showdown broadcast complete');
      return res.status(200).json({ success: true, street: 'showdown', gameState: enrichedState });
    }

    // Generate the cards for the next street
    let cards: Card[] = [];
    
    if (useEngineForCards && engine) {
      // Use engine's previewRabbitHunt if available
      try {
        const known = state.players?.flatMap((p: any) => p.holeCards || []) || [];
        engine.prepareRabbitPreview?.({ community: state.communityCards, known });
        const preview = engine.previewRabbitHunt(nextStreet) as { cards?: any[] } | void;
        cards = Array.isArray(preview?.cards) ? preview!.cards! : [];
      } catch (err) {
        console.log('[advance-runout] engine previewRabbitHunt failed:', err);
        useEngineForCards = false;
      }
    }
    
    if (!useEngineForCards || cards.length === 0) {
      // Generate cards deterministically from game state
      const holeCards = state.players?.flatMap((p: any) => p.holeCards || []) || [];
      cards = generateNextCards(tableId, state.communityCards || [], holeCards, nextStreet);
      console.log('[advance-runout] generated cards deterministically:', cards);
    }
    
    console.log('[advance-runout] cards for', nextStreet, ':', cards);

    const projectedCommunity = Array.isArray(state.communityCards)
      ? [...state.communityCards, ...cards]
      : cards;

    const staged: TableState = {
      ...state,
      communityCards: projectedCommunity,
      stage: nextStreet,
      activePlayer: '' as any,
    };

    // Update engine state if available
    if (engine) {
      try {
        const engineState = engine.getState();
        engineState.communityCards = projectedCommunity;
        engineState.stage = nextStreet;
      } catch {
        // Engine state update is best-effort
      }
    }

    const enrichedState = await broadcastState(staged, { action: `auto_runout_${nextStreet}` });
    console.log('[advance-runout]', nextStreet, 'broadcast complete');

    return res.status(200).json({ success: true, street: nextStreet, gameState: enrichedState });
  } catch (e: any) {
    console.error('Error advancing runout:', e);
    return res.status(500).json({ error: e?.message || 'Internal server error' });
  }
}
