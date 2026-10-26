import { chipSnapshot, diffChipMoves, POT } from '../table-animations';

const state = (over: Record<string, any> = {}) => ({
  handId: 'h1',
  handActions: [
    { playerId: 'a', action: 'small-blind', put: 1 },
    { playerId: 'b', action: 'big-blind', put: 2 },
  ],
  ...over,
});

const diff = (prev: any, next: any) => diffChipMoves(chipSnapshot(prev), chipSnapshot(next)!);

describe('diffChipMoves', () => {
  it('animates nothing on first load', () => {
    expect(diff(null, state())).toEqual([]);
  });

  it('moves chips from a seat to the pot for new money in', () => {
    const prev = state();
    const next = state({ handActions: [...prev.handActions, { playerId: 'a', action: 'call', put: 1 }, { playerId: 'b', action: 'check', put: 0 }] });
    expect(diff(prev, next)).toEqual([{ id: 'h1:bet:2', from: 'a', to: POT, amount: 1 }]);
  });

  it('does not repeat moves when the same state arrives again', () => {
    expect(diff(state(), state())).toEqual([]);
  });

  it('pays winners from the pot once', () => {
    const prev = state();
    const next = state({ handResult: { pot: 3, winnings: { b: 3, a: 0 } } });
    expect(diff(prev, next)).toEqual([{ id: 'h1:win:b', from: POT, to: 'b', amount: 3 }]);
    expect(diff(next, next)).toEqual([]);
  });

  it('animates the blinds of a new hand', () => {
    const prev = state({ handResult: { pot: 3, winnings: { b: 3 } } });
    const next = state({ handId: 'h2' });
    expect(diff(prev, next).map(m => m.id)).toEqual(['h2:bet:0', 'h2:bet:1']);
  });

  it('uses the log length to spot a new hand without ids', () => {
    const prev = state({ handId: undefined, handActions: [{ playerId: 'a', put: 1 }, { playerId: 'b', put: 2 }, { playerId: 'a', put: 5 }] });
    const next = state({ handId: undefined, handActions: [{ playerId: 'b', put: 1 }] });
    expect(diff(prev, next)).toEqual([{ id: 'hand:bet:0', from: 'b', to: POT, amount: 1 }]);
  });

  it('falls back to the hand number and copes with missing fields', () => {
    expect(chipSnapshot({ handNumber: 3 })).toEqual({ handKey: '#3', actions: [], result: null });
    expect(chipSnapshot(null)).toBeNull();
  });
});
