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

  /**
   * Build the main pot and side pots from what each player put in over the whole hand.
   * Each pot layer can be won only by non-folded players who paid into that layer.
   * Chips from a layer no remaining player reached (a folded player's excess) join the
   * pot below it, so no chips are left without an eligible winner.
   */
  static calculatePotsFromContributions(
    players: Array<{ id: string; contributed: number; isFolded: boolean }>
  ): SidePot[] {
    const levels = Array.from(new Set(players.map(p => p.contributed).filter(c => c > 0))).sort((a, b) => a - b);
    const pots: SidePot[] = [];
    let previousLevel = 0;
    for (const level of levels) {
      const amount = players.reduce(
        (sum, p) => sum + Math.max(0, Math.min(p.contributed, level) - previousLevel),
        0
      );
      const eligiblePlayers = players.filter(p => !p.isFolded && p.contributed >= level).map(p => p.id);
      previousLevel = level;
      if (amount <= 0) continue;
      const last = pots[pots.length - 1];
      if (eligiblePlayers.length === 0 && last) {
        last.amount += amount;
      } else if (last && last.eligiblePlayers.length === 0) {
        // A lower layer had no eligible player; fold it into this one
        last.amount += amount;
        last.eligiblePlayers = eligiblePlayers;
      } else {
        pots.push({ amount, eligiblePlayers });
      }
    }
    return pots;
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
