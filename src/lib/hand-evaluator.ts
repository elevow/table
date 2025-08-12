import type { Hand } from 'pokersolver';
import { Card, HandResult } from '../types/poker';

// Using require for pokersolver as it doesn't support ES modules
const pokersolver = require('pokersolver').Hand;

export interface SidePot {
  amount: number;
  eligiblePlayers: string[];
}

export class HandEvaluator {
  private static readonly suitMap: { [key: string]: string } = {
    'hearts': 'h',
    'diamonds': 'd',
    'clubs': 'c',
    'spades': 's'
  };

  private static cardToString(card: Card): string {
    const rankMap: { [key: string]: string } = {
      '10': 'T',
      'J': 'J',
      'Q': 'Q',
      'K': 'K',
      'A': 'A'
    };
    const rank = rankMap[card.rank] || card.rank;
    return `${rank}${this.suitMap[card.suit]}`;
  }

  private static cardsToString(cards: Card[]): string[] {
    return cards.map(card => this.cardToString(card));
  }

  static evaluateHand(holeCards: Card[], communityCards: Card[]): { hand: Hand; cards: Card[] } {
    const allCards = [...holeCards, ...communityCards];
    const cardStrings = this.cardsToString(allCards);
    const hand = pokersolver.solve(cardStrings);
    
    // Map the cards in the winning hand back to our Card objects
    const winningCards = hand.cards.map(solverCard => {
      const rank = solverCard.value === 'T' ? '10' : solverCard.value;
      return allCards.find(card => 
        card.rank === rank && 
        card.suit === Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit)
      )!;
    });

    return { hand, cards: winningCards };
  }

  static calculateSidePots(players: { id: string; stack: number; currentBet: number; isFolded: boolean }[]): SidePot[] {
    const sidePots: SidePot[] = [];
    const bets = players
      .filter(p => !p.isFolded || p.currentBet > 0)
      .map(p => ({ playerId: p.id, amount: p.currentBet }))
      .sort((a, b) => a.amount - b.amount);

    let processedAmount = 0;

    bets.forEach((bet, index) => {
      const amount = bet.amount - processedAmount;
      if (amount > 0) {
        const eligiblePlayers = players
          .filter(p => p.currentBet >= bet.amount && (!p.isFolded || p.currentBet > 0))
          .map(p => p.id);

        sidePots.push({
          amount: amount * eligiblePlayers.length,
          eligiblePlayers
        });

        processedAmount = bet.amount;
      }
    });

    return sidePots;
  }

  static determineWinners(
    players: { 
      id: string; 
      holeCards: Card[]; 
      stack: number; 
      currentBet: number; 
      isFolded: boolean 
    }[], 
    communityCards: Card[]
  ): HandResult[] {
    // Calculate side pots first
    const sidePots = this.calculateSidePots(players);
    const results: HandResult[] = [];

    // Process each side pot
    sidePots.forEach(pot => {
      // Get all eligible player hands for this pot
      const eligibleHands = players
        .filter(p => pot.eligiblePlayers.includes(p.id) && !p.isFolded)
        .map(player => {
          const { hand, cards } = this.evaluateHand(player.holeCards, communityCards);
          return {
            playerId: player.id,
            hand: cards,
            solverHand: hand,
            description: hand.name,
            strength: hand.rank
          };
        });

      if (eligibleHands.length === 0) {
        // If no eligible hands (everyone folded), pot goes to last player to fold
        const lastToFold = players
          .filter(p => pot.eligiblePlayers.includes(p.id))
          .sort((a, b) => b.currentBet - a.currentBet)[0];
          
        results.push({
          playerId: lastToFold.id,
          hand: lastToFold.holeCards,
          description: 'Win by fold',
          strength: 0,
          winAmount: pot.amount
        });
        return;
      }

      // Find the highest rank in this pot
      const maxRank = Math.max(...eligibleHands.map(h => h.strength));
      
      // Get all players with the highest rank
      const potWinners = eligibleHands.filter(h => h.strength === maxRank);

      // Split pot amount among winners
      const winAmount = Math.floor(pot.amount / potWinners.length);
      
      // Add results for each winner
      potWinners.forEach(winner => {
        const existingResult = results.find(r => r.playerId === winner.playerId);
        if (existingResult) {
          existingResult.winAmount += winAmount;
        } else {
          results.push({
            playerId: winner.playerId,
            hand: winner.hand,
            description: winner.description,
            strength: winner.strength,
            winAmount
          });
        }
      });
    });

    return results;
  }
}
