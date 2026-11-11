import { useEffect, useMemo, useState } from 'react';
import { MIDNIGHT_FLIP_MS, isMidnightBaseballVariant } from '../lib/poker/variant-rules';

type PlayerCards = { downCards?: unknown[]; upCards?: unknown[]; downCount?: number };

/**
 * Midnight Baseball turns cards on the server all at once. This shows them one at a time,
 * MIDNIGHT_FLIP_MS apart: until the last one is showing, the table sees the hand as it stood
 * after the cards shown so far, with nobody to act and no result yet. The server adds the same
 * time to the next player's clock.
 */
export function revealFrame<T>(state: T, shown: number): T {
  const s = state as any;
  const flips: string[] = s?.studState?.midnight?.flips || [];
  const count: Record<string, number> = {};
  flips.slice(0, shown).forEach(id => { count[id] = (count[id] || 0) + 1; });
  const playerCards: Record<string, PlayerCards> = {};
  for (const [id, cards] of Object.entries((s.studState?.playerCards || {}) as Record<string, PlayerCards>)) {
    const allUp = cards.upCards || [];
    const up = allUp.slice(0, count[id] || 0);
    const down = (cards.downCards?.length || 0) || cards.downCount || 0;
    // Cards not shown yet are still face down, including any revealed at the showdown
    playerCards[id] = { downCards: [], upCards: up, downCount: down + allUp.length - up.length };
  }
  return {
    ...s,
    stage: s.stage === 'showdown' ? 'third' : s.stage,
    activePlayer: '',
    handResult: undefined,
    handWinners: undefined,
    turnTimeRemainingMs: undefined,
    studState: { ...s.studState, playerCards, potMatch: undefined },
  };
}

export function useMidnightReveal<T>(raw: T): T {
  const s = raw as any;
  const midnight = isMidnightBaseballVariant(s?.variant);
  const hand: string | undefined = s?.handId;
  const total: number = s?.studState?.midnight?.flips?.length || 0;

  // shown: cards showing so far this hand. rawAt: when this state arrived. doneAt: when the
  // last card went up, so the clock can count from then.
  const [view, setView] = useState<{ hand?: string; shown: number; raw?: T; rawAt: number; doneAt: number }>(
    { shown: 0, rawAt: 0, doneAt: 0 },
  );
  // Adjusted while rendering, React's pattern for state that follows a changing value
  if (midnight && (view.hand !== hand || view.raw !== raw)) {
    // eslint-disable-next-line react-hooks/purity -- the time a state arrives decides how much of the clock is left
    const now = Date.now();
    const newHand = view.hand !== hand;
    // Watching from before this hand: show its cards one at a time. Arriving mid-hand: show all.
    const shown = !newHand ? view.shown : view.hand === undefined ? total : 0;
    setView({ hand, shown, raw, rawAt: now, doneAt: newHand ? 0 : view.doneAt });
  }

  useEffect(() => {
    if (!midnight || view.hand !== hand || view.shown >= total) return;
    const timer = setTimeout(() => {
      setView(v => {
        const shown = v.shown + 1;
        return { ...v, shown, doneAt: shown >= total ? Date.now() : v.doneAt };
      });
    }, MIDNIGHT_FLIP_MS);
    return () => clearTimeout(timer);
  }, [midnight, hand, total, view.hand, view.shown]);

  const { shown, rawAt, doneAt } = view;
  return useMemo(() => {
    if (!midnight || view.hand !== hand) return raw;
    if (shown < total) return revealFrame(raw, shown);
    // The clock's time left was measured when the state arrived; the cards took some of it
    const remaining = s?.turnTimeRemainingMs;
    if (doneAt > rawAt && typeof remaining === 'number') return { ...s, turnTimeRemainingMs: remaining - (doneAt - rawAt) };
    return raw;
  }, [midnight, hand, view.hand, shown, total, raw, s, rawAt, doneAt]);
}
