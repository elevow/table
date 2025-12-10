import { TableState, Card } from '../../types/poker';
import { isAutoRunoutEligible } from './run-it-twice-manager';

type BroadcastFn = (state: TableState, lastAction: { action: string; [key: string]: any }) => Promise<void>;
type EngineLike = {
  getState: () => TableState;
  previewRabbitHunt?: (street: 'flop' | 'turn' | 'river') => { cards?: any[] } | void;
  runItTwiceNow?: () => void;
  finalizeToShowdown?: () => void;
  prepareRabbitPreview?: (opts?: { community?: Card[]; known?: Card[] }) => void;
};

type TimerMap = Map<string, NodeJS.Timeout[]>;

const getTimerMap = (): TimerMap => {
  const globalObj = global as any;
  if (!globalObj.__supabaseAutoRunoutTimers) {
    globalObj.__supabaseAutoRunoutTimers = new Map<string, NodeJS.Timeout[]>();
  }
  return globalObj.__supabaseAutoRunoutTimers;
};

export const clearSupabaseAutoRunout = (tableId: string): void => {
  const timers = getTimerMap().get(tableId);
  if (timers && timers.length) {
    timers.forEach((t) => clearTimeout(t));
  }
  getTimerMap().delete(tableId);
};

const finalizeRunout = async (tableId: string, engine: EngineLike, broadcast: BroadcastFn) => {
  try {
    const state = engine.getState();
    const ritEnabled = !!state.runItTwice?.enabled;
    try {
      if (ritEnabled && typeof engine.runItTwiceNow === 'function') {
        engine.runItTwiceNow();
      } else if (typeof engine.finalizeToShowdown === 'function') {
        engine.finalizeToShowdown();
      }
    } catch {
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
    await broadcast(resolved, { action: 'auto_runout_showdown' });
  } finally {
    clearSupabaseAutoRunout(tableId);
  }
};

const revealStreet = async (
  tableId: string,
  street: 'flop' | 'turn' | 'river',
  engine: EngineLike,
  broadcast: BroadcastFn,
  timers: NodeJS.Timeout[],
) => {
  try {
    const current = engine.getState();
    if (current.stage === 'showdown') {
      clearSupabaseAutoRunout(tableId);
      return;
    }
    if (typeof engine.previewRabbitHunt !== 'function') {
      clearSupabaseAutoRunout(tableId);
      return;
    }
    const preview = engine.previewRabbitHunt(street) as { cards?: any[] } | void;
    const cards = preview && Array.isArray(preview.cards) ? preview.cards : [];
    
    // Keep engine's community in sync so subsequent previews compute correct deltas
    let projectedCommunity: Card[];
    try {
      const es = engine.getState();
      if (Array.isArray(es?.communityCards) && Array.isArray(cards) && cards.length > 0) {
        es.communityCards.push(...cards);
      }
      // Use engine's accumulated state after sync
      projectedCommunity = Array.isArray(es?.communityCards) ? [...es.communityCards] : cards;
    } catch {
      // If sync fails, fall back to manual accumulation
      projectedCommunity = Array.isArray(current.communityCards)
        ? [...current.communityCards, ...cards]
        : cards;
    }
    const staged: TableState = {
      ...current,
      communityCards: projectedCommunity,
      stage: street === 'flop' ? 'flop' : street === 'turn' ? 'turn' : 'river',
      activePlayer: '' as any,
    };
    await broadcast(staged, { action: `auto_runout_${street}` });
    if (street === 'river') {
      const finalizeTimer = setTimeout(() => {
        finalizeRunout(tableId, engine, broadcast).catch(() => clearSupabaseAutoRunout(tableId));
      }, 5000);
      timers.push(finalizeTimer);
    }
  } catch {
    clearSupabaseAutoRunout(tableId);
  }
};

/**
 * Runs auto-runout synchronously with awaited delays between reveals.
 * This version works in serverless/API route contexts where timers may not fire.
 */
export const runSupabaseAutoRunoutSync = async (
  tableId: string,
  engine: EngineLike,
  broadcast: BroadcastFn,
): Promise<boolean> => {
  try {
    const state = engine?.getState?.();
    if (!state) return false;
    if (!isAutoRunoutEligible(state)) return false;
    if (state.runItTwicePrompt) return false;
    const variant = state.variant;
    if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
      return false;
    }
    const communityLen = Array.isArray(state.communityCards) ? state.communityCards.length : 0;
    const steps: Array<'flop' | 'turn' | 'river'> = [];
    if (communityLen < 3) steps.push('flop');
    if (communityLen < 4) steps.push('turn');
    if (communityLen < 5) steps.push('river');
    if (!steps.length) return false;
    if (typeof engine.previewRabbitHunt !== 'function') return false;

    try {
      const known = state.players?.flatMap((p: any) => p.holeCards || []) || [];
      engine.prepareRabbitPreview?.({ community: state.communityCards, known });
    } catch {
      // preview preparation is best-effort
    }

    clearSupabaseAutoRunout(tableId);

    // Run reveals sequentially with delays
    for (const street of steps) {
      // Wait 5 seconds before each reveal
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Reveal the street
      const current = engine.getState();
      if (current.stage === 'showdown') break;
      if (typeof engine.previewRabbitHunt !== 'function') break;
      
      const preview = engine.previewRabbitHunt(street) as { cards?: any[] } | void;
      const cards = preview && Array.isArray(preview.cards) ? preview.cards : [];
      
      // Keep engine's community in sync
      let projectedCommunity: Card[];
      try {
        const es = engine.getState();
        if (Array.isArray(es?.communityCards) && Array.isArray(cards) && cards.length > 0) {
          es.communityCards.push(...cards);
        }
        // Use engine's accumulated state after sync
        projectedCommunity = Array.isArray(es?.communityCards) ? [...es.communityCards] : cards;
      } catch {
        // If sync fails, fall back to manual accumulation
        projectedCommunity = Array.isArray(current.communityCards)
          ? [...current.communityCards, ...cards]
          : cards;
      }
      const staged: TableState = {
        ...current,
        communityCards: projectedCommunity,
        stage: street === 'flop' ? 'flop' : street === 'turn' ? 'turn' : 'river',
        activePlayer: '' as any,
      };
      await broadcast(staged, { action: `auto_runout_${street}` });
    }

    // Wait 5 seconds then finalize to showdown
    await new Promise(resolve => setTimeout(resolve, 5000));
    await finalizeRunout(tableId, engine, broadcast);
    
    return true;
  } catch (err) {
    console.error('[auto-runout] Error in sync runout:', err);
    clearSupabaseAutoRunout(tableId);
    return false;
  }
};

