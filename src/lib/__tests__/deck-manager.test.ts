import { DeckManager } from '../poker/deck-manager';

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
});
