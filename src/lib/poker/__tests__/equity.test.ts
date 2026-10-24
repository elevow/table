import { computeEquity } from '../equity';
import type { Card } from '../../../types/poker';

const c = (s: string): Card => {
  const rank = s.slice(0, -1) as Card['rank'];
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank, suit };
};

describe('computeEquity', () => {
  it('is exact on the river: the better hand has all the equity', () => {
    const out = computeEquity(
      [{ id: 'a', holeCards: [c('Ah'), c('Ad')] }, { id: 'b', holeCards: [c('Kh'), c('Kd')] }],
      [c('2c'), c('7s'), c('9d'), c('Jc'), c('3h')]
    );
    expect(out.find(r => r.playerId === 'a')!.equity).toBe(1);
    expect(out.find(r => r.playerId === 'b')!.equity).toBe(0);
  });

  it('counts outs exactly on the turn', () => {
    // b needs one of the two remaining kings among 44 unseen cards
    const out = computeEquity(
      [{ id: 'a', holeCards: [c('Ah'), c('Ad')] }, { id: 'b', holeCards: [c('Kh'), c('Kd')] }],
      [c('2c'), c('7s'), c('9d'), c('Jc')]
    );
    expect(out.find(r => r.playerId === 'b')!.equity).toBeCloseTo(2 / 44, 5);
  });

  it('splits a board that plays for both players', () => {
    const out = computeEquity(
      [{ id: 'a', holeCards: [c('2h'), c('3d')] }, { id: 'b', holeCards: [c('2s'), c('3c')] }],
      [c('Ac'), c('Ks'), c('Qd'), c('Jc'), c('10h')]
    );
    out.forEach(r => {
      expect(r.equity).toBe(0.5);
      expect(r.tie).toBe(1);
    });
  });

  it('estimates preflop and gives the same numbers for the same spot', () => {
    const players = [{ id: 'a', holeCards: [c('Ah'), c('Ad')] }, { id: 'b', holeCards: [c('7c'), c('2s')] }];
    const first = computeEquity(players, [], { samples: 800 });
    const second = computeEquity(players, [], { samples: 800 });
    expect(first).toEqual(second);
    // Aces are roughly an 88% favourite over seven-deuce offsuit
    expect(first.find(r => r.playerId === 'a')!.equity).toBeGreaterThan(0.8);
  });

  it('needs at least two players with cards', () => {
    expect(computeEquity([{ id: 'a', holeCards: [c('Ah'), c('Ad')] }], [])).toEqual([]);
  });
});
