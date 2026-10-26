import { computeHudStats, firstBettingStreet, formatAf, formatPct, type HudHand } from '../hud-stats';
import type { HandActionEntry } from '../../../types/poker';

const act = (playerId: string, action: HandActionEntry['action'], stage: HandActionEntry['stage'] = 'preflop', put = 0): HandActionEntry =>
  ({ playerId, action, stage, put });

const blinds = [act('a', 'small-blind', 'preflop', 5), act('b', 'big-blind', 'preflop', 10)];

describe('firstBettingStreet', () => {
  it('is third street for stud games and preflop otherwise', () => {
    expect(firstBettingStreet('seven-card-stud')).toBe('third');
    expect(firstBettingStreet('five-card-stud')).toBe('third');
    expect(firstBettingStreet('omaha')).toBe('preflop');
    expect(firstBettingStreet(undefined)).toBe('preflop');
  });
});

describe('computeHudStats', () => {
  it('has empty percentages without hands', () => {
    const s = computeHudStats([], 'x');
    expect(s).toMatchObject({ hands: 0, vpip: null, pfr: null, threeBet: null, af: null });
  });

  it('does not count blind posts as voluntary', () => {
    // b posts the big blind and checks: not VPIP
    const hand: HudHand = { actions: [...blinds, act('a', 'call', 'preflop', 5), act('b', 'check')] };
    const b = computeHudStats([hand], 'b');
    expect(b).toMatchObject({ hands: 1, vpipHands: 0, vpip: 0, pfr: 0 });
    const a = computeHudStats([hand], 'a');
    expect(a).toMatchObject({ vpipHands: 1, vpip: 100, pfrHands: 0 });
  });

  it('counts opens, 3-bets and 3-bet chances', () => {
    const hands: HudHand[] = [
      // c opens, a 3-bets, b folds facing two raises (no chance to 3-bet), c calls
      { actions: [...blinds, act('c', 'raise', 'preflop', 30), act('a', 'raise', 'preflop', 85), act('b', 'fold'), act('c', 'call', 'preflop', 60)] },
      // c opens, a just calls, b folds: a and b each had a 3-bet chance and passed
      { actions: [...blinds, act('c', 'raise', 'preflop', 30), act('a', 'call', 'preflop', 25), act('b', 'fold')] },
    ];
    const a = computeHudStats(hands, 'a');
    expect(a).toMatchObject({ hands: 2, vpip: 100, pfr: 50, threeBetOpportunities: 2, threeBets: 1, threeBet: 50 });
    const b = computeHudStats(hands, 'b');
    expect(b).toMatchObject({ vpip: 0, threeBetOpportunities: 1, threeBets: 0, threeBet: 0 });
    const c = computeHudStats(hands, 'c');
    // c's call of the 3-bet is not a 3-bet chance (it faced two raises)
    expect(c).toMatchObject({ vpip: 100, pfr: 100, threeBetOpportunities: 0, threeBet: null });
  });

  it('only counts the first 3-bet chance in a hand', () => {
    const hand: HudHand = {
      actions: [...blinds, act('a', 'raise', 'preflop', 25), act('b', 'call', 'preflop', 20)],
    };
    // b faced one raise once; calling it is a missed 3-bet
    expect(computeHudStats([hand], 'b')).toMatchObject({ threeBetOpportunities: 1, threeBets: 0, vpip: 100 });
  });

  it('measures postflop aggression', () => {
    const hand: HudHand = {
      actions: [
        ...blinds, act('a', 'call', 'preflop', 5), act('b', 'check'),
        act('b', 'bet', 'flop', 10), act('a', 'call', 'flop', 10),
        act('b', 'bet', 'turn', 20), act('a', 'raise', 'turn', 60), act('b', 'call', 'turn', 40),
        act('b', 'check', 'river'), act('a', 'bet', 'river', 50), act('b', 'fold', 'river'),
        act('a', 'check', 'showdown'),
      ],
    };
    const a = computeHudStats([hand], 'a');
    expect(a).toMatchObject({ postflopAggressive: 2, postflopCalls: 1, af: 2 });
    const b = computeHudStats([hand], 'b');
    expect(b).toMatchObject({ postflopAggressive: 2, postflopCalls: 1, af: 2 });
  });

  it('leaves bomb pots out of preflop stats but counts their postflop play', () => {
    const hand: HudHand = {
      kind: 'bomb-pot',
      actions: [act('a', 'ante', 'flop', 20), act('b', 'ante', 'flop', 20), act('a', 'bet', 'flop', 20), act('b', 'fold', 'flop')],
    };
    const a = computeHudStats([hand], 'a');
    expect(a).toMatchObject({ hands: 1, preflopHands: 0, vpip: null, pfr: null, postflopAggressive: 1, af: null });
  });

  it('uses third street as the first street in stud', () => {
    const hand: HudHand = {
      variant: 'seven-card-stud',
      actions: [
        act('a', 'ante', 'third', 1), act('b', 'ante', 'third', 1), act('b', 'bring-in', 'third', 2),
        act('a', 'bet', 'third', 5), act('b', 'raise', 'third', 8), act('a', 'call', 'third', 5),
        act('a', 'bet', 'fourth', 5), act('b', 'call', 'fourth', 5),
      ],
    };
    // a completes (an open), b re-raises it: a 3-bet
    expect(computeHudStats([hand], 'a')).toMatchObject({ vpip: 100, pfr: 100, postflopAggressive: 1, threeBetOpportunities: 0 });
    expect(computeHudStats([hand], 'b')).toMatchObject({ vpip: 100, pfr: 100, threeBetOpportunities: 1, threeBets: 1, postflopCalls: 1 });
  });

  it('rounds percentages to one decimal', () => {
    const fold: HudHand = { actions: [...blinds, act('c', 'fold')] };
    const call: HudHand = { actions: [...blinds, act('c', 'call', 'preflop', 10)] };
    expect(computeHudStats([call, fold, fold], 'c').vpip).toBe(33.3);
  });
});

describe('formatting', () => {
  it('formats percentages and aggression', () => {
    expect(formatPct(null)).toBe('–');
    expect(formatPct(33.3)).toBe('33');
    expect(formatAf({ af: 2.25, postflopAggressive: 9, postflopCalls: 4 })).toBe('2.3');
    expect(formatAf({ af: null, postflopAggressive: 3, postflopCalls: 0 })).toBe('∞');
    expect(formatAf({ af: null, postflopAggressive: 0, postflopCalls: 0 })).toBe('–');
  });
});
