import { formatHandResult, SYSTEM_SENDER_ID, FormattedHandResult } from '../hand-result-formatter';
import { TableState, Player, Card } from '../../../types/poker';

describe('hand-result-formatter', () => {
  const createPlayer = (id: string, name: string, isFolded = false, holeCards: Card[] = []): Player => ({
    id,
    name,
    position: 1,
    stack: 100,
    currentBet: 0,
    hasActed: false,
    isFolded,
    isAllIn: false,
    timeBank: 30,
    holeCards,
  });

  const createCard = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

  describe('SYSTEM_SENDER_ID', () => {
    it('should be defined as "system"', () => {
      expect(SYSTEM_SENDER_ID).toBe('system');
    });
  });

  describe('formatHandResult', () => {
    it('should return null if not at showdown', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'flop',
        players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
        activePlayer: 'p1',
        pot: 100,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
      };

      expect(formatHandResult(state)).toBeNull();
    });

    it('should format win by fold correctly', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        players: [
          createPlayer('p1', 'Player 1', false),
          createPlayer('p2', 'Player 2', true),
        ],
        activePlayer: '',
        pot: 100,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
      };

      const result = formatHandResult(state);

      expect(result).not.toBeNull();
      expect(result!.isWinByFold).toBe(true);
      expect(result!.message).toContain('Player 1');
      expect(result!.message).toContain('wins the pot');
      expect(result!.message).toContain('all others folded');
      expect(result!.winners).toHaveLength(1);
      expect(result!.winners[0].playerId).toBe('p1');
      expect(result!.winners[0].playerName).toBe('Player 1');
    });

    it('should format standard showdown winner correctly', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        players: [
          createPlayer('p1', 'Player 1', false, [
            createCard('A', 'spades'),
            createCard('K', 'spades'),
          ]),
          createPlayer('p2', 'Player 2', false, [
            createCard('2', 'clubs'),
            createCard('3', 'diamonds'),
          ]),
        ],
        activePlayer: '',
        pot: 100,
        communityCards: [
          createCard('Q', 'spades'),
          createCard('J', 'spades'),
          createCard('10', 'spades'),
          createCard('5', 'hearts'),
          createCard('6', 'hearts'),
        ],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
      };

      const result = formatHandResult(state);

      expect(result).not.toBeNull();
      expect(result!.isWinByFold).toBe(false);
      expect(result!.message).toContain('🏆');
      expect(result!.message).toContain('Player 1');
      expect(result!.winners.length).toBeGreaterThanOrEqual(1);
    });

    it('should use player id as fallback when name is not available', () => {
      const player = createPlayer('abc123', '', false);
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        players: [
          player,
          createPlayer('p2', 'Player 2', true),
        ],
        activePlayer: '',
        pot: 100,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
      };

      const result = formatHandResult(state);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('Player abc123');
    });

    it('should handle Hi-Lo results correctly', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        variant: 'omaha-hi-lo',
        players: [
          createPlayer('p1', 'Player 1', false),
          createPlayer('p2', 'Player 2', false),
        ],
        activePlayer: '',
        pot: 100,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
        lastHiLoResult: {
          high: [{ playerId: 'p1', amount: 60 }],
          low: [{ playerId: 'p2', amount: 40 }],
        },
      };

      const result = formatHandResult(state);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('High');
      expect(result!.message).toContain('Low');
      expect(result!.message).toContain('Player 1');
      expect(result!.message).toContain('Player 2');
      expect(result!.isWinByFold).toBe(false);
    });

    it('should handle Hi-Lo with no qualifying low', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        variant: 'omaha-hi-lo',
        players: [
          createPlayer('p1', 'Player 1', false),
          createPlayer('p2', 'Player 2', false),
        ],
        activePlayer: '',
        pot: 100,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
        lastHiLoResult: {
          high: [{ playerId: 'p1', amount: 100 }],
          low: null,
        },
      };

      const result = formatHandResult(state);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('No qualifying');
    });

    it('should handle Run It Twice results', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        players: [
          createPlayer('p1', 'Player 1', false),
          createPlayer('p2', 'Player 2', false),
        ],
        activePlayer: '',
        pot: 0,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
        runItTwice: {
          enabled: true,
          numberOfRuns: 2,
          boards: [],
          results: [
            { boardId: 'run-1', winners: [{ playerId: 'p1', winningHand: { rank: 10, name: 'Royal Flush', cards: [], kickers: [], strength: 10 }, potShare: 50 }] },
            { boardId: 'run-2', winners: [{ playerId: 'p2', winningHand: { rank: 5, name: 'Straight', cards: [], kickers: [], strength: 5 }, potShare: 50 }] },
          ],
          potDistribution: [
            { playerId: 'p1', amount: 50 },
            { playerId: 'p2', amount: 50 },
          ],
          seeds: [],
        },
      };

      const result = formatHandResult(state);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('Run It Twice');
      expect(result!.message).toContain('2 boards');
      expect(result!.message).toContain('Player 1');
      expect(result!.message).toContain('Player 2');
      expect(result!.winners).toHaveLength(2);
    });

    it('should handle empty players array', () => {
      const state: TableState = {
        tableId: 'table1',
        stage: 'showdown',
        players: [],
        activePlayer: '',
        pot: 100,
        communityCards: [],
        currentBet: 0,
        dealerPosition: 0,
        smallBlind: 1,
        bigBlind: 2,
        minRaise: 2,
        lastRaise: 0,
      };

      const result = formatHandResult(state);

      expect(result).toBeNull();
    });
  });
});
