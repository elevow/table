/**
 * Pre-actions: a decision a player queues before their turn, carried out the moment the turn
 * arrives. Each applies to the current betting round only.
 */
export type PreAction =
  | { type: 'check-fold' }
  // Check only if nobody bets; cancelled by a bet
  | { type: 'check' }
  // Call exactly this amount; cancelled if the amount to call changes
  | { type: 'call'; amount: number }
  // Call whatever it costs (or check if nothing is owed)
  | { type: 'call-any' };

export type PreActionResult =
  | { action: 'check' }
  | { action: 'fold' }
  | { action: 'call'; amount: number }
  // The situation changed in a way the player did not agree to; let them decide
  | { action: 'cancel' };

/** What a queued pre-action does once it is the player's turn and they owe `owed` to call. */
export function resolvePreAction(pre: PreAction, owed: number): PreActionResult {
  switch (pre.type) {
    case 'check-fold':
      return owed > 0 ? { action: 'fold' } : { action: 'check' };
    case 'check':
      return owed > 0 ? { action: 'cancel' } : { action: 'check' };
    case 'call':
      if (owed === 0) return { action: 'check' };
      return owed === pre.amount ? { action: 'call', amount: owed } : { action: 'cancel' };
    case 'call-any':
      return owed > 0 ? { action: 'call', amount: owed } : { action: 'check' };
  }
}
