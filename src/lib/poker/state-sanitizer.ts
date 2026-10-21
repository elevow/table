/**
 * Sanitizes game state for client consumption.
 * 
 * Hides other players' holeCards (and stud down cards) unless the player is still in the hand and:
 * 1. The hand reached a contested showdown, or
 * 2. All active (non-folded) players are all-in (all-in situation)
 * Folded cards, and the cards of a player who won because everyone else folded, are never shown.
 */

import { TableState, Player, Card } from '../../types/poker';

/**
 * Checks if the game is in an all-in situation where all active players are all-in.
 * In an all-in situation, hole cards should be revealed to all players.
 */
export function isAllInSituation(state: TableState): boolean {
  // Single pass through players to calculate all needed values
  let activeCount = 0;
  let allInCount = 0;
  let nonAllInPlayer: Player | null = null;
  let nonAllInCount = 0;
  
  for (const player of state.players) {
    if (!player.isFolded) {
      activeCount++;
      if (player.isAllIn) {
        allInCount++;
      } else {
        nonAllInCount++;
        nonAllInPlayer = player;
      }
    }
  }
  
  // Need at least 2 active players for an all-in situation
  if (activeCount < 2) return false;
  
  // Need at least one all-in player
  if (allInCount === 0) return false;
  
  // True all-in situation: all active players are all-in
  if (nonAllInCount === 0) return true;
  
  // Partial all-in situation: only one non-all-in player remaining and they've matched the bet.
  // In poker, when all opponents are all-in, the remaining player cannot make meaningful bets
  // (since no one can call/raise), so betting is effectively complete and cards are revealed.
  if (nonAllInCount === 1 && nonAllInPlayer) {
    const currentBet = state.currentBet || 0;
    // The player has called or raised to match/exceed the current bet,
    // meaning betting action is complete for this round (side pot situations may result in their bet exceeding the main pot bet level)
    return nonAllInPlayer.currentBet >= currentBet;
  }
  
  return false;
}

/**
 * Determines whether hole cards should be revealed to all players.
 * Cards are revealed during:
 * 1. A contested showdown (two or more players still in the hand). A hand won because
 *    everyone else folded ends at the 'showdown' stage too, but the winner never shows.
 * 2. All-in situations
 * Even then, only players still in the hand are revealed; folded cards stay hidden.
 */
export function shouldRevealHoleCards(state: TableState): boolean {
  if (state.stage === 'showdown') {
    return state.players.filter(p => !p.isFolded).length >= 2;
  }

  // Reveal during all-in situations
  return isAllInSituation(state);
}

/**
 * Whether one player's private cards may be shown to the viewer (null viewer = public broadcast).
 */
function canSeePrivateCards(playerId: string, viewerId: string | null, revealedIds: Set<string>): boolean {
  return playerId === viewerId || revealedIds.has(playerId);
}

/**
 * Players whose cards are face up for the whole table: everyone still in the hand
 * when cards are revealed, nobody otherwise.
 */
function revealedPlayerIds(state: TableState): Set<string> {
  if (!shouldRevealHoleCards(state)) return new Set();
  return new Set(state.players.filter(p => !p.isFolded).map(p => p.id));
}

/**
 * Run It Twice seeds decide the run boards (the shuffle is deterministic from them), so they and
 * the values they can be rebuilt from are withheld until showdown. The public seed is a commitment
 * and is safe to send early; the generation entropy is never sent.
 */
function sanitizeRunItTwice(state: TableState): TableState['runItTwice'] {
  const rit = state.runItTwice;
  if (!rit) return rit;
  const atShowdown = state.stage === 'showdown';
  const rng = rit.rngSecurity;
  return {
    ...rit,
    seeds: atShowdown ? rit.seeds : [],
    rngSecurity: rng
      ? {
          seedGeneration: { ...rng.seedGeneration, entropy: undefined },
          verification: atShowdown
            ? rng.verification
            : { publicSeed: rng.verification.publicSeed, hashChain: [], proof: '' },
        }
      : undefined,
  };
}

/**
 * Builds the view of the state that viewerId may see; a null viewer gets the public view.
 */
function sanitizeState(state: TableState, viewerId: string | null): TableState {
  const revealedIds = revealedPlayerIds(state);

  const sanitizedPlayers = state.players.map(player => {
    if (canSeePrivateCards(player.id, viewerId, revealedIds)) return player;
    const { holeCards: _, ...playerWithoutCards } = player;
    return { ...playerWithoutCards, holeCards: undefined };
  });

  // Stud: down cards are private; up cards are face up for everyone at the table
  let sanitizedStudState = state.studState;
  if (state.studState) {
    const sanitizedPlayerCards: Record<string, { downCards: Card[]; upCards: Card[] }> = {};
    for (const [playerId, cards] of Object.entries(state.studState.playerCards)) {
      sanitizedPlayerCards[playerId] = canSeePrivateCards(playerId, viewerId, revealedIds)
        ? cards
        : { downCards: [], upCards: cards.upCards };
    }
    sanitizedStudState = {
      ...state.studState,
      playerCards: sanitizedPlayerCards
    };
  }

  const result: TableState = {
    ...state,
    players: sanitizedPlayers,
    studState: sanitizedStudState
  };
  if (state.runItTwice) {
    result.runItTwice = sanitizeRunItTwice(state);
  }
  return result;
}

/**
 * Sanitizes the game state for a specific viewing player.
 *
 * @param state - The full game state
 * @param viewerId - The ID of the player viewing this state
 * @returns A sanitized state where other players' hole cards are hidden when appropriate
 */
export function sanitizeStateForPlayer(
  state: TableState,
  viewerId: string
): TableState {
  return sanitizeState(state, viewerId);
}

/**
 * Sanitizes game state for broadcasting to all players.
 * Returns a map of player IDs to their sanitized view of the state.
 *
 * @param state - The full game state
 * @returns A map from player ID to their sanitized view
 */
export function sanitizeStateForAllPlayers(
  state: TableState
): Map<string, TableState> {
  const result = new Map<string, TableState>();

  for (const player of state.players) {
    result.set(player.id, sanitizeStateForPlayer(state, player.id));
  }

  return result;
}

/**
 * Sanitizes game state for public broadcast where no specific viewer is known.
 * Hides all hole cards except those face up for the table (contested showdown or all-in).
 *
 * This is used for Supabase broadcasts where we can't send per-player data.
 * Each player's own cards will be visible from their API responses.
 *
 * @param state - The full game state
 * @returns A sanitized state that is safe for anyone at (or watching) the table
 */
export function sanitizeStateForBroadcast(state: TableState): TableState {
  return sanitizeState(state, null);
}
