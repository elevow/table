import type { TableState, Card, Player } from '../../types/poker';
import { HandEvaluator } from '../poker/hand-evaluator';
import type { HandInterface } from '../../types/poker-engine';

/**
 * System sender ID used for hand result messages
 */
export const SYSTEM_SENDER_ID = 'system';

/**
 * Represents a winner in a hand result
 */
export interface HandWinner {
  playerId: string;
  playerName: string;
  amount: number;
  handDescription?: string;
}

/**
 * Result of formatting a hand result for chat
 */
export interface FormattedHandResult {
  message: string;
  winners: HandWinner[];
  isWinByFold: boolean;
}

/**
 * Result of evaluating a player's hand
 */
interface PlayerHandEvaluation {
  player: Player;
  hand: HandInterface;
  label: string;
}

/**
 * Checks if the variant is a Hi-Lo variant
 */
function isHiLoVariant(variant?: string): boolean {
  return variant === 'omaha-hi-lo' || variant === 'seven-card-stud-hi-lo';
}

/**
 * Checks if the variant is an Omaha variant
 */
function isOmahaVariant(variant?: string): boolean {
  return variant === 'omaha' || variant === 'omaha-hi-lo';
}

/**
 * Formats a card for display (e.g., "A♠")
 */
function formatCard(card: Card): string {
  const suitSymbols: Record<Card['suit'], string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠',
  };
  return `${card.rank}${suitSymbols[card.suit]}`;
}

/**
 * Gets the player name, falling back to a short ID if not available
 */
function getPlayerName(player: Player): string {
  return player.name || `Player ${player.id.slice(0, 6)}`;
}

/**
 * Evaluates and returns the hand description for a player
 */
