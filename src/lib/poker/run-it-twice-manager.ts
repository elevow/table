import { randomInt } from 'crypto';
import { HandEvaluator } from './hand-evaluator';
import { RunItTwicePrompt, TableState, Card, GameStage } from '../../types/poker';
import { HandInterface } from '../../types/poker-engine';

export type RunItTwiceState = {
  prompt: RunItTwicePrompt | null;
  disabled: boolean;
  lockedCommunityCount?: number;
  lockedStage?: GameStage;
};

/**
 * Global state map for Run-It-Twice prompts per table.
 * This ensures state is shared across Socket.IO and REST API endpoints.
 */
const getRunItStateMap = (): Map<string, RunItTwiceState> => {
  if (!(global as any).runItTwiceState) {
    (global as any).runItTwiceState = new Map<string, RunItTwiceState>();
  }
  return (global as any).runItTwiceState;
};

export const getRunItState = (tableId: string): RunItTwiceState => {
  const map = getRunItStateMap();
  if (!map.has(tableId)) {
    map.set(tableId, { prompt: null, disabled: false });
  }
  return map.get(tableId)!;
};

export const clearRunItState = (tableId: string): void => {
  const meta = getRunItState(tableId);
  meta.prompt = null;
  meta.disabled = false;
  meta.lockedCommunityCount = undefined;
  meta.lockedStage = undefined;
};

export const disableRunItPrompt = (tableId: string, disabled: boolean): void => {
  const meta = getRunItState(tableId);
  meta.disabled = disabled;
  if (disabled) {
    meta.prompt = null;
    meta.lockedCommunityCount = undefined;
    meta.lockedStage = undefined;
  }
};

const deriveStageFromCommunityCount = (count: number, fallback?: GameStage): GameStage => {
  if (count >= 5) return 'river';
  if (count === 4) return 'turn';
  if (count === 3) return 'flop';
  if (count === 0) return 'preflop';
  return fallback ?? 'preflop';
};

/**
 * Enriches game state with Run-It-Twice prompt information.
 */
export const enrichStateWithRunIt = (tableId: string, state: TableState | any) => {
  const meta = getRunItState(tableId);
  const prompt = meta.prompt;
  if (!prompt) {
    return {
      ...state,
      runItTwicePrompt: null,
      runItTwicePromptDisabled: meta.disabled,
    };
  }

  const maskedState: TableState = { ...(state || {}) } as TableState;
  const community = Array.isArray(state?.communityCards) ? state.communityCards : [];
  if (typeof meta.lockedCommunityCount === 'number') {
    const limit = Math.max(0, Math.min(meta.lockedCommunityCount, community.length));
    maskedState.communityCards = community.slice(0, limit);
    maskedState.stage = meta.lockedStage || deriveStageFromCommunityCount(limit, state?.stage);
  } else if (meta.lockedStage) {
    maskedState.stage = meta.lockedStage;
  }
  if (prompt.playerId) {
    maskedState.activePlayer = prompt.playerId;
  }

  return {
    ...maskedState,
    runItTwicePrompt: prompt,
    runItTwicePromptDisabled: meta.disabled,
  };
};

/**
 * Checks if the current game state is eligible for auto-runout.
 */
export const isAutoRunoutEligible = (state: any): boolean => {
  const players = Array.isArray(state?.players) ? state.players : [];
  const activeCount = players.filter((p: any) => !(p.isFolded || (p as any).folded)).length;
  if (activeCount < 2) return false;
  const anyAllIn = players.some((p: any) => !(p.isFolded || (p as any).folded) && p.isAllIn);
  if (!anyAllIn) return false;
  const nonAllInCount = players.filter((p: any) => !(p.isFolded || (p as any).folded) && !p.isAllIn).length;
  if (nonAllInCount > 1) return false;
  const communityLen = Array.isArray(state?.communityCards) ? state.communityCards.length : 0;
  const need = Math.max(0, 5 - communityLen);
  if (need <= 0) return false;
  if (state?.stage === 'showdown') return false;
  const currentBet = Number(state?.currentBet) || 0;
  const owes = players.some((p: any) => !(p.isFolded || (p as any).folded) && !p.isAllIn && (Number(p.currentBet) || 0) < currentBet);
  return !owes;
};

/**
 * Creates a Run-It-Twice prompt if conditions are met and no prompt exists.
 */
type PromptOptions = {
  communityOverride?: Card[];
  boardVisibleCount?: number;
  stageOverride?: GameStage;
};

export const maybeCreateRunItPrompt = (
  tableId: string,
  state: TableState | any,
  options?: PromptOptions
): RunItTwicePrompt | null => {
  const meta = getRunItState(tableId);
  if (!state || meta.prompt || meta.disabled || state.runItTwice?.enabled) {
    return meta.prompt || null;
  }
  const boardOverride = Array.isArray(options?.communityOverride) ? options!.communityOverride : undefined;
  const prompt = determineRunItTwicePrompt(state, boardOverride);
  if (prompt) {
    const lockedCount = typeof options?.boardVisibleCount === 'number'
      ? options.boardVisibleCount
      : (boardOverride ? boardOverride.length : (Array.isArray(state?.communityCards) ? state.communityCards.length : 0));
    prompt.boardCardsCount = lockedCount;
    meta.prompt = prompt;
    meta.disabled = false;
    meta.lockedCommunityCount = lockedCount;
    meta.lockedStage = options?.stageOverride || deriveStageFromCommunityCount(lockedCount, state?.stage);
    return prompt;
  }
  return null;
};

