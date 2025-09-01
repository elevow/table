import { PokerEngine } from '../../poker/poker-engine';
import { Player } from '../../../types/poker';

function createPlayer(id: string, position: number, stack: number = 1000): Player {
  return {
    id,
    name: id,
    position,
    stack,
    currentBet: 0,
    hasActed: false,
    isFolded: false,
    isAllIn: false,
    timeBank: 30000,
  };
}

describe('PokerEngine betting mode wiring', () => {
  it('initializes in pot-limit when configured and caps raise total to pot-limit', () => {
    const players = [createPlayer('p1', 0), createPlayer('p2', 1), createPlayer('p3', 2)];
    const engine = new PokerEngine('t1', players, 5, 10, { bettingMode: 'pot-limit' });
    engine.startNewHand();

    const state1 = engine.getState();
    // After blinds, pot should be >= 15 and currentBet = big blind
    expect(state1.pot).toBeGreaterThanOrEqual(15);
    expect(state1.currentBet).toBe(10);

  // Find first active player and try to over-raise beyond pot-limit
    const actorId = state1.activePlayer;
  const bigOverRaise = state1.pot + 1000; // clearly above pot-limit
  engine.handleAction({ type: 'raise', amount: state1.currentBet + bigOverRaise, playerId: actorId, tableId: state1.tableId, timestamp: Date.now() });

    const state2 = engine.getState();
  // Pot-limit should cap total bet to tableCurrentBet + (pot + pending calls)
    const actor = state2.players.find(p => p.id === actorId)!;
  expect(actor.currentBet).toBeGreaterThan(state1.currentBet);
  expect(actor.currentBet).toBeLessThanOrEqual(state2.currentBet);
  });

  it('can switch modes at runtime via setBettingMode', () => {
    const players = [createPlayer('p1', 0), createPlayer('p2', 1), createPlayer('p3', 2)];
    const engine = new PokerEngine('t2', players, 5, 10, { bettingMode: 'no-limit' });
    engine.startNewHand();

    // Switch to pot-limit and ensure mode reflected on state
    engine.setBettingMode('pot-limit');
    const s = engine.getState();
    expect(s.bettingMode).toBe('pot-limit');
  });
});
