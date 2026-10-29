import { createPokerEngine } from '../engine-factory';
import { BettingManager } from '../betting-manager';
import { FIXED_LIMIT_CAP, fixedLimitBetSize, fixedLimitOptions, fixedLimitRaiseTarget } from '../fixed-limit';
import { PokerEngine } from '../poker-engine';
import type { GameVariant, Player } from '../../../types/poker';

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const act = (engine: PokerEngine, type: 'bet' | 'raise' | 'call' | 'check' | 'fold' | 'bring-in', amount?: number) => {
  const s = engine.getState();
  engine.handleAction({ type, playerId: s.activePlayer, tableId: s.tableId, amount, timestamp: Date.now() });
};

// Call or check until the street changes
const closeStreet = (engine: PokerEngine) => {
  const stage = engine.getState().stage;
  let guard = 20;
  while (engine.getState().stage === stage && guard-- > 0) {
    const s = engine.getState();
    const me = s.players.find(p => p.id === s.activePlayer)!;
    act(engine, s.currentBet > me.currentBet ? 'call' : 'check');
  }
};

const fixedEngine = (variant: GameVariant = 'texas-holdem', players = [P('a', 0), P('b', 1), P('c', 2)]) =>
  createPokerEngine({ tableId: 'fl', players, smallBlind: 1, bigBlind: 2, state: { variant, bettingMode: 'fixed-limit' } });

describe('fixed-limit bet sizes', () => {
  test('small bet on the first two streets, big bet after', () => {
    expect(fixedLimitBetSize('preflop', 2)).toBe(2);
    expect(fixedLimitBetSize('flop', 2)).toBe(2);
    expect(fixedLimitBetSize('turn', 2)).toBe(4);
    expect(fixedLimitBetSize('river', 2)).toBe(4);
    expect(fixedLimitBetSize('third', 2)).toBe(2);
    expect(fixedLimitBetSize('fourth', 2)).toBe(2);
    expect(fixedLimitBetSize('fifth', 2)).toBe(4);
    expect(fixedLimitBetSize('sixth', 2)).toBe(4);
    expect(fixedLimitBetSize('seventh', 2)).toBe(4);
  });

  test('a raise goes to the next bet level, completing a bring-in or short all-in first', () => {
    expect(fixedLimitRaiseTarget(2, 1, 2)).toBe(4);
    expect(fixedLimitRaiseTarget(1, 0, 2)).toBe(2);
    expect(fixedLimitRaiseTarget(5, 2, 2)).toBe(6);
    // A bring-in as big as the small bet: the raise is a full bet on top
    expect(fixedLimitRaiseTarget(2, 0, 2)).toBe(4);
  });

  test('options for the player to act', () => {
    const base = { stage: 'flop' as const, bigBlind: 2 };
    expect(fixedLimitOptions({ ...base, currentBet: 0, limitBets: 0 }, { currentBet: 0, stack: 50 }))
      .toEqual({ unit: 2, betTo: 2, raiseTo: null, capped: false, bets: 0 });
    expect(fixedLimitOptions({ ...base, currentBet: 2, limitBets: 1 }, { currentBet: 0, stack: 50 }).raiseTo).toBe(4);
    expect(fixedLimitOptions({ ...base, currentBet: 8, limitBets: 4 }, { currentBet: 0, stack: 50 })).toMatchObject({ capped: true, raiseTo: null });
    // Short stack: the raise is an all-in for less
    expect(fixedLimitOptions({ ...base, currentBet: 2, limitBets: 1 }, { currentBet: 0, stack: 3 }).raiseTo).toBe(3);
    // Can only just call: no raise
    expect(fixedLimitOptions({ ...base, currentBet: 2, limitBets: 1 }, { currentBet: 0, stack: 2 }).raiseTo).toBeNull();
    expect(fixedLimitOptions({ stage: 'river', bigBlind: 2, currentBet: 0 }, { currentBet: 0, stack: 3 }).betTo).toBe(3);
  });
});

describe('BettingManager in fixed-limit mode', () => {
  const bm = () => {
    const m = new BettingManager(1, 2);
    m.setMode('fixed-limit');
    return m;
  };
  const player = (stack: number, currentBet = 0): Player => ({ ...P('x', 0, stack), currentBet });
  const ctx = (unit: number, bets: number) => ({ currentPot: 10, players: [], fixedLimit: { unit, bets } });

  test('a bet is exactly one bet whatever amount is asked for', () => {
    const p = player(100);
    const r = bm().processAction(p, { type: 'bet', playerId: 'x', amount: 37 }, 0, 2, ctx(4, 0));
    expect(p.currentBet).toBe(4);
    expect(r).toMatchObject({ pot: 4, currentBet: 4, limitBets: 1 });
  });

  test('raises are one bet each and stop at the cap', () => {
    const m = bm();
    let currentBet = 2;
    let bets = 1;
    for (let i = 0; i < FIXED_LIMIT_CAP - 1; i++) {
      const p = player(100);
      const r = m.processAction(p, { type: 'raise', playerId: 'x', amount: 999 }, currentBet, 2, ctx(2, bets));
      expect(p.currentBet).toBe(currentBet + 2);
      currentBet = r.currentBet;
      bets = r.limitBets!;
    }
    expect(currentBet).toBe(8);
    expect(bets).toBe(FIXED_LIMIT_CAP);
    expect(() => m.processAction(player(100), { type: 'raise', playerId: 'x', amount: 10 }, currentBet, 2, ctx(2, bets))).toThrow(/capped/);
  });

  test('an all-in raise for less does not count towards the cap; the next raise completes the level', () => {
    const m = bm();
    const short = player(5);
    const r1 = m.processAction(short, { type: 'raise', playerId: 'x', amount: 6 }, 4, 2, ctx(2, 2));
    expect(short.isAllIn).toBe(true);
    expect(r1).toMatchObject({ currentBet: 5, limitBets: 2 });
    const next = player(100);
    const r2 = m.processAction(next, { type: 'raise', playerId: 'y', amount: 6 }, r1.currentBet, 2, ctx(2, r1.limitBets!));
    expect(next.currentBet).toBe(6);
    expect(r2.limitBets).toBe(3);
  });

  test('an all-in bet for less can be completed to a full bet', () => {
    const m = bm();
    const short = player(1);
    const r1 = m.processAction(short, { type: 'bet', playerId: 'x', amount: 2 }, 0, 2, ctx(2, 0));
    expect(r1).toMatchObject({ currentBet: 1, limitBets: 0 });
    const next = player(100);
    m.processAction(next, { type: 'raise', playerId: 'y' }, 1, 2, ctx(2, 0));
    expect(next.currentBet).toBe(2);
  });

  test('rejects betting into a bet, raising nothing, and raising without chips beyond a call', () => {
    const m = bm();
    expect(() => m.processAction(player(100), { type: 'bet', playerId: 'x' }, 2, 2, ctx(2, 1))).toThrow(/use raise/);
    expect(() => m.processAction(player(100), { type: 'raise', playerId: 'x' }, 0, 2, ctx(2, 0))).toThrow(/bet instead/);
    expect(() => m.processAction(player(2), { type: 'raise', playerId: 'x' }, 2, 2, ctx(2, 1))).toThrow(/call instead/);
  });
});

