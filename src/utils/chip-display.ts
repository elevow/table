/**
 * Utility functions for displaying chips and stack sizes
 */

/**
 * Format a chip amount as Big Blinds
 * @param chips The chip amount to format
 * @param bigBlind The big blind value
 * @param decimals Number of decimal places to show (default: 1)
 * @returns Formatted string like "100.0 BB" or "12.5 BB"
 */
export function formatChipsAsBB(chips: number, bigBlind: number, decimals: number = 1): string {
  if (bigBlind <= 0) {
    // If big blind is invalid, fall back to showing chips
    return chips.toLocaleString();
  }
  
  const bb = chips / bigBlind;
  return `${bb.toFixed(decimals)} BB`;
}

/**
 * Format a chip amount based on display preference
 * @param chips The chip amount to format
 * @param bigBlind The big blind value (required if showAsBB is true)
 * @param showAsBB Whether to show as Big Blinds
 * @returns Formatted string
 */
export function formatChips(chips: number, bigBlind: number | null, showAsBB: boolean): string {
  if (showAsBB && bigBlind !== null && bigBlind > 0) {
    return formatChipsAsBB(chips, bigBlind);
  }
  return chips.toLocaleString();
}
