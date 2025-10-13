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
  
  private static debugEnabled = process.env.DEBUG_POKER === 'true';
  
  // Static logging methods that respect environment variables
  private static log(message: string, ...args: any[]): void {
    if (this.debugEnabled) {
      // console.log(message, ...args);
    }
  }

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
    // Filter invalid cards defensively
    const allCardsRaw = [...(holeCards || []), ...(communityCards || [])];
    const allCards: Card[] = allCardsRaw.filter((c: any) => c && c.rank && c.suit) as Card[];

    // If fewer than 2 valid cards, return a safe High Card fallback and avoid solver
    if (allCards.length < 2) {
      const weight: Record<Card['rank'], number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
      const sorted = [...allCards].sort((a, b) => weight[b.rank] - weight[a.rank]);
      const best = sorted.slice(0, Math.min(5, sorted.length));
      const top = best[0]?.rank || '';
      const labelMap: Record<Card['rank'], string> = { '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace' } as any;
      return { hand: { rank: 1, name: top ? `${labelMap[top as Card['rank']]} High` : 'High Card', descr: top ? `${labelMap[top as Card['rank']]} High` : 'High Card', cards: [] } as any, cards: best };
    }

    const cardStrings = this.cardsToString(allCards);
    const validStr = (s: string) => typeof s === 'string' && /^(?:10|[2-9TJQKA])[hdcs]$/.test(s);
    const allValid = cardStrings.length >= 2 && cardStrings.every(validStr);
    let hand: any;
    try {
      hand = allValid ? pokersolver.solve(cardStrings) : undefined;
      if (!hand) throw new Error('invalid card strings for solver');
    } catch (e) {
      // Fallback to High Card if solver fails
      const weight: Record<Card['rank'], number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
      const sorted = [...allCards].sort((a, b) => weight[b.rank] - weight[a.rank]);
      const best = sorted.slice(0, 5);
      const top = best[0]?.rank || '';
      const labelMap: Record<Card['rank'], string> = { '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace' } as any;
      return { hand: { rank: 1, name: top ? `${labelMap[top as Card['rank']]} High` : 'High Card', descr: top ? `${labelMap[top as Card['rank']]} High` : 'High Card', cards: [] } as any, cards: best };
    }
    
    // Map the cards in the winning hand back to our Card objects; if mapping fails, synthesize a card
    const winningCards = hand.cards.map((solverCard: any) => {
      const rank = solverCard.value === 'T' ? '10' : solverCard.value;
      const suit = Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit) as Card['suit'] | undefined;
      return (
        allCards.find(card => card.rank === (rank as any) && card.suit === suit) ||
        ({ rank: rank as any, suit: (suit || 'hearts') as any })
      );
    });

    return { hand, cards: winningCards };
  }

  static calculateSidePots(players: { id: string; stack: number; currentBet: number; isFolded: boolean }[]): SidePot[] {
    this.log('Calculating side pots for players:', players);

    // First handle the simple case with no bets
    const bettingPlayers = players.filter(p => p.currentBet > 0);
    this.log('Betting players:', bettingPlayers);

    if (bettingPlayers.length === 0) return [];

    // Get all unique bet amounts in ascending order
    const bets = bettingPlayers.map(p => p.currentBet);
    const uniqueBets = Array.from(new Set(bets));
    uniqueBets.sort((a, b) => a - b);
    this.log('Unique bet amounts:', uniqueBets);

    // Handle case with single pot
    if (uniqueBets.length === 1) {
      const bet = uniqueBets[0];
      return [{
        amount: bet * bettingPlayers.length,
        eligiblePlayers: bettingPlayers.map(p => p.id)
      }];
    }

    // Calculate side pots
    const sidePots: SidePot[] = [];
    let previousBet = 0;
    
    // Handle each bet level
    uniqueBets.forEach(currentBet => {
      const eligiblePlayers = bettingPlayers
        .filter(p => p.currentBet >= currentBet)
        .map(p => p.id);
      
      this.log(`Processing bet level ${currentBet}, prev bet ${previousBet}`);
      this.log(`Eligible players for bet ${currentBet}:`, eligiblePlayers);

      // Calculate pot amount
      const amount = (currentBet - previousBet) * eligiblePlayers.length;
      this.log(`Adding side pot: amount=${amount} ((${currentBet} - ${previousBet}) × ${eligiblePlayers.length})`);

      if (amount > 0) {
        sidePots.push({
          amount,
          eligiblePlayers
        });
      }
      
      previousBet = currentBet;
    });

    this.log('Final side pots:', sidePots);
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
    this.log('Determining winners for ' + players.length + ' players');
    // Handle all-fold scenario
    const activePlayers = players.filter(p => !p.isFolded);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = players.reduce((sum, p) => sum + p.currentBet, 0);
      return [{
        playerId: winner.id,
        hand: winner.holeCards,
        description: 'Win by fold',
        strength: 0,
        winAmount: totalPot
      }];
    }

    // Calculate side pots
    const pots = this.calculateSidePots(players);
    this.log('Calculated pots for winner determination:', pots);
    
    if (pots.length === 0) return [];

    // Pre-evaluate all hands
    const playerHands = new Map<string, { hand: Hand; cards: Card[] }>();
    const results = new Map<string, HandResult>();

    // Process each side pot
    pots.forEach((pot, index) => {
      this.log(`Processing pot ${index}:`, pot);
      // Get or calculate player hands for this pot
      const eligibleHands = players
        .filter(p => pot.eligiblePlayers.includes(p.id) && !p.isFolded)
        .map(player => {
          let handInfo = playerHands.get(player.id);
          if (!handInfo) {
            handInfo = this.evaluateHand(player.holeCards, communityCards);
            playerHands.set(player.id, handInfo);
          }

          return {
            playerId: player.id,
            hand: handInfo.cards,
            description: handInfo.hand.name,
            strength: handInfo.hand.rank
          };
        });

      // Handle all fold case for this pot
      if (eligibleHands.length === 0) {
        const lastBettor = players
          .filter(p => pot.eligiblePlayers.includes(p.id))
          .sort((a, b) => b.currentBet - a.currentBet)[0];

        const existingResult = results.get(lastBettor.id) || {
          playerId: lastBettor.id,
          hand: lastBettor.holeCards,
          description: 'Win by fold',
          strength: 0,
          winAmount: 0
        };

        existingResult.winAmount += pot.amount;
        results.set(lastBettor.id, existingResult);
        return;
      }

      // Let pokersolver compare hands to get winners
      const solvedHands = players
        .filter(p => pot.eligiblePlayers.includes(p.id) && !p.isFolded)
        .map(p => {
          let handInfo = playerHands.get(p.id);
          if (!handInfo) {
            handInfo = this.evaluateHand(p.holeCards, communityCards);
            playerHands.set(p.id, handInfo);
          }
          // Associate player id with the hand for winner determination
          (handInfo.hand as any).playerId = p.id;
          return handInfo.hand;
        });

      const winningHands = pokersolver.winners(solvedHands);
      this.log(`Found ${winningHands.length} winners with hand type ${winningHands[0].name}`);
      
      // Calculate base amount and remainder
      const winAmount = Math.floor(pot.amount / winningHands.length);
      const remainder = pot.amount - (winAmount * winningHands.length);
      this.log(`Splitting pot ${pot.amount} among ${winningHands.length} winners. Each gets ${winAmount} + ${remainder} remainder`);

      // Award pot to winners
      winningHands.forEach((winningHand: any, idx: number) => {
        const playerId = winningHand.playerId;
        const handInfo = playerHands.get(playerId)!;
        this.log(`Processing winner ${playerId} with ${winningHand.descr}`);
        
        let existingResult = results.get(playerId);
        if (!existingResult) {
          existingResult = {
            playerId,
            hand: handInfo.cards,
            description: winningHand.name,
            strength: winningHand.rank,
            winAmount: 0
          };
          results.set(playerId, existingResult);
        }

        // First winner gets any remainder chips
        const extraChips = idx === 0 ? remainder : 0;
        existingResult.winAmount += winAmount + extraChips;
        results.set(playerId, existingResult);
      });
    });

    return Array.from(results.values());
  }
}
