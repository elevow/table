import type { TableState } from '../../types/poker';

/**
 * Returns the ID of the player who picks the variant in a Dealer's Choice game:
 * the player after the current dealer button. The start and next-hand routes
 * announce this player, and the client shows them the variant picker.
 */
export function getDealerChoiceChooserId(
  state: Pick<TableState, 'players' | 'dealerPosition'> | null | undefined
): string | undefined {
  const players = state && Array.isArray(state.players) ? state.players : [];
  if (players.length === 0) return undefined;
  const rawDealerIdx = typeof state?.dealerPosition === 'number' ? state.dealerPosition : 0;
  const chooserIdx = (rawDealerIdx + 1) % players.length;
  const id = players[chooserIdx]?.id;
  return id ? String(id) : undefined;
}
