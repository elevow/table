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
  console.log('[auto-runout] finalizeRunout called for tableId:', tableId);
  try {
    const state = engine.getState();
    const ritEnabled = !!state.runItTwice?.enabled;
    console.log('[auto-runout] finalizeRunout state:', { ritEnabled, stage: state.stage });
    try {
      if (ritEnabled && typeof engine.runItTwiceNow === 'function') {
        engine.runItTwiceNow();
      } else if (typeof engine.finalizeToShowdown === 'function') {
        engine.finalizeToShowdown();
      }
    } catch (err) {
      console.log('[auto-runout] finalizeRunout error during finalize:', err);
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
    console.log('[auto-runout] broadcasting showdown, communityCards:', resolved.communityCards?.length);
    await broadcast(resolved, { action: 'auto_runout_showdown' });
    console.log('[auto-runout] showdown broadcast complete');
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
  console.log('[auto-runout] revealStreet called:', { tableId, street });
  try {
    const current = engine.getState();
    console.log('[auto-runout] current state:', { stage: current.stage, communityCards: current.communityCards?.length });
    if (current.stage === 'showdown') {
      console.log('[auto-runout] already at showdown, clearing timers');
      clearSupabaseAutoRunout(tableId);
      return;
    }
    if (typeof engine.previewRabbitHunt !== 'function') {
      console.log('[auto-runout] previewRabbitHunt not available, clearing timers');
      clearSupabaseAutoRunout(tableId);
      return;
    }
    const preview = engine.previewRabbitHunt(street) as { cards?: any[] } | void;
    const cards = Array.isArray(preview?.cards) ? preview!.cards! : [];
    console.log('[auto-runout] preview cards for', street, ':', cards);
    const projectedCommunity = Array.isArray(current.communityCards)
      ? [...current.communityCards, ...cards]
      : cards;
    const staged: TableState = {
      ...current,
      communityCards: projectedCommunity,
      stage: street === 'flop' ? 'flop' : street === 'turn' ? 'turn' : 'river',
      activePlayer: '' as any,
    };
    console.log('[auto-runout] broadcasting', street, 'with', projectedCommunity.length, 'community cards');
    await broadcast(staged, { action: `auto_runout_${street}` });
    console.log('[auto-runout]', street, 'broadcast complete');
    if (street === 'river') {
      console.log('[auto-runout] scheduling showdown in 5 seconds');
      const finalizeTimer = setTimeout(() => {
        finalizeRunout(tableId, engine, broadcast).catch((err) => {
          console.log('[auto-runout] finalizeRunout error:', err);
          clearSupabaseAutoRunout(tableId);
        });
      }, 5000);
      timers.push(finalizeTimer);
    }
  } catch (err) {
    console.log('[auto-runout] revealStreet error:', err);
    clearSupabaseAutoRunout(tableId);
  }
};

export const scheduleSupabaseAutoRunout = (
  tableId: string,
  engine: EngineLike,
  broadcast: BroadcastFn,
): boolean => {
  console.log('[auto-runout] scheduleSupabaseAutoRunout called for tableId:', tableId);
  try {
    const state = engine?.getState?.();
    if (!state) {
      console.log('[auto-runout] no state available, returning false');
      return false;
    }
    if (!isAutoRunoutEligible(state)) {
      console.log('[auto-runout] state not eligible for auto-runout');
      return false;
    }
    if (state.runItTwicePrompt) {
      console.log('[auto-runout] runItTwicePrompt active, returning false');
      return false;
    }
    const variant = state.variant;
    if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
      console.log('[auto-runout] stud variant not supported');
      return false;
    }
    const communityLen = Array.isArray(state.communityCards) ? state.communityCards.length : 0;
    const steps: Array<'flop' | 'turn' | 'river'> = [];
    if (communityLen < 3) steps.push('flop');
    if (communityLen < 4) steps.push('turn');
    if (communityLen < 5) steps.push('river');
    console.log('[auto-runout] communityLen:', communityLen, 'steps:', steps);
    if (!steps.length) {
      console.log('[auto-runout] no steps needed, returning false');
      return false;
    }
    if (typeof engine.previewRabbitHunt !== 'function') {
      console.log('[auto-runout] previewRabbitHunt not available');
      return false;
    }

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
    console.log('[auto-runout] scheduling', steps.length, 'street reveals starting at', delay, 'ms');
    steps.forEach((street) => {
      console.log('[auto-runout] scheduling', street, 'at', delay, 'ms');
      const timer = setTimeout(() => {
        console.log('[auto-runout] timer fired for', street);
        revealStreet(tableId, street, engine, broadcast, timers).catch((err) => {
          console.log('[auto-runout] revealStreet error for', street, ':', err);
          clearSupabaseAutoRunout(tableId);
        });
      }, delay);
      timers.push(timer);
      delay += 5000;
    });
    console.log('[auto-runout] scheduled successfully, returning true');
    return true;
  } catch (err) {
    console.log('[auto-runout] scheduleSupabaseAutoRunout error:', err);
    clearSupabaseAutoRunout(tableId);
    return false;
  }
};
