import type { GameStage, HandActionEntry } from '../../types/poker';
import { isStudVariant } from '../poker/variant-rules';

/**
 * What the HUD needs from a stored hand. Only the public action list is used, never cards, so
 * the numbers can't leak anything a player kept hidden.
 */
export interface HudHand {
  actions: HandActionEntry[];
  variant?: string | null;
  kind?: string | null;
}

/** Raw counts behind the HUD, so callers can show sample sizes next to percentages. */
export interface HudCounts {
  // Hands the subject was dealt into
  hands: number;
  // Hands with a first betting street (bomb pots skip it)
  preflopHands: number;
  vpipHands: number;
  pfrHands: number;
  threeBetOpportunities: number;
  threeBets: number;
  postflopAggressive: number;
  postflopCalls: number;
}

export interface HudStats extends HudCounts {
  // Percentages 0-100, or null when there is nothing to divide by yet
  vpip: number | null;
  pfr: number | null;
  threeBet: number | null;
  // (bets + raises) / calls after the first street; null without any calls
  af: number | null;
}

const FORCED: ReadonlySet<HandActionEntry['action']> = new Set(['small-blind', 'big-blind', 'straddle', 'ante', 'bring-in']);

/** First street with voluntary betting: third street in stud games, preflop otherwise. */
export function firstBettingStreet(variant?: string | null): GameStage {
  return isStudVariant(variant) ? 'third' : 'preflop';
}

export function emptyHudCounts(): HudCounts {
  return {
    hands: 0,
    preflopHands: 0,
    vpipHands: 0,
    pfrHands: 0,
    threeBetOpportunities: 0,
    threeBets: 0,
    postflopAggressive: 0,
    postflopCalls: 0,
  };
}

/** Add one hand the subject was dealt into to the running counts. */
export function addHandToHud(counts: HudCounts, hand: HudHand, subjectId: string): HudCounts {
  const next = { ...counts, hands: counts.hands + 1 };
  const first = firstBettingStreet(hand.variant);
  // Everyone is already in a bomb pot before any choice is made, so it says nothing about
  // how loose or aggressive someone plays before the flop
  const hasFirstStreet = hand.kind !== 'bomb-pot';
  if (hasFirstStreet) next.preflopHands += 1;

  let raises = 0;
  let voluntary = false;
  let raised = false;
  let hadThreeBetChance = false;

  for (const a of hand.actions || []) {
    if (a.stage === 'showdown') continue;
    const aggressive = a.action === 'bet' || a.action === 'raise';
    if (a.stage === first) {
      if (!hasFirstStreet || FORCED.has(a.action)) continue;
      if (a.playerId === subjectId) {
        // Facing exactly one raise is the chance to re-raise; only the first such spot counts
        if (raises === 1 && !hadThreeBetChance) {
          hadThreeBetChance = true;
          next.threeBetOpportunities += 1;
          if (aggressive) next.threeBets += 1;
        }
        if (aggressive || a.action === 'call') voluntary = true;
        if (aggressive) raised = true;
      }
      // Blinds are the opening bet preflop, so the first bet or raise here is the open
      // (in stud, completing the bring-in plays the same role)
      if (aggressive) raises += 1;
      continue;
    }
    if (a.playerId !== subjectId) continue;
    if (aggressive) next.postflopAggressive += 1;
    else if (a.action === 'call') next.postflopCalls += 1;
  }

  if (voluntary) next.vpipHands += 1;
  if (raised) next.pfrHands += 1;
  return next;
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

export function finalizeHud(c: HudCounts): HudStats {
  return {
    ...c,
    vpip: pct(c.vpipHands, c.preflopHands),
    pfr: pct(c.pfrHands, c.preflopHands),
    threeBet: pct(c.threeBets, c.threeBetOpportunities),
    af: c.postflopCalls > 0 ? Math.round((c.postflopAggressive / c.postflopCalls) * 10) / 10 : null,
  };
}

/** HUD numbers for one player over hands they were dealt into. */
export function computeHudStats(hands: HudHand[], subjectId: string): HudStats {
  return finalizeHud(hands.reduce((acc, h) => addHandToHud(acc, h, subjectId), emptyHudCounts()));
}

/** "23" for a percentage, "–" when there is no sample. */
export function formatPct(v: number | null): string {
  return v == null ? '–' : String(Math.round(v));
}

/** Aggression factor for display; "∞" when the player bets and raises but never calls. */
export function formatAf(s: Pick<HudStats, 'af' | 'postflopAggressive' | 'postflopCalls'>): string {
  if (s.af != null) return s.af.toFixed(1);
  return s.postflopAggressive > 0 ? '∞' : '–';
}
