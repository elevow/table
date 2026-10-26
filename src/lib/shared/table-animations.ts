/**
 * Which chip movements to animate between two game states: chips going from a seat into the
 * pot when someone puts money in, and from the pot to each winner when the hand is settled.
 * Animations only react to states that already happened; they never hold up the game.
 */

/** The pot, as the start or end of a chip movement. */
export const POT = 'pot';

export interface ChipMove {
  /** Stable per movement, so the same state arriving twice doesn't animate twice. */
  id: string;
  from: string;
  to: string;
  amount: number;
}

export interface ChipSnapshot {
  handKey: string | null;
  actions: Array<{ playerId: string; put: number }>;
  result: Record<string, number> | null;
}

export function chipSnapshot(state: any): ChipSnapshot | null {
  if (!state || typeof state !== 'object') return null;
  const actions = Array.isArray(state.handActions) ? state.handActions : [];
  const winnings = state.handResult?.winnings;
  return {
    handKey: state.handId ? String(state.handId) : (state.handNumber != null ? `#${state.handNumber}` : null),
    actions: actions.map((a: any) => ({ playerId: String(a?.playerId || ''), put: Number(a?.put || 0) })),
    result: winnings && typeof winnings === 'object' ? winnings : null,
  };
}

export function diffChipMoves(prev: ChipSnapshot | null, next: ChipSnapshot): ChipMove[] {
  // Nothing to animate on first load: those chips moved before we were watching
  if (!prev) return [];
  const sameHand = prev.handKey !== null || next.handKey !== null
    ? prev.handKey === next.handKey
    : next.actions.length >= prev.actions.length;
  const hand = next.handKey ?? 'hand';
  const moves: ChipMove[] = [];

  const start = sameHand ? prev.actions.length : 0;
  next.actions.forEach((action, index) => {
    if (index < start || action.put <= 0 || !action.playerId) return;
    moves.push({ id: `${hand}:bet:${index}`, from: action.playerId, to: POT, amount: action.put });
  });

  if (next.result && (!sameHand || !prev.result)) {
    for (const [playerId, amount] of Object.entries(next.result)) {
      if (Number(amount) > 0) moves.push({ id: `${hand}:win:${playerId}`, from: POT, to: playerId, amount: Number(amount) });
    }
  }
  return moves;
}
