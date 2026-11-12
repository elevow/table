import type { BettingMode, GameVariant, WildRule } from '../../types/poker';

/**
 * Plain-language rules for each game, for the Rules tab at the table. Written for someone who
 * has never played the game, and kept in step with how the engine deals and settles it.
 */

// Which hand ranking the game is won with, so the tab can show the right chart
export type RankingKind = 'high' | 'hi-lo' | 'razz' | 'badugi' | 'guts' | 'nicaragua';

export interface GameRules {
  summary: string;
  howToPlay: string[];
  winning: string[];
  ranking: RankingKind;
}

const HOLDEM_STREETS = [
  'The two players after the button post the small and big blinds',
  'A round of betting before the flop, starting after the big blind',
  'The flop: three cards face up in the middle, then betting',
  'The turn: a fourth card, then betting',
  'The river: a fifth card, then a last round of betting',
];

const BOARD_STREETS = HOLDEM_STREETS.slice(2);

const STUD_STREETS = [
  'Everyone antes, then gets two cards face down and one face up',
  'The lowest card showing brings it in (on a tie, the lowest suit: clubs, diamonds, hearts, spades)',
  'Three more cards face up, one at a time, with a round of betting after each; from here the best hand showing acts first',
  'A last card face down, then a final round of betting',
];

const OMAHA_RULE = 'Your hand must use exactly two of your hole cards and exactly three from the board';

const EIGHT_OR_BETTER = 'The low hand must be five different cards 8 or lower, aces low; straights and flushes don’t count against it';

