import { randomInt } from 'crypto';
import { DeckManager } from '../poker/deck-manager';

// Keep the real implementation but record calls, so tests can confirm where randomness comes from
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomInt: jest.fn((...args: any[]) => actual.randomInt(...args)) };
});
const mockRandomInt = randomInt as unknown as jest.Mock;

describe('DeckManager', () => {
  let deckManager: DeckManager;

  beforeEach(() => {
    deckManager = new DeckManager();
  });

  describe('resetDeck', () => {
    it('should create a new deck with 52 cards', () => {
      deckManager.resetDeck();
      
      // Deal all cards and verify count and uniqueness
      const cards = [];
      for (let i = 0; i < 52; i++) {
        const card = deckManager.dealCard();
        expect(card).toBeDefined();
        if (card) {
          cards.push(card);
        }
      }

      // Verify we have all 52 unique cards
      expect(cards.length).toBe(52);
      const uniqueCards = new Set(cards.map(c => `${c.rank}${c.suit}`));
      expect(uniqueCards.size).toBe(52);

      // Verify no more cards can be dealt
      expect(deckManager.dealCard()).toBeUndefined();
    });
  });

  describe('dealCard', () => {
    beforeEach(() => {
      deckManager.resetDeck();
    });

    it('should deal one card at a time', () => {
      const card1 = deckManager.dealCard();
      const card2 = deckManager.dealCard();

      expect(card1).toBeDefined();
      expect(card2).toBeDefined();
      expect(card1).not.toEqual(card2);
    });

    it('should return undefined when deck is empty', () => {
      // Deal all 52 cards
      for (let i = 0; i < 52; i++) {
        deckManager.dealCard();
      }

      expect(deckManager.dealCard()).toBeUndefined();
    });
  });

  describe('dealCards', () => {
    beforeEach(() => {
      deckManager.resetDeck();
    });

    it('should deal multiple cards', () => {
      const cards = deckManager.dealCards(5);
      expect(cards.length).toBe(5);
      
      // Verify all cards are unique
      const uniqueCards = new Set(cards.map(c => `${c.rank}${c.suit}`));
      expect(uniqueCards.size).toBe(5);
    });

    it('should deal remaining cards when count exceeds deck size', () => {
      // First deal 50 cards
      deckManager.dealCards(50);
      
      // Try to deal 5 more
      const remainingCards = deckManager.dealCards(5);
      expect(remainingCards.length).toBe(2); // Should only get the 2 remaining cards
    });
  });

  describe('shuffle randomness', () => {
    let mathRandom: jest.SpyInstance;

    beforeEach(() => {
      mockRandomInt.mockClear();
      mathRandom = jest.spyOn(Math, 'random');
    });

    afterEach(() => mathRandom.mockRestore());

    it('shuffles a new deck with crypto.randomInt, not Math.random', () => {
      deckManager.resetDeck();
      // Fisher-Yates over 52 cards draws once per position from 51 down to 1
      expect(mockRandomInt).toHaveBeenCalledTimes(51);
      expect(mockRandomInt).toHaveBeenNthCalledWith(1, 52);
      expect(mockRandomInt).toHaveBeenLastCalledWith(2);
      expect(mathRandom).not.toHaveBeenCalled();
    });

    it('produces different orders across shuffles', () => {
      const orders = new Set<string>();
      for (let i = 0; i < 5; i++) {
        deckManager.resetDeck();
        orders.add(deckManager.getRemainingDeck().map(c => `${c.rank}${c.suit}`).join(','));
      }
      expect(orders.size).toBe(5);
    });

    it('shuffles an unseeded partial deck with crypto.randomInt', () => {
      const exclude = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }] as any;
      const dm = DeckManager.fromExcluding(exclude);
      const cards = dm.getRemainingDeck();
      expect(cards).toHaveLength(50);
      expect(cards.some(c => c.rank === 'A' && c.suit === 'spades')).toBe(false);
      expect(mockRandomInt).toHaveBeenCalledTimes(49);
      expect(mathRandom).not.toHaveBeenCalled();
    });

    it('keeps seeded partial decks deterministic for Run It Twice verification', () => {
      const first = DeckManager.fromExcluding([], 12345).getRemainingDeck();
      const second = DeckManager.fromExcluding([], 12345).getRemainingDeck();
      expect(second).toEqual(first);
      expect(mockRandomInt).not.toHaveBeenCalled();
    });
  });
});
