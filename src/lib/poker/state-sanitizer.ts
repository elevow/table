/**
 * Sanitizes game state for client consumption.
 * 
 * Hides other players' holeCards unless:
 * 1. The game is at showdown stage
 * 2. All active (non-folded) players are all-in (all-in situation)
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
  
  // Partial all-in situation: only one non-all-in player remaining and they've matched the bet
  // This means betting is effectively over - no more betting action is possible
  if (nonAllInCount === 1 && nonAllInPlayer) {
    const currentBet = state.currentBet || 0;
    // Using >= because the player may have over-called or there could be side pot situations
    // where their bet exceeds the current main pot bet level
    return nonAllInPlayer.currentBet >= currentBet;
  }
  
  return false;
}

/**
 * Determines whether hole cards should be revealed to all players.
 * Cards are revealed during:
 * 1. Showdown stage
 * 2. All-in situations
 */
export function shouldRevealHoleCards(state: TableState): boolean {
  // Always reveal at showdown
  if (state.stage === 'showdown') return true;
  
  // Reveal during all-in situations
  return isAllInSituation(state);
}

/**
 * Sanitizes a single player's data for client consumption.
 * Hides holeCards if they should not be revealed to the viewing player.
 */
function sanitizePlayer(
  player: Player,
  viewerId: string,
  revealAllCards: boolean
): Player {
  // Always show own cards
  if (player.id === viewerId) {
    return player;
  }
  
  // Show cards if we should reveal all (showdown or all-in)
  if (revealAllCards) {
    return player;
  }
  
  // Hide other players' hole cards by setting to undefined (matches the optional type)
  // Using object destructuring to create a new object without copying holeCards
  const { holeCards: _hidden, ...playerWithoutCards } = player;
  return playerWithoutCards as Player;
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
  const revealAllCards = shouldRevealHoleCards(state);
  
  const sanitizedPlayers = state.players.map(player => 
    sanitizePlayer(player, viewerId, revealAllCards)
  );
  
  // Also handle stud variant state if present
  // Note: When revealAllCards is true (showdown or all-in), we skip this block and 
  // the original studState with all cards is preserved
  let sanitizedStudState = state.studState;
  if (state.studState && !revealAllCards) {
    const sanitizedPlayerCards: Record<string, { downCards: Card[]; upCards: Card[] }> = {};
    
    for (const [playerId, cards] of Object.entries(state.studState.playerCards)) {
      if (playerId === viewerId) {
        // Show all own cards
        sanitizedPlayerCards[playerId] = cards;
      } else {
        // For other players during active play (not showdown/all-in):
        // - Hide down cards (face-down, private to the player)
        // - Show up cards (face-up, visible to everyone at the table)
        sanitizedPlayerCards[playerId] = {
          downCards: [], // Hide down cards
          upCards: cards.upCards // Up cards are public in stud variants
        };
      }
    }
    
    sanitizedStudState = {
      ...state.studState,
      playerCards: sanitizedPlayerCards
    };
  }
  
  return {
    ...state,
    players: sanitizedPlayers,
    studState: sanitizedStudState
  };
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
