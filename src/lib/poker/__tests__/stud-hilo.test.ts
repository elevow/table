import { createPokerEngine } from '../engine-factory';
import { Card, Player } from '../../../types/poker';

const P = (id: string, pos: number, stack = 500): Player => ({
  id,
  name: id,
  position: pos,
  stack,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

// Helper to assign stud cards directly (down/up)
const assignStud = (state: any, pid: string, down: Card[], up: Card[]) => {
  state.studState = state.studState || { playerCards: {} };
  state.studState.playerCards[pid] = { downCards: [...down], upCards: [...up] };
};

describe('US-054 Seven-card Stud Hi-Lo (8 or Better)', () => {
  test('no qualifying low: all to high winner; lastHiLoResult.low is null', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const engine = createPokerEngine({ tableId: 'studhl1', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    // Neutralize bring-in/bets
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 200;

    // Assign 7 cards per player; ensure only player 'a' has strong high; none has 5 distinct <=8 for low
    const downA: Card[] = [
      { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '9', suit: 'clubs' },
    ];
    const upA: Card[] = [
      { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'clubs' }, { rank: '10', suit: 'hearts' },
    ]; // trips K high
    const downB: Card[] = [
      { rank: 'Q', suit: 'spades' }, { rank: 'J', suit: 'diamonds' }, { rank: '9', suit: 'spades' },
    ];
    const upB: Card[] = [
      { rank: '8', suit: 'hearts' }, { rank: '10', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'hearts' },
    ];
    const downC: Card[] = [
      { rank: 'A', suit: 'clubs' }, { rank: 'A', suit: 'diamonds' }, { rank: '9', suit: 'hearts' },
    ];
    const upC: Card[] = [
  { rank: '8', suit: 'clubs' }, { rank: '10', suit: 'spades' }, { rank: 'Q', suit: 'clubs' }, { rank: 'J', suit: 'clubs' },
    ];
    assignStud(state, 'a', downA, upA);
    assignStud(state, 'b', downB, upB);
    assignStud(state, 'c', downC, upC);

    state.stage = 'seventh';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.lastHiLoResult!.low).toBeNull();
    const highTotal = s.lastHiLoResult!.high.reduce((sum, e) => sum + e.amount, 0);
    expect(highTotal).toBe(200);
    const a = s.players.find(p => p.id === 'a')!; const b = s.players.find(p => p.id === 'b')!;
    expect(a.stack).toBeGreaterThan(b.stack);
  });

  test('qualifying low present: split pot with odd chip to high', () => {
    const players = [P('a', 0), P('b', 1)];
    const engine = createPokerEngine({ tableId: 'studhl2', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 101; // odd

    // a: strong high (full house/trips), b: qualifies for low (A-2-3-4-7)
    assignStud(state, 'a',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '7', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }, { rank: '9', suit: 'hearts' } ]
    );
    assignStud(state, 'b',
      [ { rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'hearts' }, { rank: '3', suit: 'spades' } ],
      [ { rank: '4', suit: 'diamonds' }, { rank: '7', suit: 'hearts' }, { rank: 'Q', suit: 'spades' }, { rank: '9', suit: 'clubs' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    const high = s.lastHiLoResult!.high.find(h => h.playerId === 'a')?.amount || 0;
    const low = s.lastHiLoResult!.low?.find(l => l.playerId === 'b')?.amount || 0;
    expect(high).toBe(51); // odd chip to high side
    expect(low).toBe(50);
  });

  test('ties on both sides: even split among tied winners', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2), P('d', 3)];
    const engine = createPokerEngine({ tableId: 'studhl3', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 200;

    // a,b: tie on high (both trips K with same kickers distribution from cards)
    assignStud(state, 'a',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '3', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'clubs' }, { rank: '10', suit: 'hearts' } ]
    );
    assignStud(state, 'b',
      [ { rank: 'K', suit: 'clubs' }, { rank: 'K', suit: 'spades' }, { rank: '3', suit: 'diamonds' } ],
      [ { rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }, { rank: 'J', suit: 'hearts' }, { rank: '10', suit: 'clubs' } ]
    );
    // c,d: tie on low (A-2-3-4-7), but no straights/flushes to beat trips on high
    assignStud(state, 'c',
      [ { rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'diamonds' }, { rank: '3', suit: 'hearts' } ],
      [ { rank: '4', suit: 'spades' }, { rank: '7', suit: 'clubs' }, { rank: '9', suit: 'hearts' }, { rank: 'Q', suit: 'spades' } ]
    );
    assignStud(state, 'd',
      [ { rank: 'A', suit: 'hearts' }, { rank: '2', suit: 'hearts' }, { rank: '3', suit: 'clubs' } ],
      [ { rank: '4', suit: 'clubs' }, { rank: '7', suit: 'diamonds' }, { rank: '9', suit: 'clubs' }, { rank: 'Q', suit: 'hearts' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    const hA = s.lastHiLoResult!.high.find(h => h.playerId === 'a')?.amount || 0;
    const hB = s.lastHiLoResult!.high.find(h => h.playerId === 'b')?.amount || 0;
    const lC = s.lastHiLoResult!.low!.find(l => l.playerId === 'c')?.amount || 0;
    const lD = s.lastHiLoResult!.low!.find(l => l.playerId === 'd')?.amount || 0;
    expect(hA).toBe(50);
    expect(hB).toBe(50);
    expect(lC).toBe(50);
    expect(lD).toBe(50);
  });

  test('side pots: main pot splits hi/lo; side pot splits hi/lo to different winners', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const engine = createPokerEngine({ tableId: 'studhl4', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    // Neutralize bring-in and set custom side-pot bets: A=31 (all-in), B=81, C=81
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.players.find((p: any) => p.id === 'a')!.currentBet = 31;
    state.players.find((p: any) => p.id === 'b')!.currentBet = 81;
    state.players.find((p: any) => p.id === 'c')!.currentBet = 81;
    // Pot equals sum of current bets so only side pots are used (no base pot)
    state.pot = 31 + 81 + 81; // 193 => main 93 (ABC), side 100 (BC)

    // Cards: A strong high (trips K), no low; B medium high (beats C), no low; C qualifies low A-2-3-4-7
    assignStud(state, 'a',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '9', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'clubs' }, { rank: '10', suit: 'hearts' } ]
    );
    assignStud(state, 'b',
      [ { rank: 'Q', suit: 'spades' }, { rank: 'J', suit: 'diamonds' }, { rank: '9', suit: 'spades' } ],
      [ { rank: '8', suit: 'hearts' }, { rank: '10', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }, { rank: '2', suit: 'clubs' } ]
    );
    assignStud(state, 'c',
      [ { rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'hearts' }, { rank: '3', suit: 'spades' } ],
      [ { rank: '4', suit: 'diamonds' }, { rank: '7', suit: 'hearts' }, { rank: 'Q', suit: 'spades' }, { rank: '9', suit: 'clubs' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expected distribution:
    // Main (93): high->A 47 (odd chip), low->C 46; Side (100): high->B 50, low->C 50
    const high = s.lastHiLoResult!.high;
    const low = s.lastHiLoResult!.low!;
    const hA = high.find(h => h.playerId === 'a')?.amount || 0;
    const hB = high.find(h => h.playerId === 'b')?.amount || 0;
    const hC = high.find(h => h.playerId === 'c')?.amount || 0;
    const lA = low.find(l => l.playerId === 'a')?.amount || 0;
    const lB = low.find(l => l.playerId === 'b')?.amount || 0;
    const lC = low.find(l => l.playerId === 'c')?.amount || 0;
    expect(hA).toBe(47);
    expect(hB).toBe(50);
    expect(hC).toBe(0);
    expect(lA).toBe(0);
    expect(lB).toBe(0);
    expect(lC).toBe(96);
    // Totals sanity
    const highTotal = high.reduce((sum: number, e: any) => sum + e.amount, 0);
    const lowTotal = low.reduce((sum: number, e: any) => sum + e.amount, 0);
    expect(highTotal + lowTotal).toBe(193);
  });

  test('side pots: main pot has low present (A only), side pot has no low; side goes fully to high', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2)];
    const engine = createPokerEngine({ tableId: 'studhl5', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    // Bets: A=20 (all-in), B=70, C=70 => main 60 (ABC), side 100 (BC)
    state.players.find((p: any) => p.id === 'a')!.currentBet = 20;
    state.players.find((p: any) => p.id === 'b')!.currentBet = 70;
    state.players.find((p: any) => p.id === 'c')!.currentBet = 70;
    state.pot = 20 + 70 + 70; // 160

    // A qualifies low only; B has strongest high; C weaker high; neither B nor C qualifies low
    assignStud(state, 'a',
      [ { rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'diamonds' }, { rank: '3', suit: 'hearts' } ],
      [ { rank: '4', suit: 'spades' }, { rank: '7', suit: 'clubs' }, { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'clubs' } ]
    );
    assignStud(state, 'b',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '9', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'hearts' }, { rank: '10', suit: 'clubs' } ]
    );
    assignStud(state, 'c',
      [ { rank: 'Q', suit: 'spades' }, { rank: 'J', suit: 'diamonds' }, { rank: '9', suit: 'spades' } ],
      [ { rank: '8', suit: 'hearts' }, { rank: '10', suit: 'spades' }, { rank: 'Q', suit: 'clubs' }, { rank: '9', suit: 'diamonds' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expected: Main (60) splits (low present via A): high->B 30, low->A 30; Side (100) no low among B,C -> all to B
    const high = s.lastHiLoResult!.high;
    const low = s.lastHiLoResult!.low!;
    const hA = high.find(h => h.playerId === 'a')?.amount || 0;
    const hB = high.find(h => h.playerId === 'b')?.amount || 0;
    const hC = high.find(h => h.playerId === 'c')?.amount || 0;
    const lA = low.find(l => l.playerId === 'a')?.amount || 0;
    const lB = low.find(l => l.playerId === 'b')?.amount || 0;
    const lC = low.find(l => l.playerId === 'c')?.amount || 0;
    expect(hA).toBe(0);
    expect(hB).toBe(130);
    expect(hC).toBe(0);
    expect(lA).toBe(30);
    expect(lB).toBe(0);
    expect(lC).toBe(0);
    const highTotal = high.reduce((sum: number, e: any) => sum + e.amount, 0);
    const lowTotal = low.reduce((sum: number, e: any) => sum + e.amount, 0);
    expect(highTotal + lowTotal).toBe(160);
  });

  test('three-way high tie on odd main pot: remainder distributed by position among winners', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2), P('d', 3)];
    const engine = createPokerEngine({ tableId: 'studhl7', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 101; // odd

    // a,b,c: tie on high (trips K with A and Q kickers); d is weaker high; no lows qualify
    assignStud(state, 'a',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '9', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'spades' }, { rank: 'A', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }, { rank: '10', suit: 'hearts' } ]
    );
    assignStud(state, 'b',
      [ { rank: 'K', suit: 'clubs' }, { rank: 'K', suit: 'spades' }, { rank: '9', suit: 'diamonds' } ],
      [ { rank: 'K', suit: 'diamonds' }, { rank: 'A', suit: 'clubs' }, { rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'hearts' } ]
    );
    assignStud(state, 'c',
      [ { rank: 'K', suit: 'diamonds' }, { rank: 'K', suit: 'clubs' }, { rank: '9', suit: 'hearts' } ],
      [ { rank: 'K', suit: 'hearts' }, { rank: 'A', suit: 'diamonds' }, { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'clubs' } ]
    );
    assignStud(state, 'd',
      [ { rank: 'Q', suit: 'hearts' }, { rank: 'Q', suit: 'diamonds' }, { rank: '10', suit: 'clubs' } ],
      [ { rank: 'Q', suit: 'spades' }, { rank: 'J', suit: 'diamonds' }, { rank: '9', suit: 'spades' }, { rank: '2', suit: 'hearts' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    expect(s.lastHiLoResult!.low).toBeNull();
    const high = s.lastHiLoResult!.high;
    const hA = high.find(h => h.playerId === 'a')?.amount || 0;
    const hB = high.find(h => h.playerId === 'b')?.amount || 0;
    const hC = high.find(h => h.playerId === 'c')?.amount || 0;
    const hD = high.find(h => h.playerId === 'd')?.amount || 0;
    // 101 split among a,b,c -> 33 each; remainder 2 -> to earliest positions among winners: a,b
    expect(hA).toBe(34);
    expect(hB).toBe(34);
    expect(hC).toBe(33);
    expect(hD).toBe(0);
    const highTotal = high.reduce((sum: number, e: any) => sum + e.amount, 0);
    expect(highTotal).toBe(101);
  });

  test('high-only odd side pot (3 eligibles, 2-way high tie): odd chip to earliest winner', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2), P('d', 3)];
    const engine = createPokerEngine({ tableId: 'studhl8', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    // Bets: A=20, B=61, C=61, D=61 => main 80 (ABCD), side1 123 (BCD)
    state.players.find((p: any) => p.id === 'a')!.currentBet = 20;
    state.players.find((p: any) => p.id === 'b')!.currentBet = 61;
    state.players.find((p: any) => p.id === 'c')!.currentBet = 61;
    state.players.find((p: any) => p.id === 'd')!.currentBet = 61;
    state.pot = 20 + 61 + 61 + 61; // 203 total

    // Hands: A strongest high (trips K) so wins main; B and C tie high (trips Q); D weaker high; no qualifying lows
    assignStud(state, 'a',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' }, { rank: '9', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'clubs' }, { rank: '10', suit: 'hearts' } ]
    );
    assignStud(state, 'b',
      [ { rank: 'Q', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }, { rank: '9', suit: 'spades' } ],
      [ { rank: 'Q', suit: 'hearts' }, { rank: 'A', suit: 'spades' }, { rank: 'J', suit: 'hearts' }, { rank: '10', suit: 'clubs' } ]
    );
    assignStud(state, 'c',
      [ { rank: 'Q', suit: 'clubs' }, { rank: 'Q', suit: 'hearts' }, { rank: '9', suit: 'diamonds' } ],
      [ { rank: 'Q', suit: 'spades' }, { rank: 'A', suit: 'diamonds' }, { rank: 'J', suit: 'clubs' }, { rank: '10', suit: 'diamonds' } ]
    );
    assignStud(state, 'd',
      [ { rank: 'J', suit: 'hearts' }, { rank: 'J', suit: 'diamonds' }, { rank: '10', suit: 'spades' } ],
      [ { rank: '9', suit: 'hearts' }, { rank: '6', suit: 'clubs' }, { rank: 'Q', suit: 'clubs' }, { rank: '2', suit: 'clubs' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // Expected: main 80 -> all high to A; side1 123 -> high split between B and C (tie), odd chip to earlier position (B)
    const high = s.lastHiLoResult!.high;
    const low = s.lastHiLoResult!.low;
    expect(low).toBeNull();
    const hA = high.find(h => h.playerId === 'a')?.amount || 0;
    const hB = high.find(h => h.playerId === 'b')?.amount || 0;
    const hC = high.find(h => h.playerId === 'c')?.amount || 0;
    const hD = high.find(h => h.playerId === 'd')?.amount || 0;
    expect(hA).toBe(80);
    expect(hB).toBe(62); // 123 -> 61 each +1 odd to earliest winner (B)
    expect(hC).toBe(61);
    expect(hD).toBe(0);
    const highTotal = high.reduce((sum: number, e: any) => sum + e.amount, 0);
    expect(highTotal).toBe(203);
  });

  test('multi side pots: tie splits with odd-chip distribution across pots (high tie in side1, low tie in side2)', () => {
    const players = [P('a', 0), P('b', 1), P('c', 2), P('d', 3)];
    const engine = createPokerEngine({ tableId: 'studhl6', players, smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud-hi-lo' } });
    engine.startNewHand();
    const es = engine as any; const state = es.state as any;
    // Reset any automatic bets and set stacked currentBet to create 2 side pots:
    // A=20, B=51, C=80, D=80 => main 80 (ABCD), side1 93 (BCD), side2 58 (CD)
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.players.find((p: any) => p.id === 'a')!.currentBet = 20;
    state.players.find((p: any) => p.id === 'b')!.currentBet = 51;
    state.players.find((p: any) => p.id === 'c')!.currentBet = 80;
    state.players.find((p: any) => p.id === 'd')!.currentBet = 80;
    state.pot = 20 + 51 + 80 + 80; // 231

    // Construct hands:
    // - High: B and D tie on two pair (3s & 2s) with A kicker; C and A weaker
    // - Low: C and D tie (A-2-3-4-7); B and A no qualifying low
    assignStud(state, 'a',
      [ { rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'clubs' } ],
      [ { rank: 'K', suit: 'diamonds' }, { rank: '5', suit: 'hearts' }, { rank: '9', suit: 'clubs' }, { rank: '8', suit: 'diamonds' } ]
    );
    assignStud(state, 'b',
      [ { rank: '2', suit: 'hearts' }, { rank: '2', suit: 'diamonds' }, { rank: 'Q', suit: 'spades' } ],
      [ { rank: '3', suit: 'clubs' }, { rank: '3', suit: 'diamonds' }, { rank: 'A', suit: 'spades' }, { rank: '9', suit: 'hearts' } ]
    );
    assignStud(state, 'c',
      [ { rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'hearts' }, { rank: '3', suit: 'diamonds' } ],
      [ { rank: '4', suit: 'spades' }, { rank: '7', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }, { rank: '9', suit: 'diamonds' } ]
    );
    assignStud(state, 'd',
      [ { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'spades' }, { rank: '7', suit: 'diamonds' } ],
      [ { rank: '2', suit: 'spades' }, { rank: '3', suit: 'hearts' }, { rank: 'A', suit: 'hearts' }, { rank: '4', suit: 'diamonds' } ]
    );

    state.stage = 'seventh'; state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();
    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Expected distribution summary by player:
    // Pots: main 80 -> hi 40, low 40; side1 93 -> hi 47, low 46; side2 58 -> hi 29, low 29
    // High: B&D tie on all their pots
    //   - main: 40 split -> B:20, D:20
    //   - side1: 47 split (odd -> remainder to earlier position among winners) -> B:24, D:23
    //   - side2 (C vs D only): D wins high -> D:29
    // Low: C&D tie on all their pots together
    //   - main: 40 split -> C:20, D:20
    //   - side1: 46 split -> C:23, D:23
    //   - side2: 29 split (odd -> remainder to earlier position among winners) -> C:15, D:14
    // Totals: High: B=44, D=72; Low: C=58, D=57; Sum=231
    const high = s.lastHiLoResult!.high;
    const low = s.lastHiLoResult!.low!;
    const hA = high.find(h => h.playerId === 'a')?.amount || 0;
    const hB = high.find(h => h.playerId === 'b')?.amount || 0;
    const hC = high.find(h => h.playerId === 'c')?.amount || 0;
    const hD = high.find(h => h.playerId === 'd')?.amount || 0;
    const lA = low.find(l => l.playerId === 'a')?.amount || 0;
    const lB = low.find(l => l.playerId === 'b')?.amount || 0;
    const lC = low.find(l => l.playerId === 'c')?.amount || 0;
    const lD = low.find(l => l.playerId === 'd')?.amount || 0;
    expect(hA).toBe(0);
    expect(hB).toBe(44);
    expect(hC).toBe(0);
    expect(hD).toBe(72);
    expect(lA).toBe(0);
    expect(lB).toBe(0);
    expect(lC).toBe(58);
    expect(lD).toBe(57);
    const highTotal = high.reduce((sum: number, e: any) => sum + e.amount, 0);
    const lowTotal = low.reduce((sum: number, e: any) => sum + e.amount, 0);
    expect(highTotal + lowTotal).toBe(231);
  });
});
