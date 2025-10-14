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
   * Note: Do NOT include other players' pending calls in the cap; only the acting player's call is used.
   */
  static calculateMaxBet(
    currentPot: number,
    tableCurrentBet: number,
    players: Array<{ currentBet: number; isFolded: boolean; isAllIn: boolean }>,
    actingPlayerCurrentBet: number
  ): PotLimitCalc {
    // In pot-limit, the cap considers only the acting player's call amount
    const actorCall = Math.max(0, tableCurrentBet - actingPlayerCurrentBet);

    // pendingBets are already in currentPot per engine design
    const pendingBets = 0;

    if (tableCurrentBet <= 0) {
      // No prior bet: max total bet equals pot size
      const maxBet = currentPot;
      return { currentPot, pendingBets, pendingCalls: 0, maxBet };
    }

    // With a live bet, max raise equals pot + the actor's call amount
    const maxRaise = currentPot + actorCall;
    const maxBet = tableCurrentBet + maxRaise;
    return { currentPot, pendingBets, pendingCalls: actorCall, maxBet };
  }
}
