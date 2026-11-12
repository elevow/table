import { PokerEngine } from '../poker-engine';
import { holeCardCount, isOmahaVariant } from '../variant-rules';
import { resolveVariantAndMode } from '../../game/variant-mapping';
import type { Player, PlayerAction } from '../../../types/poker';

const P = (id: string, pos: number, stack = 100): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

const courchevel = () => new PokerEngine('t', [P('a', 1), P('b', 2)], 1, 2, { variant: 'courchevel', bettingMode: 'pot-limit' });

const act = (engine: PokerEngine, type: PlayerAction['type']) =>
  engine.handleAction({ type, playerId: engine.getState().activePlayer, tableId: 't', timestamp: Date.now() });

describe('Courchevel', () => {
  test('is five-card Omaha, pot limit by default', () => {
    expect(holeCardCount('courchevel')).toBe(5);
    expect(isOmahaVariant('courchevel')).toBe(true);
    expect(resolveVariantAndMode({ variant: 'courchevel' }).bettingMode).toBe('pot-limit');
  });

  test('shows the first flop card before the preflop betting, then the other two', () => {
    const engine = courchevel();
    engine.startNewHand();
    let s = engine.getState();
    expect(s.players[0].holeCards).toHaveLength(5);
    expect(s.stage).toBe('preflop');
    expect(s.communityCards).toHaveLength(1);
    const first = s.communityCards[0];
    act(engine, 'call');
    act(engine, 'check');
    s = engine.getState();
    expect(s.stage).toBe('flop');
    expect(s.communityCards).toHaveLength(3);
    expect(s.communityCards[0]).toEqual(first);
    act(engine, 'check');
    act(engine, 'check');
    expect(engine.getState().communityCards).toHaveLength(4);
  });

  test('an all-in runout deals only the two flop cards still to come', () => {
    const engine = courchevel();
    engine.startNewHand();
    const flop = engine.previewRabbitHunt('flop');
    expect(flop.cards).toHaveLength(2);
  });
});
