import { VariantUI, GameVariant, UIControl } from '../../types/variant-ui';

const commonControls = {
  bet: { type: 'slider', label: 'Bet/Raise', variantSpecific: false } as UIControl,
  check: { type: 'button', label: 'Check', variantSpecific: false } as UIControl,
  fold: { type: 'button', label: 'Fold', variantSpecific: false, action: 'fold' } as UIControl,
} as const;

export const VARIANT_UI_REGISTRY: Record<GameVariant, VariantUI> = {
  'texas-holdem': {
    variant: 'texas-holdem',
    controls: [
      commonControls.bet,
      commonControls.check,
      commonControls.fold,
    ],
    displays: [
      { type: 'hand-info' },
      { type: 'pot-split' },
    ],
    helpContent: {
      title: 'Texas Hold’em',
      summary: 'Make the best 5-card hand using your two hole cards and five community cards.',
      bullets: ['No-limit or pot-limit betting', 'Four betting rounds', 'Showdown on river if multiple players remain'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'omaha': {
    variant: 'omaha',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [{ type: 'hand-info' }, { type: 'pot-split' }],
    helpContent: {
      title: 'Omaha',
      summary: 'Use exactly 2 of your 4 hole cards with 3 community cards to make the best hand.',
      bullets: ['Pot-limit by default', 'Four betting rounds', 'Exactly two hole cards must be used'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'omaha-hi-lo': {
    variant: 'omaha-hi-lo',
    controls: [
      commonControls.bet,
      commonControls.check,
      commonControls.fold,
      { type: 'declaration', label: 'Declare High', variantSpecific: true, visibility: [{ requiresDeclaration: true }], action: 'declare-high' },
      { type: 'declaration', label: 'Declare Low', variantSpecific: true, visibility: [{ requiresDeclaration: true }], action: 'declare-low' },
      { type: 'declaration', label: 'Declare Both', variantSpecific: true, visibility: [{ requiresDeclaration: true }], action: 'declare-both' },
    ],
    displays: [
      { type: 'hand-info' },
      { type: 'pot-split' },
    ],
    helpContent: {
      title: 'Omaha Hi‑Lo (8 or Better)',
      summary: 'Pot can split between best high and qualifying low (8‑or‑better) hands.',
      bullets: ['Use exactly two hole cards', 'Low hand uses A‑5 ranking', 'Odd chips go to high side by house rule'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'seven-card-stud': {
    variant: 'seven-card-stud',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [
      { type: 'hand-info' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Seven‑Card Stud',
      summary: 'No community cards; players receive 7 cards (some exposed) and make the best 5‑card hand.',
      bullets: ['Bring‑in on third street', 'Betting rounds on each street', 'Final down card on seventh street'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'follow-the-queen': {
    variant: 'follow-the-queen',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [
      { type: 'hand-info' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Follow the Queen',
      summary: 'Seven‑card stud with wild cards: queens, and the rank of the card dealt face up after the last face‑up queen.',
      bullets: [
        'Each face‑up queen makes the next face‑up card’s rank wild, replacing the earlier one',
        'If the last face‑up card is a queen, only queens are wild',
        'Five of a kind is the top hand; always fixed limit',
      ],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'baseball': {
    variant: 'baseball',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [
      { type: 'hand-info' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Baseball',
      summary: 'Seven‑card stud with 3s and 9s wild.',
      bullets: [
        'A 4 dealt face up gets you an extra card, face down',
        'A 3 dealt face up means match the pot or fold',
        'Five of a kind is the top hand; always fixed limit, at most 6 players',
      ],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'midnight-baseball': {
    variant: 'midnight-baseball',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [
      { type: 'hand-info' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Midnight Baseball',
      summary: 'Seven cards each, all face down, and nobody looks. 3s and 9s are wild.',
      bullets: [
        'In turn, each player turns cards face up until they beat the high hand showing; then the high hand leads a round of betting',
        'Turn every card without beating it and you are out',
        'A 4 turned up gets you an extra face‑down card; a 3 turned up means match the pot or fold',
        'Five of a kind is the top hand; always fixed limit, at most 6 players',
      ],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'seven-card-stud-hi-lo': {
    variant: 'seven-card-stud-hi-lo',
    controls: [
      commonControls.bet,
      commonControls.check,
      commonControls.fold,
      { type: 'declaration', label: 'High', variantSpecific: true, visibility: [{ requiresDeclaration: true }], action: 'declare-high' },
      { type: 'declaration', label: 'Low', variantSpecific: true, visibility: [{ requiresDeclaration: true }], action: 'declare-low' },
      { type: 'declaration', label: 'Both', variantSpecific: true, visibility: [{ requiresDeclaration: true }], action: 'declare-both' },
    ],
    displays: [
      { type: 'hand-info' },
      { type: 'pot-split' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Seven‑Card Stud Hi‑Lo (8 or Better)',
      summary: 'High and qualifying low (8‑or‑better) split the pot; odd chips to high.',
      bullets: ['A‑5 low ranking', 'Declarations may be required depending on table rules', 'Side pots follow eligibility'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'five-card-stud': {
    variant: 'five-card-stud',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [
      { type: 'hand-info' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Five‑Card Stud',
      summary: 'No community cards; players receive 1 down and 4 up cards and make the best 5‑card hand.',
      bullets: ['Bring‑in on first betting round', 'Betting on each street', 'No final down card on last street'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'five-card-draw': {
    variant: 'five-card-draw',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [{ type: 'hand-info' }],
    helpContent: {
      title: 'Five‑Card Draw',
      summary: 'Five cards each, all private. Everyone antes; there is no board.',
      bullets: [
        'A round of betting, starting after the button',
        'The draw: in turn, swap up to 3 cards, or 4 if the card you keep is an ace',
        'A second round of betting, then the best five‑card hand wins',
      ],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'nicaragua': {
    variant: 'nicaragua',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [{ type: 'hand-info' }],
    helpContent: {
      title: 'Nicaragua',
      summary: "Five‑card draw where the opener picks how the hand is won. A Dealer's Choice game that lasts until an opener wins.",
      bullets: [
        'Whoever opens the betting picks: highest hand, lowest hand (ace‑to‑five), highest count or lowest count',
        'Counts: picture cards are 10, aces 1 or 11',
        'If the opener doesn’t win, they pay the size of the pot into a new one and another hand is dealt',
        'The game ends when an opener wins; then the next player chooses',
      ],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'guts': {
    variant: 'guts',
    controls: [commonControls.fold],
    displays: [{ type: 'hand-info' }],
    helpContent: {
      title: 'Guts',
      summary: "Two cards each; everyone declares in or out at the same time. A Dealer's Choice game that lasts until one player goes in alone.",
      bullets: [
        'Only pairs and high cards count, aces high',
        'The best hand among the players who went in takes the pot; each who lost pays the size of the pot, up to the cap, into the next one',
        'Nobody in: the pot carries to the next hand',
        'One player in alone takes the pot and ends the game; then the next player chooses',
      ],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'razz': {
    variant: 'razz',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [
      { type: 'hand-info' },
      { type: 'stud-exposed-cards' },
    ],
    helpContent: {
      title: 'Razz',
      summary: 'Seven‑card stud where the lowest hand wins the whole pot. Best hand: 5‑4‑3‑2‑A.',
      bullets: ['Aces are low; straights and flushes do not count', 'Pairs count against you; no qualifier', 'Highest up card brings it in; lowest showing hand acts first after that', 'Fixed limit by default'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
  'omaha-5': {
    variant: 'omaha-5',
    controls: [commonControls.bet, commonControls.check, commonControls.fold],
    displays: [{ type: 'hand-info' }, { type: 'pot-split' }],
    helpContent: {
      title: '5‑Card Omaha',
      summary: 'Omaha with five hole cards: use exactly 2 of them with 3 community cards.',
      bullets: ['Pot-limit by default', 'Four betting rounds', 'Exactly two hole cards must be used'],
    },
    mobileLayout: { compactControls: true, stackHelpBelow: true },
  },
};

export function getVariantUI(variant: GameVariant): VariantUI {
  return VARIANT_UI_REGISTRY[variant];
}