describe('fixed-limit Hold\'em hand', () => {
  test('preflop and flop use the small bet, turn and river the big bet; four bets cap a street', () => {
    const engine = fixedEngine();
    engine.startNewHand();
    let s = engine.getState();
    expect(s.bettingMode).toBe('fixed-limit');
    expect(s.limitBets).toBe(1);
    expect(s.currentBet).toBe(2);

    act(engine, 'raise', 50);
    expect(engine.getState().currentBet).toBe(4);
    act(engine, 'raise');
    expect(engine.getState().currentBet).toBe(6);
    act(engine, 'raise');
    s = engine.getState();
    expect(s.currentBet).toBe(8);
    expect(s.limitBets).toBe(4);
    expect(() => act(engine, 'raise')).toThrow(/capped/);
    closeStreet(engine);

    s = engine.getState();
    expect(s.stage).toBe('flop');
    expect(s.limitBets).toBe(0);
    act(engine, 'bet', 10);
    expect(engine.getState().currentBet).toBe(2);
    act(engine, 'raise');
    expect(engine.getState().currentBet).toBe(4);
    closeStreet(engine);

    expect(engine.getState().stage).toBe('turn');
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(4);
    act(engine, 'raise');
    expect(engine.getState().currentBet).toBe(8);
    closeStreet(engine);

    expect(engine.getState().stage).toBe('river');
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(4);
    closeStreet(engine);
    s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(300);
  });

  test('no straddle in fixed limit', () => {
    const engine = fixedEngine();
    engine.setAllowStraddle(true);
    engine.getState().players.forEach(p => engine.setWantsStraddle(p.id, true));
    engine.startNewHand();
    expect(engine.getState().straddle).toBeUndefined();
    expect(engine.getState().currentBet).toBe(2);
  });

  test('a short stack may go all-in for less and the hand still settles', () => {
    const engine = fixedEngine('texas-holdem', [P('a', 0, 100), P('b', 1, 100), P('c', 2, 3)]);
    engine.startNewHand();
    let guard = 40;
    while (engine.getState().stage !== 'showdown' && guard-- > 0) {
      const s = engine.getState();
      const me = s.players.find(p => p.id === s.activePlayer)!;
      // Everyone raises when allowed, so the short stack ends up all-in
      const opts = fixedLimitOptions(s, me);
      if (opts.raiseTo !== null && me.currentBet + me.stack > s.currentBet) act(engine, 'raise');
      else if (opts.betTo !== null) act(engine, 'bet');
      else act(engine, s.currentBet > me.currentBet ? 'call' : 'check');
    }
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(203);
  });

  test('switching modes leaves no-limit tables unaffected', () => {
    const engine = createPokerEngine({ tableId: 'nl', players: [P('a', 0), P('b', 1)], smallBlind: 1, bigBlind: 2 });
    engine.startNewHand();
    expect(engine.getState().limitBets).toBeUndefined();
    act(engine, 'raise', 37);
    expect(engine.getState().currentBet).toBe(37);
  });
});

describe('fixed-limit stud', () => {
  test('the bring-in can be completed to the small bet; big bets from fifth street', () => {
    const engine = fixedEngine('seven-card-stud');
    engine.startNewHand();
    act(engine, 'bring-in');
    let s = engine.getState();
    expect(s.currentBet).toBe(1);
    expect(s.limitBets).toBe(0);
    act(engine, 'raise', 30);
    s = engine.getState();
    expect(s.currentBet).toBe(2);
    expect(s.limitBets).toBe(1);
    act(engine, 'raise');
    expect(engine.getState().currentBet).toBe(4);
    closeStreet(engine);

    expect(engine.getState().stage).toBe('fourth');
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(2);
    closeStreet(engine);

    expect(engine.getState().stage).toBe('fifth');
    act(engine, 'bet');
    expect(engine.getState().currentBet).toBe(4);
    act(engine, 'raise');
    expect(engine.getState().currentBet).toBe(8);
  });

  test('razz defaults to fixed limit', () => {
    const engine = createPokerEngine({ tableId: 'rz', players: [P('a', 0), P('b', 1)], smallBlind: 1, bigBlind: 2, state: { variant: 'razz' } });
    expect(engine.getState().bettingMode).toBe('fixed-limit');
  });
});
