import { PotLimitCalculator } from '../pot-limit';
import { BettingManager } from '../betting-manager';
import { Player } from '../../../types/poker';
import { PlayerAction } from '../../../types/poker-engine';

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: overrides.id || 'p',
  name: 'Player',
  position: overrides.position ?? 0,
  stack: overrides.stack ?? 1000,
  currentBet: overrides.currentBet ?? 0,
  hasActed: overrides.hasActed ?? false,
  isFolded: overrides.isFolded ?? false,
  isAllIn: overrides.isAllIn ?? false,
  timeBank: overrides.timeBank ?? 30000,
  holeCards: overrides.holeCards,
});

describe('PotLimitCalculator', () => {
  it('calculates max bet with no active bet as current pot', () => {
    const currentPot = 200;
    const res = PotLimitCalculator.calculateMaxBet(currentPot, 0, [], 0);
    expect(res.maxBet).toBe(currentPot);
    expect(res.pendingCalls).toBe(0);
  });

  it('calculates max bet with active bet including pending calls', () => {
    const currentPot = 300;
    const tableCurrentBet = 100;
    const players = [
      { currentBet: 20, isFolded: false, isAllIn: false }, // needs 80 to call
      { currentBet: 100, isFolded: false, isAllIn: false },
      { currentBet: 100, isFolded: false, isAllIn: false },
    ];
    const res = PotLimitCalculator.calculateMaxBet(currentPot, tableCurrentBet, players, 20);
    // pendingCalls = 80 (actor) + 0 + 0 = 80
    // maxRaise = pot(300) + pendingCalls(80) = 380
    // maxBet = tableCurrentBet(100) + 380 = 480
    expect(res.pendingCalls).toBe(80);
    expect(res.maxBet).toBe(480);
  });
});

describe('BettingManager - pot-limit mode', () => {
  let bm: BettingManager;
  let p1: Player;
  let p2: Player;
  let p3: Player;

  beforeEach(() => {
    bm = new BettingManager(10, 20);
    bm.setMode('pot-limit');
    p1 = makePlayer({ id: 'p1', position: 0, stack: 1000, currentBet: 0 });
    p2 = makePlayer({ id: 'p2', position: 1, stack: 1000, currentBet: 0 });
    p3 = makePlayer({ id: 'p3', position: 2, stack: 1000, currentBet: 0 });
  });

  it('caps initial bet to current pot when no active bet', () => {
    const action: PlayerAction = { type: 'bet', playerId: 'p1', amount: 500 };
    const ctx = { currentPot: 200, players: [p1, p2, p3] };
    const res = bm.processAction(p1, action, 0, 20, ctx);
    expect(p1.currentBet).toBe(200); // capped to pot
    expect(res.pot).toBe(200);
  });

  it('caps raise total to pot-limit when there is an active bet', () => {
    // Set a live bet at 100; p2 and p3 have matched; p1 has posted 20 already
    p1.currentBet = 20;
    p2.currentBet = 100;
    p3.currentBet = 100;
    const ctx = { currentPot: 300, players: [p1, p2, p3] };
    const action: PlayerAction = { type: 'raise', playerId: 'p1', amount: 2000 };
    const res = bm.processAction(p1, action, 100, 20, ctx);
    // From earlier calc, max total is 480; delta from 20 -> 460 added to pot
    expect(p1.currentBet).toBe(480);
    expect(res.pot).toBe(460);
    expect(res.currentBet).toBe(480);
  });

  it('announcePot returns readable value', () => {
    expect(bm.announcePot(345)).toBe('Pot is 345');
  });

  it('allows short all-in raise below minRaise without updating minRaise', () => {
    // Active bet at 100, previous full raise established minRaise=50
    p1.currentBet = 100; // actor has already called
    p2.currentBet = 100;
    p3.currentBet = 100;
    p1.stack = 30; // short stack can only add 30 more (short all-in)

    const ctx = { currentPot: 300, players: [p1, p2, p3] };
    const action: PlayerAction = { type: 'raise', playerId: 'p1', amount: 130 }; // total target
    const res = bm.processAction(p1, action, 100, 50, ctx);

    expect(p1.isAllIn).toBe(true);
    expect(p1.currentBet).toBe(130);
    expect(res.pot).toBe(30); // only the delta is added
    expect(res.currentBet).toBe(130);
    // minRaise should remain unchanged because this was a short all-in raise
    expect(res.minRaise).toBe(50);
  });

  it('announcePot reflects pot after multiway actions', () => {
    // Post blinds first
    p1.position = 1; // SB
    p2.position = 2; // BB
    p3.position = 3; // UTG
    const blindRes = bm.postBlinds([p1, p2, p3]);
    let pot = blindRes.pot; // 10 + 20 = 30
    let currentBet = blindRes.currentBet; // 20
    let minRaise = 20; // start of preflop

    // p3 raises to 60 total (40 raise) within PL cap
    let r = bm.processAction(p3, { type: 'raise', playerId: 'p3', amount: 60 }, currentBet, minRaise, {
      currentPot: pot,
      players: [p1, p2, p3],
    });
    pot += r.pot; // +60
    currentBet = r.currentBet; // 60
    minRaise = r.minRaise; // 40

    // p1 calls to 60
    r = bm.processAction(p1, { type: 'call', playerId: 'p1' }, currentBet, minRaise, {
      currentPot: pot,
      players: [p1, p2, p3],
    });
    pot += r.pot; // +50 (60-10)

    // p2 calls to 60
    r = bm.processAction(p2, { type: 'call', playerId: 'p2' }, currentBet, minRaise, {
      currentPot: pot,
      players: [p1, p2, p3],
    });
    pot += r.pot; // +40 (60-20)

    expect(pot).toBe(180);
    expect(bm.announcePot(pot)).toBe('Pot is 180');
  });
});
