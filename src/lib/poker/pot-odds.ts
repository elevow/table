/**
 * Pot Odds Calculator
 * 
 * Calculates the ratio between the size of the total pot and the size of the bet
 * a player is facing. This helps players make informed decisions about calling bets.
 */

/**
 * Calculate pot odds as a ratio string (e.g., "3:1")
 * 
 * This calculates the pot-to-bet ratio, representing the odds being offered by the pot.
 * For example, "3.0:1" means you're getting 3-to-1 on your money.
 * 
 * Note: A pot size of 0 will return "0.0:1", representing a situation where
 * there is no pot (e.g., first action preflop). This is intentionally allowed.
 * 
 * @param potSize - The total size of the pot (can be 0)
 * @param betToCall - The amount the player needs to call (must be > 0)
 * @returns A formatted ratio string (e.g., "3:1") or null if invalid inputs
 */
export function calculatePotOdds(potSize: number, betToCall: number): string | null {
  // Validate inputs - pot can be 0, but bet must be positive
  if (betToCall <= 0 || potSize < 0) {
    return null;
  }

  // Calculate the ratio: pot size : bet to call
  const ratio = potSize / betToCall;
  
  // Format as X:1 (e.g., "3.0:1" means getting 3-to-1 on your money)
  return `${ratio.toFixed(1)}:1`;
}

/**
 * Calculate pot odds as a percentage
 * 
 * This calculates the equity percentage needed to break even on a call.
 * Formula: bet / (pot + bet) * 100
 * 
 * @param potSize - The total size of the pot
 * @param betToCall - The amount the player needs to call
 * @returns The percentage of equity needed to break even, or null if invalid inputs
 */
export function calculatePotOddsPercentage(potSize: number, betToCall: number): number | null {
  // Validate inputs
  if (betToCall <= 0 || potSize < 0) {
    return null;
  }

  // Calculate percentage: bet / (pot + bet) * 100
  // This represents the equity needed to break even
  const totalAfterCall = potSize + betToCall;
  const percentage = (betToCall / totalAfterCall) * 100;
  
  return Math.round(percentage * 10) / 10; // Round to 1 decimal place
}

/**
 * Get a formatted pot odds display string with both ratio and percentage
 * 
 * @param potSize - The total size of the pot
 * @param betToCall - The amount the player needs to call
 * @returns A formatted string with pot odds information
 */
export function formatPotOdds(potSize: number, betToCall: number): string | null {
  const ratio = calculatePotOdds(potSize, betToCall);
  const percentage = calculatePotOddsPercentage(potSize, betToCall);
  
  if (!ratio || percentage === null) {
    return null;
  }
  
  return `${ratio} (${percentage}%)`;
}
