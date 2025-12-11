import { Card, GameVariant } from '../../types/poker';
import { HandEvaluator } from './hand-evaluator';

export interface OutsResult {
  // Cards that would improve the losing hand to beat the winning hand
  outs: Card[];
  // Probability of getting one of these cards on the next card (as percentage)
  oddsNextCard: number;
  // Probability of getting one of these cards by river (if multiple cards remain)
  oddsByRiver?: number;
  // Number of unknown cards remaining in the deck
  unknownCards: number;
  // Categorized outs by the hand they would make
  outsByCategory?: {
    category: string; // e.g., "Flush", "Straight", "Pair"
    cards: Card[];
    count: number;
  }[];
}

/**
 * Calculates which cards (outs) would improve a losing hand to beat a winning hand.
 * This is useful for showing players what cards they need after an all-in.
 */
export class OutsCalculator {
  /**
   * Generate all possible cards that could appear
   */
  private static getAllPossibleCards(): Card[] {
    const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const cards: Card[] = [];
    
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({ rank, suit });
      }
    }
    
    return cards;
  }

  /**
   * Check if two cards are equal
   */
  private static cardsEqual(card1: Card, card2: Card): boolean {
    return card1.rank === card2.rank && card1.suit === card2.suit;
  }

  /**
   * Check if a card is in a list of cards
   */
  private static cardInList(card: Card, cards: Card[]): boolean {
    return cards.some(c => this.cardsEqual(c, card));
  }

  /**
   * Calculate outs for Texas Hold'em or Omaha variants
   */
  private static calculateHoldemOuts(
    losingHoleCards: Card[],
    winningHoleCards: Card[],
    communityCards: Card[],
    variant?: GameVariant
  ): OutsResult {
    const isOmaha = variant === 'omaha' || variant === 'omaha-hi-lo';
    
    // Get all known cards
    const knownCards = [
      ...losingHoleCards,
      ...winningHoleCards,
      ...communityCards
    ];

    // Get all possible cards and filter out known cards
    const allCards = this.getAllPossibleCards();
    const unknownCards = allCards.filter(card => !this.cardInList(card, knownCards));

    // Evaluate the current winning hand
    const evaluateWinningHand = isOmaha
      ? () => HandEvaluator.evaluateOmahaHand(winningHoleCards, communityCards)
      : () => HandEvaluator.evaluateHand(winningHoleCards, communityCards);
    
    const winningEval = evaluateWinningHand();

    // Test each unknown card to see if it improves the losing hand enough to win
    const outs: Card[] = [];
    const outsByCategory = new Map<string, Card[]>();

    for (const testCard of unknownCards) {
      const testCommunity = [...communityCards, testCard];
      
      // Evaluate the losing hand with the test card
      const evaluateLosingHand = isOmaha
        ? () => HandEvaluator.evaluateOmahaHand(losingHoleCards, testCommunity)
        : () => HandEvaluator.evaluateHand(losingHoleCards, testCommunity);
      
      const losingEval = evaluateLosingHand();

      // Re-evaluate the winning hand with the test card (in case it helps them too)
      const winningEvalWithTest = isOmaha
        ? HandEvaluator.evaluateOmahaHand(winningHoleCards, testCommunity)
        : HandEvaluator.evaluateHand(winningHoleCards, testCommunity);

      // Compare: if losing hand now beats winning hand, this card is an out
      const comparison = HandEvaluator.compareHands(losingEval.hand, winningEvalWithTest.hand);
      
      if (comparison > 0) {
        outs.push(testCard);
        
        // Categorize by the hand description
        const category = losingEval.hand.description || 'Unknown';
        if (!outsByCategory.has(category)) {
          outsByCategory.set(category, []);
        }
        outsByCategory.get(category)!.push(testCard);
      }
    }

    // Calculate odds
    const unknownCount = unknownCards.length;
    const outsCount = outs.length;
    const oddsNextCard = unknownCount > 0 ? (outsCount / unknownCount) * 100 : 0;
    
    // Calculate odds by river (if we're not at river yet)
    const cardsToRiver = 5 - communityCards.length;
    let oddsByRiver: number | undefined;
    
    if (cardsToRiver > 1) {
      // Probability of NOT hitting on any of the remaining cards
      // For each subsequent card, calculate probability of missing
      let missAll = 1;
      for (let i = 0; i < cardsToRiver; i++) {
        const remainingCards = unknownCount - i;
        const remainingOuts = outsCount; // Outs don't decrease since we're checking if ANY out appears
        const missThisCard = (remainingCards - remainingOuts) / remainingCards;
        missAll *= missThisCard;
      }
      oddsByRiver = (1 - missAll) * 100;
    }

    // Convert categorized outs to array
    const outsByCategoryArray = Array.from(outsByCategory.entries()).map(([category, cards]) => ({
      category,
      cards,
      count: cards.length
    })).sort((a, b) => b.count - a.count);

    return {
      outs,
      oddsNextCard,
      oddsByRiver,
      unknownCards: unknownCount,
      outsByCategory: outsByCategoryArray.length > 0 ? outsByCategoryArray : undefined
    };
  }

  /**
   * Main entry point: calculate outs for any poker variant
   * 
   * @param losingHoleCards - The hole cards of the losing hand
   * @param winningHoleCards - The hole cards of the winning hand  
   * @param communityCards - The current community cards on the board
   * @param variant - The poker variant being played
   * @returns OutsResult containing the outs and odds
   */
  static calculateOuts(
    losingHoleCards: Card[],
    winningHoleCards: Card[],
    communityCards: Card[],
    variant?: GameVariant
  ): OutsResult {
    // For stud variants, outs calculation is more complex and not implemented yet
    // as cards are dealt to individual players rather than as community cards
    if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
      return {
        outs: [],
        oddsNextCard: 0,
        unknownCards: 0
      };
    }

    return this.calculateHoldemOuts(losingHoleCards, winningHoleCards, communityCards, variant);
  }

  /**
   * Format odds as a readable string (e.g., "23.5%")
   */
  static formatOdds(odds: number): string {
    return `${odds.toFixed(1)}%`;
  }

  /**
   * Format outs as a readable string (e.g., "9 outs")
   */
  static formatOuts(count: number): string {
    return count === 1 ? '1 out' : `${count} outs`;
  }
}
