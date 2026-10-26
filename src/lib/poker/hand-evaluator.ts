import { Card, HandRanking, HandRank } from '../../types/poker';
import { HandInterface } from '../../types/poker-engine';

// Using require for pokersolver as it doesn't support ES modules
const pokersolver = require('pokersolver').Hand;

interface PokerSolverCard {
  value: string;
  suit: string;
  toString(): string;
}

export class HandEvaluator {
  private static readonly suitMap: { [key: string]: string } = {
    'hearts': 'h',
    'diamonds': 'd',
    'clubs': 'c',
    'spades': 's'
  };

  private static cardToString(card: Card): string {
    const rankMap: { [key: string]: string } = {
      '10': 'T',
      'J': 'J',
      'Q': 'Q',
      'K': 'K',
      'A': 'A'
    };
    const rank = rankMap[card.rank] || card.rank;
    return `${rank}${this.suitMap[card.suit]}`;
  }

  private static cardsToString(cards: Card[]): string[] {
    return cards.map(card => this.cardToString(card));
  }

  // Generic Ace-to-Five low evaluator (8-or-better). Returns lowest 5-card set or null if no qualify.
  static evaluateAceToFiveLow(cards: Card[]): { lowCards: Card[]; ranks: number[] } | null {
    const weight: Record<Card['rank'], number> = {
      'A': 1, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
    };
    const ranksOnly = (cs: Card[]) => cs.map(c => weight[c.rank]);
    const isLowQual = (vals: number[]) => vals.every(v => v <= 8) && new Set(vals).size === 5;
    // generate 5-card combinations
    const combos = <T>(arr: T[], k: number): T[][] => {
      const res: T[][] = [];
      const backtrack = (start: number, path: T[]) => {
        if (path.length === k) { res.push([...path]); return; }
        for (let i = start; i < arr.length; i++) { path.push(arr[i]); backtrack(i + 1, path); path.pop(); }
      };
      backtrack(0, []);
      return res;
    };
    let best: { lowCards: Card[]; ranks: number[] } | null = null;
    for (const five of combos(cards, 5)) {
      const vals = ranksOnly(five);
      if (!isLowQual(vals)) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      if (!best) best = { lowCards: five, ranks: sorted };
      else {
        const a = best.ranks, b = sorted;
        const n = Math.min(a.length, b.length);
        let cmp = 0;
        for (let i = 0; i < n; i++) { if (a[i] !== b[i]) { cmp = a[i] - b[i]; break; } }
        if (cmp > 0) best = { lowCards: five, ranks: sorted };
      }
    }
    return best;
  }

  /**
   * Razz (ace-to-five lowball, no qualifier): the key of the best low hand that can be made from
   * up to five of these cards. Lower keys are better hands. Aces are low and straights and
   * flushes don't count, but pairs do: any hand without a pair beats any hand with one.
   * The key is [category, ranks...]: category 0 no pair, 1 one pair, 2 two pair, 3 trips,
   * 4 full house, 5 quads; then the ranks with the paired ones first, highest first within each
   * group, so comparing keys left to right compares the hands. Works on fewer than five cards
   * too, which is how the showing up cards are compared to decide who acts first.
   */
  static razzLowKey(cards: Card[]): number[] {
    const valid = (cards || []).filter((c: any) => c && c.rank && c.suit);
    if (valid.length <= 5) return this.razzKeyOf(valid);
    let best: number[] | null = null;
    for (const five of this.combinations(valid, 5)) {
      const key = this.razzKeyOf(five);
      if (!best || this.compareRazzLow(key, best) < 0) best = key;
    }
    return best || [];
  }

  /** Compare two razz keys: negative when a is the better (lower) hand, 0 when they tie. */
  static compareRazzLow(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }

  /** The best razz hand from these cards: its five cards, key and a description such as "7-5-4-2-A low". */
  static evaluateRazzLow(cards: Card[]): { lowCards: Card[]; key: number[]; description: string } {
    const valid = (cards || []).filter((c: any) => c && c.rank && c.suit);
    let best: { cards: Card[]; key: number[] } = { cards: valid.slice(0, 5), key: this.razzKeyOf(valid.slice(0, 5)) };
    if (valid.length > 5) {
      for (const five of this.combinations(valid, 5)) {
        const key = this.razzKeyOf(five);
        if (this.compareRazzLow(key, best.key) < 0) best = { cards: five, key };
      }
    }
    const label = (v: number) => (v === 1 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : String(v));
    const names = ['', 'Pair', 'Two Pair', 'Three of a Kind', 'Full House', 'Four of a Kind'];
    const [category, ...ranks] = best.key;
    const ranksText = ranks.map(label).join('-');
    const description = category === 0 ? `${ranksText} low` : `${names[category]} (${ranksText})`;
    return { lowCards: best.cards, key: best.key, description };
  }

  /** A razz hand as one number where higher is better, for splitting pots by strength. */
  static razzStrength(cards: Card[]): number {
    const [category = 0, ...ranks] = this.razzLowKey(cards);
    const slots = [...ranks, 0, 0, 0, 0, 0].slice(0, 5);
    const packed = category * 1e10 + slots[0] * 1e8 + slots[1] * 1e6 + slots[2] * 1e4 + slots[3] * 1e2 + slots[4];
    return 1e11 - packed;
  }