export const GAME_RULES: Record<GameVariant, GameRules> = {
  'texas-holdem': {
    summary: 'Two cards each, five shared cards in the middle. Make the best five-card hand from any of the seven.',
    howToPlay: ['Everyone gets two cards face down', ...HOLDEM_STREETS],
    winning: ['The best five-card hand wins, using any mix of your two cards and the five on the board'],
    ranking: 'high',
  },
  'omaha': {
    summary: "Like Hold'em, but with four hole cards, and you must use exactly two of them.",
    howToPlay: ['Everyone gets four cards face down', ...HOLDEM_STREETS],
    winning: [OMAHA_RULE, 'Four hearts in your hand and none on the board is not a flush'],
    ranking: 'high',
  },
  'omaha-5': {
    summary: 'Omaha with five hole cards. You still use exactly two of them.',
    howToPlay: ['Everyone gets five cards face down', ...HOLDEM_STREETS],
    winning: [OMAHA_RULE],
    ranking: 'high',
  },
  'courchevel': {
    summary: 'Five-card Omaha where the first flop card is dealt face up before anyone bets.',
    howToPlay: [
      'Everyone gets five cards face down, and one card goes face up in the middle',
      'The two players after the button post the blinds, then a round of betting',
      'Two more cards complete the flop, then betting',
      ...BOARD_STREETS.slice(1),
    ],
    winning: [OMAHA_RULE],
    ranking: 'high',
  },
  'omaha-hi-lo': {
    summary: 'Omaha where the pot is split between the best high hand and the best low hand.',
    howToPlay: ['Everyone gets four cards face down', ...HOLDEM_STREETS],
    winning: [
      'Half the pot goes to the best high hand and half to the best low hand',
      EIGHT_OR_BETTER,
      `${OMAHA_RULE}, for the high and the low alike (they can be different cards)`,
      'With no qualifying low, the best high hand takes the whole pot',
    ],
    ranking: 'hi-lo',
  },
  'big-o': {
    summary: 'Omaha Hi-Lo with five hole cards.',
    howToPlay: ['Everyone gets five cards face down', ...HOLDEM_STREETS],
    winning: [
      'Half the pot goes to the best high hand and half to the best low hand',
      EIGHT_OR_BETTER,
      `${OMAHA_RULE}, for the high and the low alike`,
      'With no qualifying low, the best high hand takes the whole pot',
    ],
    ranking: 'hi-lo',
  },
  'pineapple': {
    summary: "Hold'em dealt with three hole cards; everyone throws one away after the first round of betting.",
    howToPlay: [
      'Everyone gets three cards face down',
      HOLDEM_STREETS[0],
      HOLDEM_STREETS[1],
      'Everyone throws one card away at the same time (running out of time throws away your lowest)',
      ...BOARD_STREETS,
    ],
    winning: ["The best five-card hand wins, from your two cards and the board, as in Hold'em"],
    ranking: 'high',
  },
  'crazy-pineapple': {
    summary: 'Pineapple where you keep all three hole cards until after the flop betting.',
    howToPlay: [
      'Everyone gets three cards face down',
      HOLDEM_STREETS[0],
      HOLDEM_STREETS[1],
      BOARD_STREETS[0],
      'Everyone throws one card away at the same time (running out of time throws away your lowest)',
      ...BOARD_STREETS.slice(1),
    ],
    winning: ["The best five-card hand wins, from your two cards and the board, as in Hold'em"],
    ranking: 'high',
  },
  'seven-card-stud': {
    summary: 'Seven cards each, some face up, no shared cards. Make the best five-card hand.',
    howToPlay: STUD_STREETS,
    winning: ['The best five of your seven cards wins'],
    ranking: 'high',
  },
  'seven-card-stud-hi-lo': {
    summary: 'Seven-Card Stud where the pot is split between the best high hand and the best low hand.',
    howToPlay: STUD_STREETS,
    winning: [
      'Half the pot goes to the best high hand and half to the best low hand; your cards speak for themselves',
      EIGHT_OR_BETTER,
      'You can use different cards for your high and your low',
      'With no qualifying low, the best high hand takes the whole pot',
    ],
    ranking: 'hi-lo',
  },
  'high-chicago': {
    summary: 'Seven-Card Stud where the highest spade in the hole wins half the pot.',
    howToPlay: STUD_STREETS,
    winning: [
      'Half the pot goes to the player with the highest spade among their face-down cards (the ace of spades is best)',
      'The other half goes to the best five-card hand',
      'With no spade in the hole among the players left, the best hand takes it all',
      'Wild cards count only as what they are for the spade',
    ],
    ranking: 'high',
  },
  'low-chicago': {
    summary: 'Seven-Card Stud where the lowest spade in the hole wins half the pot.',
    howToPlay: STUD_STREETS,
    winning: [
      'Half the pot goes to the player with the lowest spade among their face-down cards; aces are high, so the 2 of spades is best',
      'The other half goes to the best five-card hand',
      'With no spade in the hole among the players left, the best hand takes it all',
      'Wild cards count only as what they are for the spade',
    ],
    ranking: 'high',
  },
  'razz': {
    summary: 'Seven-Card Stud where the lowest hand wins.',
    howToPlay: [
      STUD_STREETS[0],
      'The highest card showing brings it in (aces are low)',
      'Three more cards face up, one at a time, with betting after each; from here the lowest hand showing acts first',
      STUD_STREETS[3],
    ],
    winning: [
      'The lowest five of your seven cards wins the whole pot',
      'Aces are low, straights and flushes don’t count, and pairs count against you',
      'The best hand is 5-4-3-2-A; there is no qualifier, so someone always wins',
    ],
    ranking: 'razz',
  },
  'five-card-stud': {
    summary: 'Five cards each: one face down and four face up.',
    howToPlay: [
      'Everyone antes, then gets one card face down and one face up',
      'The lowest card showing brings it in',
      'Three more cards face up, one at a time, with a round of betting after each; the best hand showing acts first',
    ],
    winning: ['The best five-card hand wins'],
    ranking: 'high',
  },
  'follow-the-queen': {
    summary: 'Seven-Card Stud with wild cards: queens, and whatever follows the last face-up queen.',
    howToPlay: STUD_STREETS,
    winning: [
      'Queens are always wild',
      'When a queen is dealt face up, the rank of the next face-up card is wild too; a later face-up queen replaces it',
      'If the last face-up card dealt is a queen, only queens are wild',
      'The best five-card hand wins; five of a kind is the top hand',
    ],
    ranking: 'high',
  },
  'baseball': {
    summary: 'Seven-Card Stud with 3s and 9s wild, and extra rules for 3s and 4s dealt face up.',
    howToPlay: [
      ...STUD_STREETS,
      'A 4 dealt face up gets you an extra card, face down',
      'A 3 dealt face up means you match the pot or fold',
    ],
    winning: ['3s and 9s are wild', 'The best five-card hand wins; five of a kind is the top hand'],
    ranking: 'high',
  },
  'midnight-baseball': {
    summary: 'Seven cards each, all face down, and nobody looks. 3s and 9s are wild.',
    howToPlay: [
      'Everyone antes and gets seven cards face down, without looking at them',
      'The first player turns cards face up one at a time; then, in turn, each player turns cards until they beat the best hand showing',
      'Each time someone takes the lead there is a round of betting',
      'Turn all your cards without beating the best hand and you are out',
      'A 4 turned up gets you an extra face-down card; a 3 turned up means match the pot or fold',
    ],
    winning: ['3s and 9s are wild', 'The best five-card hand wins; five of a kind is the top hand'],
    ranking: 'high',
  },
  'five-card-draw': {
    summary: 'Five cards each, all private. Bet, swap some cards, bet again.',
    howToPlay: [
      'Everyone antes and gets five cards face down',
      'A round of betting, starting after the button',
      'The draw: in turn, throw away up to 3 cards and get new ones (4 if the card you keep is an ace), or stand pat',
      'A second round of betting',
    ],
    winning: ['The best five-card hand wins'],
    ranking: 'high',
  },
  'nicaragua': {
    summary: "Five-Card Draw where whoever opens picks how the hand is won. A Dealer's Choice game that lasts until an opener wins.",
    howToPlay: [
      'Everyone gets five cards face down; the first hand of the game starts with an ante, later hands play for the pot carried over',
      'Whoever opens the betting picks how this hand is won: highest hand, lowest hand, highest count or lowest count',
      'The draw, as in Five-Card Draw, then a second round of betting',
      'If the opener doesn’t win, they pay the size of the pot into a new pot, and another hand is dealt',
      'The game ends when an opener wins; then the next player chooses the game',
    ],
    winning: [
      'Highest or lowest hand: the usual hand ranking, or ace-to-five low (aces low, straights and flushes don’t count)',
      'Highest or lowest count: add up your cards; picture cards are 10, aces 1 or 11',
    ],
    ranking: 'nicaragua',
  },
  'badugi': {
    summary: 'Four-card lowball with three draws. The best hand has four cards of different suits and ranks.',
    howToPlay: [
      'The two players after the button post the blinds, and everyone gets four cards face down',
      'A round of betting, then a draw: throw away any number of cards and get new ones',
      'Betting and a draw twice more, then a last round of betting',
    ],
    winning: [
      'Your hand is the most cards you hold with no two of the same suit or rank',
      'Four such cards (a badugi) beat three, three beat two, two beat one',
      'Between hands of the same size, the lowest wins, aces low; the best is A-2-3-4 of four suits',
    ],
    ranking: 'badugi',
  },
  'pass-the-trash': {
    summary: 'Seven cards each, all face down. Pass cards to the left, keep five, then turn them up one at a time.',
    howToPlay: [
      'Everyone antes and gets seven cards face down',
      'Pass 3 cards to the left, then bet; pass 2, then bet; pass 1, then bet. Everyone passes at the same time',
      'Keep five cards, choosing the order you will turn them up',
      'Turn one card up at a time, with a round of betting after each of the first four',
    ],
    winning: ['Once the fifth card is up, the best five-card hand wins'],
    ranking: 'high',
  },
  'guts': {
    summary: "Two cards each; everyone says in or out at the same time. A Dealer's Choice game that lasts until one player goes in alone.",
    howToPlay: [
      'Everyone gets two cards face down; the first hand of the game starts with an ante, later hands play for the pot carried over',
      'Everyone declares in or out at once; running out of time counts as out',
      'Nobody in: the pot carries to the next hand',
      'Several in: the best hand takes the pot, and each who lost pays the size of the pot, up to the table’s cap, into the next one',
      'One player in alone takes the pot and ends the game; then the next player chooses the game',
    ],
    winning: ['Only pairs and high cards count, aces high: a pair of aces is best, then any pair, then the highest card'],
    ranking: 'guts',
  },
};

