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
    // Calculate total pot from all bets
    const totalPot = players.reduce((sum, p) => sum + p.currentBet, 0);
    
    // If no bets, return empty array
    if (totalPot === 0) return [];
    
    // For fold case, create a single pot with all bets
    const nonFoldedPlayers = players.filter(p => !p.isFolded);
    if (nonFoldedPlayers.length === 1) {
      return [{
        amount: totalPot,
        eligiblePlayers: nonFoldedPlayers.map(p => p.id)
      }];
    }

    // Get all unique bet amounts in ascending order
    const bettingPlayers = players.filter(p => p.currentBet > 0);
    const bets = bettingPlayers.map(p => p.currentBet);
    const uniqueBets = Array.from(new Set(bets));
    uniqueBets.sort((a, b) => a - b);

    // Handle case with single pot - all bets form a single pot
    if (uniqueBets.length === 1) {
      return [{
        amount: bettingPlayers.reduce((sum, p) => sum + p.currentBet, 0),
        eligiblePlayers: bettingPlayers.filter(p => !p.isFolded).map(p => p.id)
      }];
    }

    // Calculate side pots
    const sidePots: SidePot[] = [];
    let processedBets: number[] = new Array(players.length).fill(0);
    
    // Handle each bet level
    uniqueBets.forEach(currentBet => {
      const playersAtLevel = bettingPlayers.filter(p => p.currentBet >= currentBet);
      let potAmount = 0;
      
      // Calculate pot by taking amount between current and previous level for each player
      players.forEach((p, i) => {
        const contribution = Math.min(p.currentBet, currentBet) - processedBets[i];
        if (contribution > 0) {
          potAmount += contribution;
          processedBets[i] += contribution;
        }
      });
      
      const eligiblePlayers = playersAtLevel.filter(p => !p.isFolded).map(p => p.id);

      if (potAmount > 0) {
        sidePots.push({
          amount: potAmount,
          eligiblePlayers
        });
      }
    });

    return sidePots;
  }

  static distributePots(
    sidePots: SidePot[], 
    winners: { playerId: string; winAmount: number; strength?: number }[]
  ): void {
    // Initialize winAmount for all winners
    winners.forEach(winner => {
      winner.winAmount = 0;
    });

    // Distribute each pot
    sidePots.forEach(pot => {
      const eligibleWinners = winners.filter(w => 
        pot.eligiblePlayers.includes(w.playerId)
      );

      if (eligibleWinners.length > 0) {
        // If hand strengths are provided, only highest strength wins the pot
        if (eligibleWinners.some(w => w.strength !== undefined)) {
          const winningStrength = Math.max(...eligibleWinners.map(w => w.strength || 0));
          const equalWinners = eligibleWinners.filter(w => w.strength === winningStrength);
          
          // Split pot evenly
          const winAmount = Math.floor(pot.amount / equalWinners.length);
          const remainder = pot.amount % equalWinners.length;
          equalWinners.forEach((w, i) => {
            const winner = winners.find(winner => winner.playerId === w.playerId);
            if (winner) {
              winner.winAmount += winAmount + (i < remainder ? 1 : 0);
            }
          });
        } else {
          // Without strengths, split pot evenly among eligible winners
          const winAmount = Math.floor(pot.amount / eligibleWinners.length);
          const remainder = pot.amount % eligibleWinners.length;
          eligibleWinners.forEach((w, i) => {
            const winner = winners.find(winner => winner.playerId === w.playerId);
            if (winner) {
              winner.winAmount += winAmount + (i < remainder ? 1 : 0);
            }
          });
        }
      }
    });
  }
}