  private static razzKeyOf(cards: Card[]): number[] {
    const low: Record<Card['rank'], number> = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13,
    };
    const counts = new Map<number, number>();
    cards.forEach(c => counts.set(low[c.rank], (counts.get(low[c.rank]) || 0) + 1));
    const groups = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
    const sizes = groups.map(g => g[1]);
    const pairs = sizes.filter(s => s === 2).length;
    let category = 0;
    if (sizes[0] >= 4) category = 5;
    else if (sizes[0] === 3 && pairs > 0) category = 4;
    else if (sizes[0] === 3) category = 3;
    else if (pairs >= 2) category = 2;
    else if (pairs === 1) category = 1;
    return [category, ...groups.map(g => g[0])];
  }

  private static combinations<T>(arr: T[], k: number): T[][] {
    const res: T[][] = [];
    const backtrack = (start: number, path: T[]) => {
      if (path.length === k) { res.push([...path]); return; }
      for (let i = start; i < arr.length; i++) { path.push(arr[i]); backtrack(i + 1, path); path.pop(); }
    };
    backtrack(0, []);
    return res;
  }

  static evaluateHand(holeCards: Card[], communityCards: Card[]): { hand: HandInterface; cards: Card[] } {
    // Filter out any invalid/undefined cards defensively
    const allCardsRaw = [...(holeCards || []), ...(communityCards || [])];
    const allCards: Card[] = allCardsRaw.filter((c: any) => c && c.rank && c.suit) as Card[];

    // If fewer than 5 valid cards, perform a lightweight evaluation (detecting pairs/trips/etc.) without solver
    if (allCards.length < 5) {
      const weight: Record<Card['rank'], number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
      const labelMap: Record<Card['rank'], string> = { '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace' } as any;
      const pluralMap: Record<Card['rank'], string> = { '2': 'Twos', '3': 'Threes', '4': 'Fours', '5': 'Fives', '6': 'Sixes', '7': 'Sevens', '8': 'Eights', '9': 'Nines', '10': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings', 'A': 'Aces' } as any;
      const limit = Math.min(5, allCards.length);
      const sortedCards = [...allCards].sort((a, b) => weight[b.rank] - weight[a.rank]);
      const counts: Record<Card['rank'], number> = {} as any;
      allCards.forEach(card => { counts[card.rank] = (counts[card.rank] || 0) + 1; });
      const sortedRanks = Object.keys(counts) as Card['rank'][];
      sortedRanks.sort((a, b) => {
        if (counts[b] !== counts[a]) return counts[b] - counts[a];
        return weight[b] - weight[a];
      });

      const buildResult = (name: string, description: string, rankValue: HandRank) => {
        const best = sortedCards.slice(0, limit);
        const hand: any = { rank: rankValue, description, descr: description, cards: [] };
        hand.name = name;
        return { hand: hand as HandInterface, cards: best };
      };

      const topRank = sortedRanks[0];
      const topCount = topRank ? counts[topRank] : 0;
      const pairRanks = sortedRanks.filter(rank => counts[rank] === 2);

      if (topCount === 4 && topRank) {
        return buildResult('Four of a Kind', `Four of a Kind (${pluralMap[topRank]})`, HandRank.FourOfAKind);
      }
      if (topCount === 3 && topRank) {
        return buildResult('Three of a Kind', `Three of a Kind (${pluralMap[topRank]})`, HandRank.ThreeOfAKind);
      }
      if (pairRanks.length >= 2) {
        const [firstPair, secondPair] = pairRanks.slice(0, 2);
        const desc = `Two Pair (${pluralMap[firstPair]} & ${pluralMap[secondPair]})`;
        return buildResult('Two Pair', desc, HandRank.TwoPair);
      }
      if (pairRanks.length === 1) {
        const rank = pairRanks[0];
        return buildResult('Pair', `Pair of ${pluralMap[rank]}`, HandRank.OnePair);
      }
      const topCard = sortedCards[0];
      const descr = topCard ? `${labelMap[topCard.rank]} High` : 'High Card';
      return buildResult('High Card', descr, HandRank.HighCard);
    }

    const cardStrings = this.cardsToString(allCards);
    // Validate strings: ensure all are truthy and roughly valid (rank + suit); accept '10' and 'T'
    const validStr = (s: string) => typeof s === 'string' && /^(?:10|[2-9TJQKA])[hdcs]$/.test(s);
    const allValid = cardStrings.length >= 2 && cardStrings.every(validStr);
    let hand: any;
    try {
      hand = allValid ? pokersolver.solve(cardStrings) : undefined;
      if (!hand) throw new Error('invalid card strings for solver');
    } catch (err) {
      // As a fallback, pick the top 5 ranks and return a defensive High Card hand
      const weight: Record<Card['rank'], number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
      const sorted = [...allCards].sort((a, b) => weight[b.rank] - weight[a.rank]);
      const best = sorted.slice(0, 5);
      const top = best[0]?.rank || '';
      const labelMap: Record<Card['rank'], string> = { '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace' } as any;
      return {
        hand: { rank: 1, description: top ? `${labelMap[top as Card['rank']]} High` : 'High Card', cards: [] },
        cards: best
      };
    }
    
    // Map the cards in the winning hand back to our Card objects
    const winningCards = hand.cards.map((solverCard: PokerSolverCard) => {
      const rank = (solverCard.value === 'T' ? '10' : solverCard.value) as Card['rank'] | string;
      const suit = Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit) as Card['suit'] | undefined;
      const found = allCards.find(card => card.rank === (rank as Card['rank']) && card.suit === suit);
      // Fallback: construct a Card if mapping fails (should not happen, but be resilient in tests)
      return found || ({ rank: rank as Card['rank'], suit: (suit || 'hearts') as Card['suit'] });
    });

    return { 
      hand: {
        rank: hand.rank,
        description: hand.descr,
        cards: hand.cards
      },
      cards: winningCards 
    };
  }

  // Omaha: exactly 2 from hole and 3 from board. Works for any number of hole cards (4-card
  // Omaha, 5-card Omaha) since it tries every pair of hole cards with every three board cards.
  static evaluateOmahaHand(holeCards: Card[], communityCards: Card[]): { hand: HandInterface; cards: Card[] } {
    // Defensive: require at least 4 hole and 3 community to form a hand
    const holes = holeCards || [];
    const board = communityCards || [];
    if (holes.length < 2 || board.length < 3) {
      // Fallback to generic to avoid crashes; still enforce combo selection if possible
      return this.evaluateHand(holes, board);
    }

    // Helper: generate k-combinations
    const combos = <T>(arr: T[], k: number): T[][] => {
      const res: T[][] = [];
      const backtrack = (start: number, path: T[]) => {
        if (path.length === k) { res.push([...path]); return; }
        for (let i = start; i < arr.length; i++) {
          path.push(arr[i]);
          backtrack(i + 1, path);
          path.pop();
        }
      };
      backtrack(0, []);
      return res;
    };

    let best: { hand: any; cards: any[] } | null = null;
    const holePairs = combos(holes, 2);
    const boardTriples = combos(board, 3);
    for (const hp of holePairs) {
      for (const bt of boardTriples) {
        const five = [...hp, ...bt];
        // Guard: skip impossible combos where the same physical card appears twice (can happen in contrived tests)
        const uniq = new Set(five.map(c => `${c.rank}-${c.suit}`));
        if (uniq.size !== 5) continue;
        const solved = pokersolver.solve(this.cardsToString(five));
        if (!best) {
          best = { hand: solved, cards: solved.cards };
        } else {
          const winner = pokersolver.winners([best.hand, solved]);
          if (winner.length === 2 || winner[0] === solved) {
            // solved is at least as good
            best = { hand: solved, cards: solved.cards };
          }
        }
      }
    }

    // Map back to Card objects
    const winningCards = (best?.cards || []).map((solverCard: PokerSolverCard) => {
      const rank = (solverCard.value === 'T' ? '10' : solverCard.value) as Card['rank'] | string;
      const suit = Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit) as Card['suit'] | undefined;
      // Prefer matching from the combined five-set to keep exact identity
      const fiveSet = [...(Array.isArray(holeCards) ? holeCards : []), ...(Array.isArray(communityCards) ? communityCards : [])];
      const found = fiveSet.find(card => card.rank === (rank as Card['rank']) && card.suit === suit);
      return found || ({ rank: rank as Card['rank'], suit: (suit || 'hearts') as Card['suit'] });
    });

    const hand = best?.hand || pokersolver.solve(this.cardsToString([...holes.slice(0, 2), ...board.slice(0, 3)]));
    return {
      hand: {
        rank: hand.rank,
        description: hand.descr,
        cards: hand.cards
      },
      cards: winningCards
    };
  }

  static compareHands(hand1: HandInterface, hand2: HandInterface): number {
    // If hand ranks differ, compare directly to avoid filler card corruption in partial hands.
    // Higher rank value means stronger hand (pair=2 > high card=1).
    // Type guards are defensive in case HandInterface is used with incomplete data.
    if (hand1.rank !== hand2.rank) {
      return hand1.rank > hand2.rank ? 1 : -1;
    }

    // If ranks are equal and both hands contain filler cards (indicated by duplicate low cards),
    // compare the actual cards directly to avoid pokersolver corruption.
    // Filler cards typically start with '2' from normalizeHandForComparison padding.
    const hasFillerCards = (hand: HandInterface): boolean => {
      const cardStrs = new Set<string>();
      const rankCounts: Record<string, number> = {};
      
      // Single iteration to check for duplicates and count ranks
      for (const card of hand.cards) {
        const key = `${card.value}${card.suit}`;
        if (cardStrs.has(key)) return true; // Duplicate card found
        cardStrs.add(key);
        rankCounts[card.value] = (rankCounts[card.value] || 0) + 1;
      }
      
      // Check if there are 3+ cards of the same rank (likely filler padding)
      return Object.values(rankCounts).some(count => count >= 3);
    };

    if (hasFillerCards(hand1) || hasFillerCards(hand2)) {
      // Compare actual card values directly for partial hands
      const weight: Record<string, number> = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
        'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
      };
      
      // Get unique cards sorted by value (highest first)
      const getUniqueCardValues = (hand: HandInterface): number[] => {
        const seen = new Set<string>();
        const values: number[] = [];
        hand.cards.forEach(card => {
          const key = `${card.value}${card.suit}`;
          if (!seen.has(key)) {
            seen.add(key);
            const cardWeight = weight[card.value];
            if (cardWeight === undefined) {
              // This should never happen with valid cards; log and skip
              console.warn(`Unknown card value in hand comparison: ${card.value}`);
            } else {
              values.push(cardWeight);
            }
          }
        });
        return values.sort((a, b) => b - a);
      };
      
      const values1 = getUniqueCardValues(hand1);
      const values2 = getUniqueCardValues(hand2);
      
      // Compare card by card
      const len = Math.max(values1.length, values2.length);
      for (let i = 0; i < len; i++) {
        const v1 = values1[i] || 0;
        const v2 = values2[i] || 0;
        if (v1 !== v2) {
          return v1 > v2 ? 1 : -1;
        }
      }
      return 0; // Tie
    }

    // Convert string cards back to Card objects for solving
    const convertToCards = (hand: HandInterface): Card[] => {
      return hand.cards.map(card => ({
        suit: Object.keys(this.suitMap).find(
          key => this.suitMap[key] === card.suit
        ) as Card['suit'],
        rank: card.value === 'T' ? '10' : card.value as Card['rank']
      }));
    };

  const solved1 = pokersolver.solve(this.cardsToString(convertToCards(hand1)));
  const solved2 = pokersolver.solve(this.cardsToString(convertToCards(hand2)));
  const winners = pokersolver.winners([solved1, solved2]);
  // If both are winners, it's a tie
  if (winners.length > 1) return 0;
  return winners[0] === solved1 ? 1 : -1;
  }

  // US-052: Omaha Hi-Lo support (8-or-better, Ace-to-Five low) minimal evaluator
  // Returns null if no qualifying low can be made using exactly 2 hole + 3 board cards
  static evaluateOmahaLowEightOrBetter(holeCards: Card[], communityCards: Card[]): { lowCards: Card[]; ranks: number[] } | null {
    const holes = holeCards || [];
    const board = communityCards || [];
    if (holes.length < 2 || board.length < 3) return null;

    const weight: Record<Card['rank'], number> = {
      'A': 1, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
    };
    const isLowQual = (ranks: number[]) => ranks.every(v => v <= 8) && new Set(ranks).size === 5;

    const combos = <T>(arr: T[], k: number): T[][] => {
      const res: T[][] = [];
      const backtrack = (start: number, path: T[]) => {
        if (path.length === k) { res.push([...path]); return; }
        for (let i = start; i < arr.length; i++) { path.push(arr[i]); backtrack(i + 1, path); path.pop(); }
      };
      backtrack(0, []);
      return res;
    };

    let best: { lowCards: Card[]; ranks: number[] } | null = null;
    for (const hp of combos(holes, 2)) {
      for (const bt of combos(board, 3)) {
        const five = [...hp, ...bt];
        // Ace-to-Five: ignore suits and straights/flushes; duplicates not allowed
        const ranks = five.map(c => weight[c.rank]);
        if (!isLowQual(ranks)) continue;
        const sorted = [...ranks].sort((a, b) => a - b);
        if (!best) best = { lowCards: five, ranks: sorted };
        else {
          // Lower lexicographic ranks is better (e.g., 5-4-3-2-A => [1,2,3,4,5])
          const cmpLen = Math.min(best.ranks.length, sorted.length);
          let cmp = 0;
          for (let i = 0; i < cmpLen; i++) { if (best.ranks[i] !== sorted[i]) { cmp = best.ranks[i] - sorted[i]; break; } }
          if (cmp > 0) best = { lowCards: five, ranks: sorted };
        }
      }
    }
    return best;
  }

  /**
   * Build a HandRanking view (US-026) from given cards.
   * Uses current evaluator output and derives basic fields; kickers default empty
   * because the underlying solver already encodes them in order of cards.
   */
  static getHandRanking(holeCards: Card[], communityCards: Card[]): HandRanking {
    const holes = holeCards || [];
    const board = communityCards || [];
    const total = holes.length + board.length;
    // Defensive: for non-board games (e.g., stud) or partial info, avoid solver on <5
    if (total < 5) {
      // Use evaluateHand to benefit from its internal guards/labels for simple cases
      const { hand, cards } = this.evaluateHand(holes, board);
      // Map minimal result into HandRanking shape
      const weight: Record<Card['rank'], number> = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
      };
      const all = [...holes, ...board];
      const key = (c: Card) => `${c.rank}-${c.suit}`;
      const bestKeys = new Set(cards.map(key));
      const kickers = all.filter(c => !bestKeys.has(key(c))).sort((a, b) => weight[b.rank] - weight[a.rank]);
      const name = (hand as any).description || (hand as any).descr || (hand as any).name || 'High Card';
      const rankNumber = typeof (hand as any).rank === 'number' ? (hand as any).rank : 1;
      return {
        rank: rankNumber,
        name,
        cards,
        kickers,
        strength: rankNumber,
      };
    }

    const { hand, cards } = this.evaluateHand(holes, board);

    // Map pokersolver description -> our HandRank enum
    const desc = String(hand.description || '').toLowerCase();

    // Utility: rank weight for sorting kickers
    const weight: Record<Card['rank'], number> = {
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      '10': 10,
      'J': 11,
      'Q': 12,
      'K': 13,
      'A': 14,
    };

    // Determine if the best 5 cards form a royal flush (A,K,Q,J,10 same suit)
    const isRoyal = (() => {
      // Judge by the cards: the solver describes this hand as "Royal Flush", not as a straight flush
      if (cards.length !== 5) return false;
      const ranks = new Set(cards.map(c => c.rank));
      const suits = new Set(cards.map(c => c.suit));
      return (
        suits.size === 1 &&
        ['A', 'K', 'Q', 'J', '10'].every(r => ranks.has(r as Card['rank']))
      );
    })();

    let mappedRank: HandRank;
    if (isRoyal) {
      mappedRank = HandRank.RoyalFlush;
    } else if (desc.includes('straight flush')) {
      mappedRank = HandRank.StraightFlush;
    } else if (desc.includes('four of a kind')) {
      mappedRank = HandRank.FourOfAKind;
    } else if (desc.includes('full house')) {
      mappedRank = HandRank.FullHouse;
    } else if (desc.includes('flush')) {
      mappedRank = HandRank.Flush;
    } else if (desc.includes('straight')) {
      mappedRank = HandRank.Straight;
    } else if (desc.includes('three of a kind') || desc.includes('trips')) {
      mappedRank = HandRank.ThreeOfAKind;
    } else if (desc.includes('two pair')) {
      mappedRank = HandRank.TwoPair;
    } else if (desc.includes('pair')) {
      mappedRank = HandRank.OnePair;
    } else {
      mappedRank = HandRank.HighCard;
    }

    // Compute kickers as remaining cards (by rank, high to low) not in the best 5
    const all = [...holeCards, ...communityCards];
    const key = (c: Card) => `${c.rank}-${c.suit}`;
    const bestKeys = new Set(cards.map(key));
    const kickers = all
      .filter(c => !bestKeys.has(key(c)))
      .sort((a, b) => weight[b.rank] - weight[a.rank]);

    return {
      rank: mappedRank,
      name: isRoyal ? 'Royal Flush' : (hand.description || ''),
      cards,
      kickers,
      strength: mappedRank,
    };
  }

  // Omaha-specific HandRanking enforcing exactly two hole cards used
  static getOmahaHandRanking(holeCards: Card[], communityCards: Card[]): HandRanking {
    const { hand, cards } = this.evaluateOmahaHand(holeCards, communityCards);

    const desc = String(hand.description || '').toLowerCase();
    const weight: Record<Card['rank'], number> = {
      '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
    };
    const isRoyal = (() => {
      // Judge by the cards: the solver describes this hand as "Royal Flush", not as a straight flush
      if (cards.length !== 5) return false;
      const ranks = new Set(cards.map(c => c.rank));
      const suits = new Set(cards.map(c => c.suit));
      return suits.size === 1 && ['A', 'K', 'Q', 'J', '10'].every(r => ranks.has(r as Card['rank']));
    })();
    let mappedRank: HandRank;
    if (isRoyal) mappedRank = HandRank.RoyalFlush;
    else if (desc.includes('straight flush')) mappedRank = HandRank.StraightFlush;
    else if (desc.includes('four of a kind')) mappedRank = HandRank.FourOfAKind;
    else if (desc.includes('full house')) mappedRank = HandRank.FullHouse;
    else if (desc.includes('flush')) mappedRank = HandRank.Flush;
    else if (desc.includes('straight')) mappedRank = HandRank.Straight;
    else if (desc.includes('three of a kind') || desc.includes('trips')) mappedRank = HandRank.ThreeOfAKind;
    else if (desc.includes('two pair')) mappedRank = HandRank.TwoPair;
    else if (desc.includes('pair')) mappedRank = HandRank.OnePair;
    else mappedRank = HandRank.HighCard;

    const all = [...holeCards, ...communityCards];
    const key = (c: Card) => `${c.rank}-${c.suit}`;
    const bestKeys = new Set(cards.map(key));
    const kickers = all.filter(c => !bestKeys.has(key(c))).sort((a, b) => weight[b.rank] - weight[a.rank]);

    return {
      rank: mappedRank,
      name: isRoyal ? 'Royal Flush' : (hand.description || ''),
      cards,
      kickers,
      strength: mappedRank,
    };
  }
}
