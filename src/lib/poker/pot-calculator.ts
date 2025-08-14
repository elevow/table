interface PlayerPot {
  id: string;
  stack: number;
  currentBet: number;
  isFolded: boolean;
}

export interface SidePot {
  amount: number;
  eligiblePlayers: string[];
}

export class PotCalculator {
  static calculateSidePots(players: PlayerPot[]): SidePot[] {
    // First handle the simple case with no bets
    const bettingPlayers = players.filter(p => p.currentBet > 0);
    if (bettingPlayers.length === 0) return [];

    // Get all unique bet amounts in ascending order
    const bets = bettingPlayers.map(p => p.currentBet);
    const uniqueBets = Array.from(new Set(bets));
    uniqueBets.sort((a, b) => a - b);

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

      // Calculate pot amount
      const amount = (currentBet - previousBet) * eligiblePlayers.length;

      if (amount > 0) {
        sidePots.push({
          amount,
          eligiblePlayers
        });
      }

      previousBet = currentBet;
    });

    return sidePots;
  }

  static distributePots(
    sidePots: SidePot[], 
    winners: { playerId: string; winAmount: number }[]
  ): void {
    sidePots.forEach(pot => {
      const eligibleWinners = winners.filter(w => 
        pot.eligiblePlayers.includes(w.playerId)
      );

      if (eligibleWinners.length > 0) {
        const winAmount = Math.floor(pot.amount / eligibleWinners.length);
        eligibleWinners.forEach(winner => {
          winner.winAmount += winAmount;
        });
      }
    });
  }
}