export const scheduleSupabaseAutoRunout = (
  tableId: string,
  engine: EngineLike,
  broadcast: BroadcastFn,
): boolean => {
  try {
    const state = engine?.getState?.();
    if (!state) return false;
    if (!isAutoRunoutEligible(state)) return false;
    if (state.runItTwicePrompt) return false;
    const variant = state.variant;
    if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
      return false;
    }
    const communityLen = Array.isArray(state.communityCards) ? state.communityCards.length : 0;
    const steps: Array<'flop' | 'turn' | 'river'> = [];
    if (communityLen < 3) steps.push('flop');
    if (communityLen < 4) steps.push('turn');
    if (communityLen < 5) steps.push('river');
    if (!steps.length) return false;
    if (typeof engine.previewRabbitHunt !== 'function') return false;

    try {
      const known = state.players?.flatMap((p: any) => p.holeCards || []) || [];
      engine.prepareRabbitPreview?.({ community: state.communityCards, known });
    } catch {
      // preview preparation is best-effort
    }

    clearSupabaseAutoRunout(tableId);
    const timers: NodeJS.Timeout[] = [];
    getTimerMap().set(tableId, timers);

    let delay = 5000;
    steps.forEach((street) => {
      const timer = setTimeout(() => {
        revealStreet(tableId, street, engine, broadcast, timers).catch(() => clearSupabaseAutoRunout(tableId));
      }, delay);
      timers.push(timer);
      delay += 5000;
    });
    return true;
  } catch {
    clearSupabaseAutoRunout(tableId);
    return false;
  }
};
