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
};

export function getVariantUI(variant: GameVariant): VariantUI {
  return VARIANT_UI_REGISTRY[variant];
}
