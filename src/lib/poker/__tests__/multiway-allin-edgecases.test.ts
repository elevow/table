import { PokerEngine } from '../poker-engine';
import { Player, Card } from '../../../types/poker';

const createPlayer = (id: string, position: number, stack = 200): Player => ({
  id,
  name: `P${id}`,
  position,
  stack,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

describe('US-033 edge cases: side-pot ties and eligibility', () => {
  it('splits main pot three ways (by board) and splits side pot between eligible players', () => {
    const players = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
    ];
    const engine = new PokerEngine('t1', players, 5, 10);
    engine.startNewHand();

    const es = engine as any;
    const state = es.state as any;

    // Normalize away blinds/pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;

    // Contributions: p1=100, p2=100, p3=200 (p3 covers)
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
    p1.currentBet = 100; p1.stack -= 100; p1.isAllIn = true;
    p2.currentBet = 100; p2.stack -= 100; p2.isAllIn = true;
    p3.currentBet = 200; p3.stack -= 200; // covers, not necessarily all-in

    // Force a royal flush on board so all hands tie on main pot, side pot goes to eligible only
    const board: Card[] = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '10', suit: 'hearts' },
    ];
    state.communityCards = board;

    // Give arbitrary hole cards (avoid hearts duplicates to keep logic simple)
    p1.holeCards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'spades' }];
    p2.holeCards = [{ rank: '4', suit: 'clubs' }, { rank: '5', suit: 'spades' }];
    p3.holeCards = [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'spades' }];

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

  // Expected distribution:
  // Main pot: 300 split equally (100 each)
  // Extra 100 is unmatched (only p3 contributed to that level) and returns to p3
    const fp1 = s.players.find(p => p.id === 'p1')!;
    const fp2 = s.players.find(p => p.id === 'p2')!;
    const fp3 = s.players.find(p => p.id === 'p3')!;

  expect(fp1.stack).toBe(200); // 200-100 + 100
  expect(fp2.stack).toBe(200); // 200-100 + 100
  expect(fp3.stack).toBe(200); // 200-200 + 100 (main) + 100 (returned)
  });

  it('handles mixed eligibility: main pot split, side pot to stronger eligible, final side pot to single player; folded player excluded', () => {
    const players = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
      createPlayer('p4', 3, 200),
    ];
    const engine = new PokerEngine('t2', players, 5, 10);
    engine.startNewHand();

    const es = engine as any;
    const state = es.state as any;

    // Normalize away blinds/pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;

    // p4 folds out of eligibility
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
    const p4 = state.players.find((p: any) => p.id === 'p4');
    p4.isFolded = true;

    // Contributions: p1=50, p2=100, p3=150 (side pots form), p4=0 (folded)
    p1.currentBet = 50; p1.stack -= 50; p1.isAllIn = true;
    p2.currentBet = 100; p2.stack -= 100; p2.isAllIn = true;
    p3.currentBet = 150; p3.stack -= 150; // covers

    // Board: 5c,6d,7s,8h,Qc (no flush). Hole cards: p1=9x, p2=9x to make same straight; p3=4x weaker straight
    const board2: Card[] = [
      { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
      { rank: '8', suit: 'hearts' },
      { rank: 'Q', suit: 'clubs' },
    ];
    state.communityCards = board2;
    p1.holeCards = [{ rank: '9', suit: 'diamonds' }, { rank: '2', suit: 'clubs' }];
    p2.holeCards = [{ rank: '9', suit: 'hearts' }, { rank: '3', suit: 'diamonds' }];
    p3.holeCards = [{ rank: '4', suit: 'spades' }, { rank: '4', suit: 'diamonds' }];

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Expected distribution:
    // Main pot (150): split between p1 and p2 (75 each)
    // Side pot1 (100): p2 wins (stronger than p3)
    // Side pot2 (50): p3 is sole eligible, gets 50
    const fp1 = s.players.find(p => p.id === 'p1')!;
    const fp2 = s.players.find(p => p.id === 'p2')!;
    const fp3 = s.players.find(p => p.id === 'p3')!;
    const fp4 = s.players.find(p => p.id === 'p4')!;

    expect(fp1.stack).toBe(225); // 200-50 + 75
    expect(fp2.stack).toBe(275); // 200-100 + 75 + 100
    expect(fp3.stack).toBe(100); // 200-150 + 50
    expect(fp4.stack).toBe(200); // folded, unchanged
  });

  it('assigns odd remainder to the first among tied winners for an odd base pot', () => {
    const players = [
      createPlayer('p1', 0, 200),
      createPlayer('p2', 1, 200),
      createPlayer('p3', 2, 200),
    ];
    const engine = new PokerEngine('t3', players, 5, 10);
    engine.startNewHand();

    const es = engine as any;
    const state = es.state as any;

    // Normalize: return any bets to stacks; zero pot; then set an odd base pot
    state.players.forEach((p: any) => { p.stack += p.currentBet; p.currentBet = 0; });
    state.pot = 0;

    // Odd base pot to split between two tied winners (p2, p3)
    state.pot = 101;

    // Board AA KK 2 so kicker from hole decides; set p2/p3 J-kicker, p1 10-kicker
    state.communityCards = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'A', suit: 'diamonds' },
      { rank: 'K', suit: 'clubs' },
      { rank: 'K', suit: 'spades' },
      { rank: '2', suit: 'clubs' },
    ];
    const p1 = state.players.find((p: any) => p.id === 'p1');
    const p2 = state.players.find((p: any) => p.id === 'p2');
    const p3 = state.players.find((p: any) => p.id === 'p3');
    p1.holeCards = [{ rank: '10', suit: 'hearts' }, { rank: '4', suit: 'diamonds' }];
    p2.holeCards = [{ rank: 'J', suit: 'clubs' }, { rank: '3', suit: 'diamonds' }];
    p3.holeCards = [{ rank: 'J', suit: 'spades' }, { rank: '5', suit: 'hearts' }];

    state.stage = 'river';
    state.players.forEach((p: any) => { p.hasActed = true; });
    es.determineWinner();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');

    // p2 and p3 tie with AA KK J; p1 has AA KK 10. Base pot 101 splits 51 (p2) / 50 (p3) because remainder goes to first in order
    const fp1 = s.players.find(p => p.id === 'p1')!;
    const fp2 = s.players.find(p => p.id === 'p2')!;
    const fp3 = s.players.find(p => p.id === 'p3')!;
    expect(fp1.stack).toBe(200);
    expect(fp2.stack).toBe(251);
    expect(fp3.stack).toBe(250);
  });
});
