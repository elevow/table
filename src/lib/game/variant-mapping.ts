type PokerVariant = 
  | 'texas-holdem' 
  | 'omaha' 
  | 'omaha-hi-lo' 
  | 'seven-card-stud' 
  | 'seven-card-stud-hi-lo'
  | 'five-card-stud'
  | 'dealers-choice';

type BettingMode = 'no-limit' | 'pot-limit';

export function defaultBettingModeForVariant(variant: PokerVariant): BettingMode {
  switch (variant) {
    case 'omaha':
    case 'omaha-hi-lo':
      return 'pot-limit';
    case 'seven-card-stud':
    case 'seven-card-stud-hi-lo':
    case 'five-card-stud':
      // Stud games traditionally use limit betting, but engine only supports no-limit/pot-limit
      return 'no-limit';
    case 'texas-holdem':
    case 'dealers-choice':
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
