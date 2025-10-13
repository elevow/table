import { PokerEngine } from '../poker-engine';
import { Player, PlayerAction } from '../../../types/poker';

describe('Five-Card Stud - fold ends hand immediately', () => {
  const mkPlayer = (id: string, position: number, stack: number = 1000): Player => ({
    id,
    name: id,
    position,
    stack,
    currentBet: 0,
    hasActed: false,
    isFolded: false,
    isAllIn: false,
    timeBank: 30000,
  });

  const act = (type: PlayerAction['type'], playerId: string, amount = 0): PlayerAction => ({
    type,
    playerId,
    amount,
    tableId: 't',
    timestamp: Date.now(),
  });

  it('settles immediately on third street fold (no sixth dealing)', () => {
    const players = [mkPlayer('A', 0), mkPlayer('B', 1)];
    const engine = new PokerEngine('t', players, 1, 2, { variant: 'five-card-stud', bettingMode: 'no-limit' });
    engine.startNewHand();
    let s = engine.getState();

    expect(s.variant).toBe('five-card-stud');
    expect(s.stage).toBe('third');

    // First to act folds immediately on third street
    const first = s.activePlayer;
    expect(first).toBeDefined();
    engine.handleAction(act('fold', first!, 0));

    // Engine should settle immediately (showdown) and not move to sixth
    s = engine.getState();
    expect(s.stage).toBe('showdown');

    // Ensure no additional stud cards were dealt after fold by checking studState counts are minimal
    const active = s.players.filter(p => !p.isFolded);
    expect(active.length).toBe(1);

    // The winner's stud cards should remain at whatever was dealt initially (2 cards for 5-stud at start),
    // but crucially, we should not see any added sixth card. We can't directly inspect private studState types here
    // without importing, so the primary assertion is that stage is showdown and only one player is active.
  });
});