function getHandDescription(
  player: Player,
  communityCards: Card[],
  variant?: string
): string {
  try {
    const holeCards = player.holeCards || [];
    
    if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
      // For stud variants, we'd need studState which isn't passed here
      // Return empty - caller should handle stud separately
      return '';
    }
    
    if (isOmahaVariant(variant)) {
      if (holeCards.length >= 4 && communityCards.length >= 3) {
        const ranking = HandEvaluator.getOmahaHandRanking(holeCards, communityCards);
        return ranking.name || '';
      }
      return '';
    }
    
    // Texas Hold'em or default
    if (holeCards.length >= 2 && communityCards.length >= 3) {
      const ranking = HandEvaluator.getHandRanking(holeCards, communityCards);
      return ranking.name || '';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Formats a hand result from the game state into a chat-friendly message
 */
export function formatHandResult(state: TableState): FormattedHandResult | null {
  // Only format if we're at showdown
  if (state.stage !== 'showdown') {
    return null;
  }

  const players = state.players || [];
  const communityCards = state.communityCards || [];
  const variant = state.variant;
  
  // Find non-folded players
  const activePlayers = players.filter(p => !p.isFolded);
  
  // Win by fold: only one player remains
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    const winnerName = getPlayerName(winner);
    
    return {
      message: `🏆 ${winnerName} wins the pot (all others folded)`,
      winners: [{
        playerId: winner.id,
        playerName: winnerName,
        amount: 0, // Pot amount not easily accessible here
        handDescription: undefined,
      }],
      isWinByFold: true,
    };
  }

  // Handle Hi-Lo variants with split pots
  if (isHiLoVariant(variant) && state.lastHiLoResult) {
    const highWinners = state.lastHiLoResult.high || [];
    const lowWinners = state.lastHiLoResult.low || [];
    
    const formatWinners = (winners: Array<{ playerId: string; amount: number }>, label: string): string => {
      if (winners.length === 0) return '';
      const names = winners.map(w => {
        const player = players.find(p => p.id === w.playerId);
        return player ? getPlayerName(player) : w.playerId.slice(0, 6);
      });
      const amounts = winners.map(w => `$${w.amount}`).join(', ');
      if (winners.length === 1) {
        return `${label}: ${names[0]} wins ${amounts}`;
      }
      return `${label}: ${names.join(', ')} split (${amounts})`;
    };

    const highPart = formatWinners(highWinners, 'High');
    const lowPart = lowWinners.length > 0 ? formatWinners(lowWinners, 'Low') : 'Low: No qualifying hand';
    
    const allWinners: HandWinner[] = [
      ...highWinners.map(w => {
        const player = players.find(p => p.id === w.playerId);
        return {
          playerId: w.playerId,
          playerName: player ? getPlayerName(player) : w.playerId.slice(0, 6),
          amount: w.amount,
          handDescription: 'High',
        };
      }),
      ...lowWinners.map(w => {
        const player = players.find(p => p.id === w.playerId);
        return {
          playerId: w.playerId,
          playerName: player ? getPlayerName(player) : w.playerId.slice(0, 6),
          amount: w.amount,
          handDescription: 'Low',
        };
      }),
    ];

    return {
      message: `🏆 ${highPart} | ${lowPart}`,
      winners: allWinners,
      isWinByFold: false,
    };
  }

  // Handle Run It Twice results
  if (state.runItTwice?.enabled && state.runItTwice.results?.length > 0) {
    const results = state.runItTwice.results;
    const distribution = state.runItTwice.potDistribution || [];
    
    const winnerSummaries = distribution.map(pd => {
      const player = players.find(p => p.id === pd.playerId);
      const name = player ? getPlayerName(player) : pd.playerId.slice(0, 6);
      return `${name} ($${pd.amount})`;
    });

    const allWinners: HandWinner[] = distribution.map(pd => {
      const player = players.find(p => p.id === pd.playerId);
      return {
        playerId: pd.playerId,
        playerName: player ? getPlayerName(player) : pd.playerId.slice(0, 6),
        amount: pd.amount,
        handDescription: 'Run It Twice',
      };
    });

    return {
      message: `🏆 Run It Twice (${results.length} boards): ${winnerSummaries.join(', ')}`,
      winners: allWinners,
      isWinByFold: false,
    };
  }

  // Standard showdown: evaluate hands and determine winners
  try {
    // Evaluate all active players' hands
    const evaluations: PlayerHandEvaluation[] = [];
    
    for (const player of activePlayers) {
      const holeCards = player.holeCards || [];
      
      if (isOmahaVariant(variant)) {
        if (holeCards.length >= 4 && communityCards.length >= 3) {
          const { hand } = HandEvaluator.evaluateOmahaHand(holeCards, communityCards);
          const ranking = HandEvaluator.getOmahaHandRanking(holeCards, communityCards);
          evaluations.push({ player, hand, label: ranking.name || '' });
        }
      } else {
        // Texas Hold'em or default
        if (holeCards.length >= 2) {
          const { hand } = HandEvaluator.evaluateHand(holeCards, communityCards);
          const ranking = HandEvaluator.getHandRanking(holeCards, communityCards);
          evaluations.push({ player, hand, label: ranking.name || '' });
        }
      }
    }

    if (evaluations.length === 0) {
      return null;
    }

    // Find the best hand(s)
    let bestEvals: PlayerHandEvaluation[] = [evaluations[0]];
    for (let i = 1; i < evaluations.length; i++) {
      const cmp = HandEvaluator.compareHands(evaluations[i].hand, bestEvals[0].hand);
      if (cmp > 0) {
        bestEvals = [evaluations[i]];
      } else if (cmp === 0) {
        bestEvals.push(evaluations[i]);
      }
    }

    const winners: HandWinner[] = bestEvals.map(e => ({
      playerId: e.player.id,
      playerName: getPlayerName(e.player),
      amount: 0,
      handDescription: e.label,
    }));

    if (bestEvals.length === 1) {
      const winner = bestEvals[0];
      const handDesc = winner.label ? ` with ${winner.label}` : '';
      return {
        message: `🏆 ${getPlayerName(winner.player)} wins${handDesc}`,
        winners,
        isWinByFold: false,
      };
    }

    // Split pot
    const winnerNames = bestEvals.map(e => getPlayerName(e.player)).join(', ');
    const handDesc = bestEvals[0].label ? ` with ${bestEvals[0].label}` : '';
    return {
      message: `🏆 ${winnerNames} split the pot${handDesc}`,
      winners,
      isWinByFold: false,
    };
  } catch (e) {
    // Fallback if evaluation fails
    return {
      message: '🏆 Hand complete',
      winners: [],
      isWinByFold: false,
    };
  }
}