/** What the betting mode means, in a sentence. */
export const BETTING_EXPLAINED: Record<BettingMode, string> = {
  'no-limit': 'No limit: you can bet or raise any amount, up to everything in front of you.',
  'pot-limit': 'Pot limit: the most you can bet or raise is the size of the pot.',
  'fixed-limit': 'Fixed limit: bets and raises are a set size, the small bet in the early rounds and the big bet (twice as much) later, with at most four bets a round.',
};

/** What the table's wild cards are. */
export const WILD_EXPLAINED: Partial<Record<WildRule, string>> = {
  'deuces': 'Deuces wild: every 2 counts as whatever card makes your hand best. Five of a kind is the top hand.',
  'one-eyed-jacks': 'One-eyed jacks wild: the jack of spades and the jack of hearts count as whatever card makes your hand best. Five of a kind is the top hand.',
};

// The standard ranking, best first, each with an example
export const HIGH_HANDS: Array<{ name: string; example: string }> = [
  { name: 'Five of a kind', example: '9 9 9 9 + a wild (wild-card games only)' },
  { name: 'Straight flush', example: '9 8 7 6 5, all one suit (A K Q J 10 is a royal flush)' },
  { name: 'Four of a kind', example: 'K K K K 3' },
  { name: 'Full house', example: '8 8 8 4 4' },
  { name: 'Flush', example: 'Any five of one suit' },
  { name: 'Straight', example: '10 9 8 7 6 (A 2 3 4 5 counts too)' },
  { name: 'Three of a kind', example: '7 7 7 K 2' },
  { name: 'Two pair', example: 'J J 4 4 9' },
  { name: 'One pair', example: '10 10 A 6 3' },
  { name: 'High card', example: 'A J 8 5 2' },
];

/** A game's rules; undefined for anything that isn't one game, such as Dealer's Choice. */
export function gameRulesFor(variant?: string | null): GameRules | undefined {
  return variant ? GAME_RULES[variant as GameVariant] : undefined;
}
