import { getDealerChoiceChooserId } from '../dealer-choice';
import { PokerEngine } from '../poker-engine';

describe('getDealerChoiceChooserId', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any;

  it('returns the player after the dealer button', () => {
    expect(getDealerChoiceChooserId({ players, dealerPosition: 0 })).toBe('b');
    expect(getDealerChoiceChooserId({ players, dealerPosition: 1 })).toBe('c');
  });

  it('wraps around to the first player', () => {
    expect(getDealerChoiceChooserId({ players, dealerPosition: 2 })).toBe('a');
  });

  it('treats a missing dealer position as seat index 0', () => {
    expect(getDealerChoiceChooserId({ players } as any)).toBe('b');
  });

  it('returns undefined when there are no players', () => {
    expect(getDealerChoiceChooserId({ players: [], dealerPosition: 0 })).toBeUndefined();
    expect(getDealerChoiceChooserId(null)).toBeUndefined();
  });
});

describe("dealer's-choice hand count", () => {
  const mk = (id: string, position: number): any => ({
    id, name: id, position, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
  });

  it('counts hands since the last pause and keeps the count in the saved state', () => {
    const engine = new PokerEngine('t', [mk('a', 1), mk('b', 2), mk('c', 3)], 1, 2);
    engine.pauseForDealerChoice();
    expect(engine.getState().dealersChoiceHandCount).toBe(0);
    engine.startNewHand();
    engine.startNewHand();
    expect(engine.getState().dealersChoiceHandCount).toBe(2);

    // A restored engine (another server instance) sees the same count
    const restored = PokerEngine.fromSerialized(JSON.parse(JSON.stringify(engine.serialize())));
    expect(restored.getState().dealersChoiceHandCount).toBe(2);

    restored.pauseForDealerChoice();
    expect(restored.getState().dealersChoiceHandCount).toBe(0);
  });
});
