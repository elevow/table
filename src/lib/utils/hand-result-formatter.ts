import type { TableState, Card, Player } from '../../types/poker';
import { HandEvaluator } from '../poker/hand-evaluator';
import type { HandInterface } from '../../types/poker-engine';
import { isOmahaVariant as isOmahaGame, isStudVariant } from '../poker/variant-rules';
import { evaluateWildHigh, evaluateWildOmaha, evaluateWildRazz, tableWildMatcher } from '../poker/wild-hands';
import { describeNicaraguaHand } from '../poker/nicaragua';

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
  // Set on wild tables, where hands compare by score
  wildScore?: number;
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
  return isOmahaGame(variant);
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
    
    if (isStudVariant(variant)) {
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
 * The 7-2 bounty paid this hand, as a chat line, or null when none was paid.
 */
export function formatSevenDeuceBounty(state: TableState): string | null {
  const bounty = state.sevenDeuceResult;
  if (!bounty || !(bounty.total > 0)) return null;
  const winner = (state.players || []).find(p => p.id === bounty.playerId);
  const name = winner ? getPlayerName(winner) : bounty.playerId.slice(0, 6);
  return `💰 7-2 bounty: ${name} collects $${bounty.total}`;
}

/**
 * Formats a hand result from the game state into a chat-friendly message
 */
export function formatHandResult(state: TableState): FormattedHandResult | null {
  const result = formatHandResultBase(state);
  const extra = [formatChicagoSpades(state), formatSevenDeuceBounty(state)].filter(Boolean);
  if (extra.length === 0) return result;
  // Stud showdowns have no line of their own here; a Chicago spade still gets one
  if (!result) return { message: extra.join(' | '), winners: [], isWinByFold: false };
  return { ...result, message: [result.message, ...extra].join(' | ') };
}

const SUIT_SYMBOL: Record<string, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

/** High and Low Chicago: who won half the pot with their spade in the hole. */
function formatChicagoSpades(state: TableState): string | null {
  const wins = state.chicagoResult || [];
  if (state.stage !== 'showdown' || wins.length === 0) return null;
  return wins.map(w => {
    const player = (state.players || []).find(p => p.id === w.playerId);
    const name = player ? getPlayerName(player) : w.playerId.slice(0, 6);
    return `${name} wins $${w.amount} with the ${w.card.rank}${SUIT_SYMBOL[w.card.suit] || ''} in the hole`;
  }).join(', ');
}

/**
 * Razz: the lowest hand wins. The winners come from the engine; their hands are described from
 * their stud cards.
 */
function formatRazzResult(state: TableState): FormattedHandResult | null {
  const winnerIds = Array.isArray(state.handWinners) ? state.handWinners : [];
  const wild = tableWildMatcher(state);
  const winners: HandWinner[] = winnerIds.map(id => {
    const player = (state.players || []).find(p => p.id === id);
    const st = state.studState?.playerCards?.[id];
    const all = st ? [...(st.downCards || []), ...(st.upCards || [])] : [];
    return {
      playerId: id,
      playerName: player ? getPlayerName(player) : id.slice(0, 6),
      amount: state.handResult?.winnings?.[id] || 0,
      handDescription: all.length < 5 ? undefined : wild ? evaluateWildRazz(all, wild).description : HandEvaluator.evaluateRazzLow(all).description,
    };
  });
  if (winners.length === 0) return null;
  const handDesc = winners[0].handDescription ? ` with ${winners[0].handDescription}` : '';
  const message = winners.length === 1
    ? `🏆 ${winners[0].playerName} wins${handDesc}`
    : `🏆 ${winners.map(w => w.playerName).join(', ')} split the pot${handDesc}`;
  return { message, winners, isWinByFold: false };
}

/**
 * Nicaragua: the winners come from the engine, their hands described by the opener's method,
 * followed by what happens to the game: the opener refilling the pot, or the game ending.
 */
function formatNicaraguaResult(state: TableState): FormattedHandResult | null {
  const players = state.players || [];
  const game = state.nicaragua || {};
  const nameOf = (id: string) => {
    const player = players.find(p => p.id === id);
    return player ? getPlayerName(player) : id.slice(0, 6);
  };
  const winnings = state.handResult?.winnings || {};
  const winnerIds = Object.keys(winnings);
  if (winnerIds.length === 0) {
    const pot = state.handResult?.pot ?? game.carry ?? 0;
    return { message: `Nobody opened: the $${pot} pot carries to the next hand`, winners: [], isWinByFold: false };
  }
  const byFold = players.filter(p => !p.isFolded).length === 1;
  const method = game.method || 'high';
  const winners: HandWinner[] = winnerIds.map(id => {
    const player = players.find(p => p.id === id);
    return {
      playerId: id,
      playerName: nameOf(id),
      amount: winnings[id],
      handDescription: byFold || !player?.holeCards?.length ? undefined : describeNicaraguaHand(player.holeCards, method),
    };
  });
  const handDesc = winners[0].handDescription ? ` with ${winners[0].handDescription}` : '';
  const head = winners.length === 1
    ? `🏆 ${winners[0].playerName} wins${byFold ? ' the pot (all others folded)' : handDesc}`
    : `🏆 ${winners.map(w => w.playerName).join(', ')} split the pot${handDesc}`;
  const tail = game.over
    ? 'Nicaragua is over'
    : game.opener && game.carry ? `${nameOf(game.opener)} pays $${game.carry} into the next pot` : '';
  return { message: tail ? `${head} | ${tail}` : head, winners, isWinByFold: byFold };
}

function formatHandResultBase(state: TableState): FormattedHandResult | null {
  // Only format if we're at showdown
  if (state.stage !== 'showdown') {
    return null;
  }

  const players = state.players || [];
  const communityCards = state.communityCards || [];
  const variant = state.variant;
  
  // Find non-folded players
  const activePlayers = players.filter(p => !p.isFolded);

  if (variant === 'nicaragua') return formatNicaraguaResult(state);
  
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

  if (variant === 'razz') {
    return formatRazzResult(state);
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
    const wild = tableWildMatcher(state);

    for (const player of activePlayers) {
      const holeCards = player.holeCards || [];

      if (wild) {
        const minHole = isOmahaVariant(variant) ? 4 : 2;
        if (holeCards.length >= minHole) {
          const best = isOmahaVariant(variant)
            ? evaluateWildOmaha(holeCards, communityCards, wild)
            : evaluateWildHigh([...holeCards, ...communityCards], wild);
          evaluations.push({ player, hand: { rank: best.rank, description: best.name, cards: [] }, label: best.name, wildScore: best.score });
        }
        continue;
      }

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
      const cmp = wild
        ? (evaluations[i].wildScore as number) - (bestEvals[0].wildScore as number)
        : HandEvaluator.compareHands(evaluations[i].hand, bestEvals[0].hand);
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