/**
 * Determines which player should receive the Run-It-Twice prompt.
 * Selects the player with the weakest hand (or random among tied weakest).
 * The lowest hand player decides how many times to run the remaining board.
 */
export const determineRunItTwicePrompt = (state: TableState, boardOverride?: Card[]): RunItTwicePrompt | null => {
  try {
    const board = Array.isArray(boardOverride) ? boardOverride : (Array.isArray(state.communityCards) ? state.communityCards : []);
    const variant = state.variant;
    const minHoleCards = variant === 'omaha' || variant === 'omaha-hi-lo' ? 4 : 2;
    const evaluator = variant === 'omaha' || variant === 'omaha-hi-lo'
      ? HandEvaluator.evaluateOmahaHand.bind(HandEvaluator)
      : HandEvaluator.evaluateHand.bind(HandEvaluator);
    const contenders = state.players
      .filter((p) => !p.isFolded && Array.isArray(p.holeCards) && p.holeCards.length >= minHoleCards)
      .map((p) => {
        const evaluation = evaluator(p.holeCards || [], board);
        const normalizedHand = normalizeHandForComparison(evaluation);
        const desc = normalizedHand.description || '';
        return {
          playerId: p.id,
          hand: normalizedHand,
          description: desc,
        };
      });
    if (contenders.length < 2) return null;

    let weakest = contenders[0];
    let weakestGroup = [contenders[0]];
    let strongest = contenders[0];
    for (let i = 1; i < contenders.length; i++) {
      const candidate = contenders[i];
      const cmpWeak = HandEvaluator.compareHands(candidate.hand, weakest.hand);
      // compareHands returns 1 if first hand wins, -1 if second wins
      // So negative cmp means candidate is weaker than current weakest
      if (cmpWeak < 0) {
        weakest = candidate;
        weakestGroup = [candidate];
      } else if (cmpWeak === 0) {
        weakestGroup.push(candidate);
      }
      // Track strongest hand
      const cmpStrong = HandEvaluator.compareHands(candidate.hand, strongest.hand);
      if (cmpStrong > 0) {
        strongest = candidate;
      }
    }

    const pickIndex = weakestGroup.length === 1 ? 0 : randomInt(weakestGroup.length);
    const chosen = weakestGroup[pickIndex];
    if (!chosen) return null;
    const tiedWith = weakestGroup
      .filter((entry) => entry.playerId !== chosen.playerId)
      .map((entry) => entry.playerId);

    const handDescriptionsByPlayer = contenders.reduce<Record<string, string>>((acc, entry) => {
      if (entry.description) acc[entry.playerId] = entry.description;
      return acc;
    }, {});

    return {
      playerId: chosen.playerId,
      reason: 'lowest-hand',
      createdAt: Date.now(),
      boardCardsCount: board.length,
      handDescription: chosen.description || undefined,
      highestHandDescription: strongest.description || undefined,
      handDescriptionsByPlayer: Object.keys(handDescriptionsByPlayer).length ? handDescriptionsByPlayer : undefined,
      eligiblePlayerIds: contenders.map((c) => c.playerId),
      tiedWith: tiedWith.length ? tiedWith : undefined,
    };
  } catch (err) {
    console.debug('[auto-runout] failed to compute Run It Twice prompt', { err: (err as any)?.message });
    return null;
  }
};

/**
 * Normalizes hand evaluation results for consistent comparison.
 */
export const normalizeHandForComparison = (evaluation: { hand: HandInterface; cards: Card[] }): HandInterface => {
  if (Array.isArray(evaluation?.hand?.cards) && evaluation.hand.cards.length >= 5) {
    return evaluation.hand;
  }
  const suitMap: Record<Card['suit'], string> = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
  const normalizedCards = (evaluation.cards || []).map((card) => ({
    value: card.rank === '10' ? 'T' : card.rank,
    suit: suitMap[card.suit] || 'h',
  }));
  const used = new Set(normalizedCards.map((card) => `${card.value}${card.suit}`));
  const fillerRanks = ['2', '3', '4', '5', '6', '7', '8', '9'];
  const fillerSuits = ['h', 'd', 'c', 's'];
  let rankIdx = 0;
  while (normalizedCards.length < 5 && rankIdx < fillerRanks.length) {
    for (const suit of fillerSuits) {
      const key = `${fillerRanks[rankIdx]}${suit}`;
      if (used.has(key)) continue;
      normalizedCards.push({ value: fillerRanks[rankIdx], suit });
      used.add(key);
      if (normalizedCards.length >= 5) break;
    }
    rankIdx += 1;
  }
  return {
    rank: evaluation.hand?.rank ?? 1,
    description: evaluation.hand?.description || (evaluation.hand as any)?.descr || 'High Card',
    cards: normalizedCards,
  };
};
