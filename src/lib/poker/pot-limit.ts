export interface PotLimitCalc {
  currentPot: number;
  pendingBets: number;
  pendingCalls: number; // includes the acting player's call when there is a live bet
  maxBet: number; // maximum total bet (i.e., final player.currentBet) allowed this action
}

export class PotLimitCalculator {
  /**
   * Calculate pot-limit maximum total bet for a player.
   * In this engine, the pot already contains previous contributions.
   * Max raise size equals (pot + your call). Max total bet = currentBet + maxRaise.
   */
  static calculateMaxBet(
    currentPot: number,
    tableCurrentBet: number,
    players: Array<{ currentBet: number; isFolded: boolean; isAllIn: boolean }>,
    actingPlayerCurrentBet: number
  ): PotLimitCalc {
    // Sum of required calls for all eligible players (including the actor)
    const pendingCalls = players.reduce((sum, p) => {
      if (p.isFolded || p.isAllIn) return sum;
      const need = Math.max(0, tableCurrentBet - p.currentBet);
      return sum + need;
    }, 0);

    // pendingBets are already in currentPot per engine design
    const pendingBets = 0;

    if (tableCurrentBet <= 0) {
      // No prior bet: max total bet equals pot size
      const maxBet = currentPot;
      return { currentPot, pendingBets, pendingCalls: 0, maxBet };
    }

    // With a live bet, max raise equals pot + all pending calls (including actor)
    const maxRaise = currentPot + pendingCalls;
    const maxBet = tableCurrentBet + maxRaise;
    return { currentPot, pendingBets, pendingCalls, maxBet };
  }
}
