import { getDealerChoiceChooserId } from '../dealer-choice';

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
