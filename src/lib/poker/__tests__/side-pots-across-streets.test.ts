import { PokerEngine } from '../poker-engine';
import { PotCalculator } from '../pot-calculator';
import { DeckManager } from '../deck-manager';
import { Card, Player, TableState } from '../../../types/poker';

const createPlayer = (id: string, position: number, stack: number): Player => ({
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

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

// Player a holds a royal flush with this board, so a wins every pot it is eligible for
const ROYAL_HOLE = [card('A', 'hearts'), card('K', 'hearts')];
const ROYAL_FLOP = [card('Q', 'hearts'), card('J', 'hearts'), card('10', 'hearts')];

type Decide = (state: TableState, player: Player) => { type: 'check' | 'call' | 'bet' | 'raise'; amount?: number };

/** Play actions for whoever is to act until showdown, or until `stopAtStage` is reached. */
function play(engine: PokerEngine, decide: Decide, onStage?: (stage: string) => void, stopAtStage?: string): void {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const state = engine.getState();
    if (!seen.has(state.stage)) {
      seen.add(state.stage);
      onStage?.(state.stage);
    }
    if (state.stage === 'showdown' || state.stage === stopAtStage || !state.activePlayer) return;
    const player = state.players.find(p => p.id === state.activePlayer)!;
    const { type, amount } = decide(state, player);
    engine.handleAction({ type, amount, playerId: player.id, tableId: state.tableId, timestamp: Date.now() } as any);
  }
  throw new Error('Hand did not finish');
}

const callOrCheck = (state: TableState, player: Player) =>
  state.currentBet > player.currentBet ? { type: 'call' as const } : { type: 'check' as const };

const totalChips = (state: TableState) => state.players.reduce((sum, p) => sum + p.stack, 0) + state.pot;
const stackOf = (state: TableState, id: string) => state.players.find(p => p.id === id)!.stack;

describe('side pots use contributions from the whole hand', () => {
  it('a short stack that goes all-in on the flop wins only the main pot', () => {
    // a: 100, b and c: 1000. Everyone calls preflop, b bets 200 on the flop,
    // a calls all-in for the rest, c calls, then b and c check down.
    const engine = new PokerEngine('t-side', [
      createPlayer('a', 0, 100),
      createPlayer('b', 1, 1000),
      createPlayer('c', 2, 1000),
    ], 5, 10);
    engine.startNewHand();
    const internal = (engine as any).state as TableState;
    const before = totalChips(engine.getState());

    play(
      engine,
      (state, player) => {
        if (state.stage === 'flop' && player.id === 'b' && state.currentBet === 0) {
          return { type: 'bet', amount: 200 };
        }
        return callOrCheck(state, player);
      },
      stage => {
        if (stage === 'flop') {
          internal.players.find(p => p.id === 'a')!.holeCards = ROYAL_HOLE;
          internal.players.find(p => p.id === 'b')!.holeCards = [card('2', 'clubs'), card('3', 'diamonds')];
          internal.players.find(p => p.id === 'c')!.holeCards = [card('4', 'clubs'), card('5', 'diamonds')];
          internal.communityCards = [...ROYAL_FLOP];
          // Rebuild the deck without the cards assigned above so the turn and river can't repeat them
          const assigned = [...internal.players.flatMap(p => p.holeCards || []), ...internal.communityCards];
          (engine as any).deckManager = DeckManager.fromExcluding(assigned);
        }
      }
    );

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // a put in 100 (10 preflop + 90 on the flop), so a can win 100 from each player: 300
    expect(stackOf(s, 'a')).toBe(300);
    // b and c each put in 210; the 220 side pot goes back to one of them
    expect(stackOf(s, 'b') + stackOf(s, 'c')).toBe(2000 - 420 + 220);
    expect(totalChips(s)).toBe(before);
  });

  it('Run It Twice awards each side pot only to players eligible for it', () => {
    // a: 100, b: 300, c: 1000, all-in preflop. c's last 700 is uncalled.
    const engine = new PokerEngine('t-rit-side', [
      createPlayer('a', 0, 100),
      createPlayer('b', 1, 300),
      createPlayer('c', 2, 1000),
    ], 5, 10);
    engine.startNewHand();
    const internal = (engine as any).state as TableState;
    const before = totalChips(engine.getState());

    // Stop once preflop betting closes; that is where the API offers Run It Twice
    play(
      engine,
      (state, player) =>
        player.currentBet + player.stack > state.currentBet
          ? { type: 'raise', amount: 5000 }
          : { type: 'call' },
      undefined,
      'flop'
    );

    // Give a a royal flush on the flop that was just dealt, then run the turn and river twice
    internal.players.find(p => p.id === 'a')!.holeCards = ROYAL_HOLE;
    internal.players.find(p => p.id === 'b')!.holeCards = [card('2', 'clubs'), card('3', 'diamonds')];
    internal.players.find(p => p.id === 'c')!.holeCards = [card('4', 'clubs'), card('5', 'diamonds')];
    internal.communityCards = [...ROYAL_FLOP];
    engine.enableRunItTwice(2, ['seed1', 'seed2']);
    engine.runItTwiceNow();

    const s = engine.getState();
    expect(s.stage).toBe('showdown');
    // a wins the 300 main pot (150 per run) and nothing from the side pots
    expect(stackOf(s, 'a')).toBe(300);
    expect(s.runItTwice?.results.every(run => run.winners.find(w => w.playerId === 'a')?.potShare === 150)).toBe(true);
    // c gets back the uncalled 700; the 400 side pot goes to b or c
    expect(stackOf(s, 'c')).toBeGreaterThanOrEqual(700);
    expect(stackOf(s, 'b') + stackOf(s, 'c')).toBe(1100);
    expect(totalChips(s)).toBe(before);
  });
});

describe('PotCalculator.calculatePotsFromContributions', () => {
  it('builds main and side pots by contribution level', () => {
    const pots = PotCalculator.calculatePotsFromContributions([
      { id: 'a', contributed: 100, isFolded: false },
      { id: 'b', contributed: 300, isFolded: false },
      { id: 'c', contributed: 1000, isFolded: false },
    ]);
    expect(pots).toEqual([
      { amount: 300, eligiblePlayers: ['a', 'b', 'c'] },
      { amount: 400, eligiblePlayers: ['b', 'c'] },
      { amount: 700, eligiblePlayers: ['c'] },
    ]);
  });

  it('counts folded chips in the pots without making the folder eligible', () => {
    const pots = PotCalculator.calculatePotsFromContributions([
      { id: 'a', contributed: 50, isFolded: false },
      { id: 'b', contributed: 80, isFolded: true },
      { id: 'c', contributed: 200, isFolded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligiblePlayers: ['a', 'c'] },
      { amount: 60, eligiblePlayers: ['c'] },
      { amount: 120, eligiblePlayers: ['c'] },
    ]);
  });

  it('adds a layer no remaining player reached to the pot below it', () => {
    const pots = PotCalculator.calculatePotsFromContributions([
      { id: 'a', contributed: 100, isFolded: false },
      { id: 'b', contributed: 100, isFolded: false },
      { id: 'c', contributed: 150, isFolded: true },
    ]);
    expect(pots).toEqual([{ amount: 350, eligiblePlayers: ['a', 'b'] }]);
  });
});
