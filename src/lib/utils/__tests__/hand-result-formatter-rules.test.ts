import { formatHandResult, formatSevenDeuceBounty } from '../hand-result-formatter';
import type { Card, Player, TableState } from '../../../types/poker';

const c = (s: string): Card => {
  const suit = ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[s.slice(-1) as 'h' | 'd' | 'c' | 's'];
  return { rank: s.slice(0, -1) as Card['rank'], suit };
};
const cards = (s: string) => s.split(' ').map(c);

const player = (id: string, holeCards: Card[] = [], isFolded = false): Player => ({
  id, name: id.toUpperCase(), position: 1, stack: 100, currentBet: 0,
  hasActed: true, isFolded, isAllIn: false, timeBank: 30, holeCards,
});

const base = (overrides: Partial<TableState>): TableState => ({
  tableId: 't', stage: 'showdown', players: [], activePlayer: '', pot: 0, communityCards: [],
  currentBet: 0, dealerPosition: 0, smallBlind: 1, bigBlind: 2, minRaise: 2, lastRaise: 0,
  ...overrides,
});

describe('hand result messages for the new rules', () => {
  test('a razz winner is named with their low', () => {
    const state = base({
      variant: 'razz',
      players: [player('a'), player('b')],
      handWinners: ['a'],
      handResult: { pot: 10, winnings: { a: 10 } },
      studState: {
        playerCards: {
          a: { downCards: cards('Ac 2d 6c'), upCards: cards('4s 7h 8h 3c') },
          b: { downCards: cards('Kc Kd 2c'), upCards: cards('9c 3h 6d 5d') },
        },
      },
    });
    const result = formatHandResult(state)!;
    expect(result.message).toBe('🏆 A wins with 6-4-3-2-A low');
    expect(result.winners[0]).toMatchObject({ playerId: 'a', amount: 10 });
  });

  test('a razz split pot', () => {
    const state = base({
      variant: 'razz',
      players: [player('a'), player('b')],
      handWinners: ['a', 'b'],
      studState: {
        playerCards: {
          a: { downCards: cards('Ac 2d'), upCards: cards('3s 4h 5h') },
          b: { downCards: cards('Ad 2c'), upCards: cards('3h 4d 5d') },
        },
      },
    });
    expect(formatHandResult(state)!.message).toBe('🏆 A, B split the pot with 5-4-3-2-A low');
  });

  test('5-card Omaha hands are described', () => {
    const state = base({
      variant: 'omaha-5',
      players: [player('a', cards('2d 3d 4d Ks Kc')), player('b', cards('Qs Qd 5c 6c 8h'))],
      communityCards: cards('Kh 7s 7d 9c 2h'),
    });
    expect(formatHandResult(state)!.message).toContain('A wins with Full House');
  });

  test('a 7-2 bounty is added to the result', () => {
    const state = base({
      players: [player('a', cards('7c 2d')), player('b', cards('As Ks'))],
      communityCards: cards('7h 7s 2c Kd 9s'),
      sevenDeuceResult: { playerId: 'a', total: 10, payments: { b: 10 } },
    });
    expect(formatSevenDeuceBounty(state)).toBe('💰 7-2 bounty: A collects $10');
    expect(formatHandResult(state)!.message).toMatch(/A wins with Full House.* \| 💰 7-2 bounty: A collects \$10$/);
    expect(formatSevenDeuceBounty(base({}))).toBeNull();
  });
});
