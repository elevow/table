/**
 * Pot Odds Calculator
 * 
 * Calculates the ratio between the size of the total pot and the size of the bet
 * a player is facing. This helps players make informed decisions about calling bets.
 */

/**
 * Calculate pot odds as a ratio string (e.g., "3:1")
 * 
 * @param potSize - The total size of the pot
 * @param betToCall - The amount the player needs to call
 * @returns A formatted ratio string (e.g., "3:1") or null if invalid inputs
 */
export function calculatePotOdds(potSize: number, betToCall: number): string | null {
  // Validate inputs
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
 * @param potSize - The total size of the pot
 * @param betToCall - The amount the player needs to call
 * @returns The percentage of the pot the bet represents, or null if invalid inputs
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
