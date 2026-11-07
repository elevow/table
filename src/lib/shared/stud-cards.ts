/**
 * Stud cards in the order they were dealt: the opening down cards, the up cards, then the final
 * down card on seventh street. Five-card stud has one down card, so it just leads the up cards.
 */
export function studCardOrder<T>(down: T[], up: T[]): T[] {
  return [...down.slice(0, 2), ...up, ...down.slice(2)];
}
