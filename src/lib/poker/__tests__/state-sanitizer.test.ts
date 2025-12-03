import {
  isAllInSituation,
  shouldRevealHoleCards,
  sanitizeStateForPlayer,
  sanitizeStateForAllPlayers,
  sanitizeStateForBroadcast
} from '../state-sanitizer';
import { TableState, Player } from '../../../types/poker';

const createPlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  position: 1,
  stack: 1000,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30,
  holeCards: [
    { suit: 'hearts', rank: 'A' },
    { suit: 'spades', rank: 'K' }
  ],
  ...overrides
});

const createState = (overrides: Partial<TableState> = {}): TableState => ({
  tableId: 'test-table',
  stage: 'flop',
  players: [
    createPlayer('p1', { position: 1 }),
    createPlayer('p2', { position: 2 }),
    createPlayer('p3', { position: 3 })
  ],
  activePlayer: 'p1',
  pot: 100,
  communityCards: [
    { suit: 'hearts', rank: '2' },
    { suit: 'diamonds', rank: '3' },
    { suit: 'clubs', rank: '4' }
  ],
  currentBet: 20,
  dealerPosition: 0,
  smallBlind: 5,
  bigBlind: 10,
  minRaise: 10,
  lastRaise: 10,
  ...overrides
});

describe('state-sanitizer', () => {
  describe('isAllInSituation', () => {
    it('should return false when no players are all-in', () => {
      const state = createState();
      expect(isAllInSituation(state)).toBe(false);
    });

    it('should return true when all active players are all-in', () => {
      const state = createState({
        players: [
          createPlayer('p1', { isAllIn: true }),
          createPlayer('p2', { isAllIn: true }),
          createPlayer('p3', { isFolded: true })
        ]
      });
      expect(isAllInSituation(state)).toBe(true);
    });

    it('should return true when only one non-all-in player remains and has matched the bet', () => {
      const state = createState({
        currentBet: 100,
        players: [
          createPlayer('p1', { isAllIn: true, currentBet: 100 }),
          createPlayer('p2', { isAllIn: false, currentBet: 100 }),
          createPlayer('p3', { isFolded: true })
        ]
      });
      expect(isAllInSituation(state)).toBe(true);
    });

    it('should return false when one non-all-in player has not matched the bet', () => {
      const state = createState({
        currentBet: 100,
        players: [
          createPlayer('p1', { isAllIn: true, currentBet: 100 }),
          createPlayer('p2', { isAllIn: false, currentBet: 50 }),
          createPlayer('p3', { isFolded: true })
        ]
      });
      expect(isAllInSituation(state)).toBe(false);
    });

    it('should return false when two non-all-in players remain', () => {
      const state = createState({
        players: [
          createPlayer('p1', { isAllIn: true }),
          createPlayer('p2', { isAllIn: false }),
          createPlayer('p3', { isAllIn: false })
        ]
      });
      expect(isAllInSituation(state)).toBe(false);
    });

    it('should return false with only one active player', () => {
      const state = createState({
        players: [
          createPlayer('p1', { isAllIn: true }),
          createPlayer('p2', { isFolded: true }),
          createPlayer('p3', { isFolded: true })
        ]
      });
      expect(isAllInSituation(state)).toBe(false);
    });
  });

  describe('shouldRevealHoleCards', () => {
    it('should return true at showdown stage', () => {
      const state = createState({ stage: 'showdown' });
      expect(shouldRevealHoleCards(state)).toBe(true);
    });

    it('should return true in all-in situation', () => {
      const state = createState({
        stage: 'flop',
        players: [
          createPlayer('p1', { isAllIn: true }),
          createPlayer('p2', { isAllIn: true })
        ]
      });
      expect(shouldRevealHoleCards(state)).toBe(true);
    });

    it('should return false during normal play', () => {
      const state = createState({ stage: 'flop' });
      expect(shouldRevealHoleCards(state)).toBe(false);
    });

    it('should return false during preflop', () => {
      const state = createState({ stage: 'preflop' });
      expect(shouldRevealHoleCards(state)).toBe(false);
    });
  });

  describe('sanitizeStateForPlayer', () => {
    it('should always show own hole cards', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      const p1 = sanitized.players.find(p => p.id === 'p1');
      expect(p1?.holeCards).toBeDefined();
      expect(p1?.holeCards?.length).toBe(2);
    });

    it('should hide other players hole cards during normal play', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      const p2 = sanitized.players.find(p => p.id === 'p2');
      const p3 = sanitized.players.find(p => p.id === 'p3');
      
      expect(p2?.holeCards).toBeUndefined();
      expect(p3?.holeCards).toBeUndefined();
    });

    it('should show all hole cards at showdown', () => {
      const state = createState({ stage: 'showdown' });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      sanitized.players.forEach(p => {
        expect(p.holeCards).toBeDefined();
        expect(p.holeCards?.length).toBe(2);
      });
    });

    it('should show all hole cards in all-in situation', () => {
      const state = createState({
        stage: 'flop',
        players: [
          createPlayer('p1', { isAllIn: true }),
          createPlayer('p2', { isAllIn: true }),
          createPlayer('p3', { isFolded: true })
        ]
      });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      const p1 = sanitized.players.find(p => p.id === 'p1');
      const p2 = sanitized.players.find(p => p.id === 'p2');
      
      expect(p1?.holeCards).toBeDefined();
      expect(p2?.holeCards).toBeDefined();
    });

    it('should preserve other player properties when hiding cards', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      const p2 = sanitized.players.find(p => p.id === 'p2');
      expect(p2?.id).toBe('p2');
      expect(p2?.name).toBe('Player p2');
      expect(p2?.stack).toBe(1000);
    });

    it('should preserve community cards', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      expect(sanitized.communityCards).toEqual(state.communityCards);
    });

    it('should preserve pot and betting state', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForPlayer(state, 'p1');
      
      expect(sanitized.pot).toBe(state.pot);
      expect(sanitized.currentBet).toBe(state.currentBet);
    });
  });

  describe('sanitizeStateForPlayer with stud variants', () => {
    it('should hide down cards but show up cards for other players in stud', () => {
      const studState: TableState = createState({
        stage: 'fourth',
        variant: 'seven-card-stud',
        studState: {
          playerCards: {
            p1: {
              downCards: [
                { suit: 'hearts', rank: 'A' },
                { suit: 'spades', rank: 'K' }
              ],
              upCards: [
                { suit: 'diamonds', rank: 'Q' }
              ]
            },
            p2: {
              downCards: [
                { suit: 'clubs', rank: 'J' },
                { suit: 'hearts', rank: '10' }
              ],
              upCards: [
                { suit: 'spades', rank: '9' }
              ]
            }
          }
        }
      });

      const sanitized = sanitizeStateForPlayer(studState, 'p1');
      
      // Own cards should all be visible
      expect(sanitized.studState?.playerCards.p1.downCards).toHaveLength(2);
      expect(sanitized.studState?.playerCards.p1.upCards).toHaveLength(1);
      
      // Other players' down cards should be hidden
      expect(sanitized.studState?.playerCards.p2.downCards).toHaveLength(0);
      // Other players' up cards should be visible
      expect(sanitized.studState?.playerCards.p2.upCards).toHaveLength(1);
    });

    it('should show all stud cards at showdown', () => {
      const studState: TableState = createState({
        stage: 'showdown',
        variant: 'seven-card-stud',
        studState: {
          playerCards: {
            p1: {
              downCards: [
                { suit: 'hearts', rank: 'A' },
                { suit: 'spades', rank: 'K' }
              ],
              upCards: [
                { suit: 'diamonds', rank: 'Q' }
              ]
            },
            p2: {
              downCards: [
                { suit: 'clubs', rank: 'J' },
                { suit: 'hearts', rank: '10' }
              ],
              upCards: [
                { suit: 'spades', rank: '9' }
              ]
            }
          }
        }
      });

      const sanitized = sanitizeStateForPlayer(studState, 'p1');
      
      // All cards should be visible at showdown
      expect(sanitized.studState?.playerCards.p2.downCards).toHaveLength(2);
      expect(sanitized.studState?.playerCards.p2.upCards).toHaveLength(1);
    });
  });

  describe('sanitizeStateForAllPlayers', () => {
    it('should return sanitized state for each player', () => {
      const state = createState({ stage: 'flop' });
      const sanitizedMap = sanitizeStateForAllPlayers(state);
      
      expect(sanitizedMap.size).toBe(3);
      expect(sanitizedMap.has('p1')).toBe(true);
      expect(sanitizedMap.has('p2')).toBe(true);
      expect(sanitizedMap.has('p3')).toBe(true);
    });

    it('should give each player their own view with only their cards visible', () => {
      const state = createState({ stage: 'flop' });
      const sanitizedMap = sanitizeStateForAllPlayers(state);
      
      // P1's view: only p1's cards visible
      const p1View = sanitizedMap.get('p1');
      expect(p1View?.players.find(p => p.id === 'p1')?.holeCards).toBeDefined();
      expect(p1View?.players.find(p => p.id === 'p2')?.holeCards).toBeUndefined();
      
      // P2's view: only p2's cards visible
      const p2View = sanitizedMap.get('p2');
      expect(p2View?.players.find(p => p.id === 'p1')?.holeCards).toBeUndefined();
      expect(p2View?.players.find(p => p.id === 'p2')?.holeCards).toBeDefined();
    });
  });

  describe('sanitizeStateForBroadcast', () => {
    it('should hide all hole cards during normal play', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForBroadcast(state);
      
      sanitized.players.forEach(p => {
        expect(p.holeCards).toBeUndefined();
      });
    });

    it('should show all hole cards at showdown', () => {
      const state = createState({ stage: 'showdown' });
      const sanitized = sanitizeStateForBroadcast(state);
      
      sanitized.players.forEach(p => {
        expect(p.holeCards).toBeDefined();
        expect(p.holeCards?.length).toBe(2);
      });
    });

    it('should show all hole cards in all-in situation', () => {
      const state = createState({
        stage: 'flop',
        players: [
          createPlayer('p1', { isAllIn: true }),
          createPlayer('p2', { isAllIn: true }),
          createPlayer('p3', { isFolded: true })
        ]
      });
      const sanitized = sanitizeStateForBroadcast(state);
      
      const p1 = sanitized.players.find(p => p.id === 'p1');
      const p2 = sanitized.players.find(p => p.id === 'p2');
      
      expect(p1?.holeCards).toBeDefined();
      expect(p2?.holeCards).toBeDefined();
    });

    it('should preserve other player properties when hiding cards', () => {
      const state = createState({ stage: 'flop' });
      const sanitized = sanitizeStateForBroadcast(state);
      
      const p1 = sanitized.players.find(p => p.id === 'p1');
      expect(p1?.id).toBe('p1');
      expect(p1?.name).toBe('Player p1');
      expect(p1?.stack).toBe(1000);
    });

    it('should hide stud down cards but show up cards during normal play', () => {
      const studState: TableState = createState({
        stage: 'fourth',
        variant: 'seven-card-stud',
        studState: {
          playerCards: {
            p1: {
              downCards: [
                { suit: 'hearts', rank: 'A' },
                { suit: 'spades', rank: 'K' }
              ],
              upCards: [
                { suit: 'diamonds', rank: 'Q' }
              ]
            },
            p2: {
              downCards: [
                { suit: 'clubs', rank: 'J' },
                { suit: 'hearts', rank: '10' }
              ],
              upCards: [
                { suit: 'spades', rank: '9' }
              ]
            }
          }
        }
      });

      const sanitized = sanitizeStateForBroadcast(studState);
      
      // All down cards should be hidden
      expect(sanitized.studState?.playerCards.p1.downCards).toHaveLength(0);
      expect(sanitized.studState?.playerCards.p2.downCards).toHaveLength(0);
      
      // Up cards should be visible
      expect(sanitized.studState?.playerCards.p1.upCards).toHaveLength(1);
      expect(sanitized.studState?.playerCards.p2.upCards).toHaveLength(1);
    });
  });
});
