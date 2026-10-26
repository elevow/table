import type { BettingMode as EngineBettingMode, GameVariant } from '../../types/poker';

type PokerVariant =
  | GameVariant
  | 'dealers-choice'
  // Mixed games: a list of games played in turn (see variant-rules)
  | 'mixed';

type BettingMode = EngineBettingMode;

export function defaultBettingModeForVariant(variant: PokerVariant): BettingMode {
  switch (variant) {
    case 'omaha':
    case 'omaha-hi-lo':
    case 'omaha-5':
      return 'pot-limit';
    case 'razz':
      // Razz is a limit game; it is new, so there is no existing default to keep
      return 'fixed-limit';
    case 'seven-card-stud':
    case 'seven-card-stud-hi-lo':
    case 'five-card-stud':
      // Stud is traditionally a limit game, but existing stud rooms and dealer's choice hands
      // have always defaulted to no-limit, so that stays; rooms can pick fixed limit explicitly
      return 'no-limit';
    case 'texas-holdem':
    case 'dealers-choice':
    case 'mixed':
    default:
      return 'no-limit';
  }
}

export function resolveVariantAndMode(options: {
  variant?: string;
  bettingMode?: string;
}): { variant: PokerVariant; bettingMode: BettingMode } {
  const variant = (options.variant || 'texas-holdem') as PokerVariant;
  const defaultMode = defaultBettingModeForVariant(variant);
  const bettingMode = (options.bettingMode || defaultMode) as BettingMode;

  return { variant, bettingMode };
}
