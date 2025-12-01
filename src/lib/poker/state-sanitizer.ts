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
  const activePlayers = state.players.filter(p => !p.isFolded);
  if (activePlayers.length < 2) return false;
  
  // All active players must be all-in for this to be an all-in situation
  // OR only one player is not all-in and betting is effectively closed (they've matched the bet)
  const allInCount = activePlayers.filter(p => p.isAllIn).length;
  const nonAllInPlayers = activePlayers.filter(p => !p.isAllIn);
  
  if (allInCount === 0) return false;
  
  // True all-in situation: all active players are all-in
  if (nonAllInPlayers.length === 0) return true;
  
  // Partial all-in situation: only one non-all-in player remaining and they've matched the bet
  // This means betting is effectively over
  if (nonAllInPlayers.length === 1) {
    const currentBet = state.currentBet || 0;
    const player = nonAllInPlayers[0];
    // Player has matched the current bet (or there's no more betting action possible)
    return player.currentBet >= currentBet;
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
  
  // Hide other players' hole cards
  return {
    ...player,
    holeCards: undefined
  };
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
  let sanitizedStudState = state.studState;
  if (state.studState && !revealAllCards) {
    const sanitizedPlayerCards: Record<string, { downCards: Card[]; upCards: Card[] }> = {};
    
    for (const [playerId, cards] of Object.entries(state.studState.playerCards)) {
      if (playerId === viewerId) {
        // Show all own cards
        sanitizedPlayerCards[playerId] = cards;
      } else {
        // For other players, hide down cards but show up cards (public in stud)
        sanitizedPlayerCards[playerId] = {
          downCards: [], // Hide down cards
          upCards: cards.upCards // Up cards are always visible
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
