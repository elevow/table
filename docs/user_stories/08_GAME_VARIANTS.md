# Game Variants User Stories

## Omaha Implementation

### US-051: Omaha Core Rules
As a player,
I want to play Omaha poker according to standard rules,
So that I can enjoy this poker variant with my friends.

**Acceptance Criteria:**
- Deal four hole cards to each player
- Enforce using exactly two hole cards
- Follow standard betting rounds
- Support pot-limit betting structure
- Calculate winning hands correctly

**Technical Notes:**
```typescript
interface OmahaGame extends BaseGame {
  variant: 'omaha';
  holeCards: Card[]; // Always 4 cards
  bettingStructure: 'pot-limit' | 'no-limit';
  handEvaluator: OmahaHandEvaluator;
}

interface OmahaHandEvaluator {
  evaluateHand(holeCards: Card[], communityCards: Card[]): HandStrength;
  validateHandCombination(usedHoleCards: Card[]): boolean; // Must be exactly 2
}
```

### US-052: Omaha Hi-Lo Implementation
As a player,
I want to play Omaha Hi-Lo variant,
So that I can compete for both high and low hands.

**Acceptance Criteria:**
- Support 8-or-better qualification for low hands
- Split pots between high and low hands
- Handle no qualifying low hand scenarios
- Support player declarations
- Show both high and low hand results

**Technical Notes:**
```typescript
interface OmahaHiLoGame extends OmahaGame {
  variant: 'omaha-hi-lo';
  lowHandQualifier: 8; // 8-or-better
  potSplits: {
    high: number;
    low: number | null; // null if no qualifying low
  };
}

interface HiLoHandEvaluation {
  highHand: HandStrength;
  lowHand: LowHandStrength | null;
  qualified: boolean;
}
```

## Seven-card Stud Implementation

### US-053: Stud Core Mechanics
As a player,
I want to play Seven-card Stud according to standard rules,
So that I can enjoy this classic poker variant.

**Acceptance Criteria:**
- Deal initial 2 down, 1 up cards
- Proper betting round sequence
- Deal subsequent up cards
- Deal final down card
- Track exposed cards for each player

**Technical Notes:**
```typescript
interface StudGame extends BaseGame {
  variant: 'seven-card-stud';
  playerCards: Map<PlayerId, {
    downCards: Card[];
    upCards: Card[];
  }>;
  bringIn: {
    amount: number;
    player: PlayerId;
  };
}

interface StudStreet {
  name: 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh';
  dealtCards: 'up' | 'down';
  bettingLimits: BettingLimits;
}
```

### US-054: Stud Hi-Lo Implementation
As a player,
I want to play Seven-card Stud Hi-Lo variant,
So that I can compete for both high and low hands.

**Acceptance Criteria:**
- Support 8-or-better qualification
- Track high and low possibilities
- Handle split pots
- Support player declarations
- Show both hand results

**Technical Notes:**
```typescript
interface StudHiLoGame extends StudGame {
  variant: 'seven-card-stud-hi-lo';
  lowHandQualifier: 8;
  declarations: Map<PlayerId, 'high' | 'low' | 'both'>;
  potSplits: {
    high: PotShare[];
    low: PotShare[] | null;
  };
}
```

### US-055: Razz Implementation
As a player,
I want to play Razz (Seven-card Stud Low),
So that I can compete in a low-hand only game.

**Acceptance Criteria:**
- Deal cards according to Stud rules
- Evaluate for lowest possible hand
- Handle straights and flushes correctly
- Support proper betting structure
- Show hand strengths appropriately

**Technical Notes:**
```typescript
interface RazzGame extends StudGame {
  variant: 'razz';
  handEvaluator: LowHandEvaluator;
  bettingStructure: 'fixed-limit';
}

interface LowHandEvaluator {
  evaluateHand(cards: Card[]): LowHandStrength;
  compareHands(hand1: Card[], hand2: Card[]): -1 | 0 | 1;
}
```

## Variant-Specific UI Elements

### US-056: Variant-Specific Controls
As a player,
I want appropriate UI controls for each poker variant,
So that I can make variant-specific decisions easily.

**Acceptance Criteria:**
- Show relevant betting options
- Display appropriate hand information
- Provide variant-specific declarations
- Support variant rules help
- Adapt to mobile screens

**Technical Notes:**
```typescript
interface VariantUI {
  variant: GameVariant;
  controls: UIControl[];
  displays: UIDisplay[];
  helpContent: VariantHelp;
  mobileLayout: MobileAdaptation;
}

interface UIControl {
  type: 'button' | 'slider' | 'toggle' | 'declaration';
  variantSpecific: boolean;
  visibility: VisibilityRule[];
  action: GameAction;
}
```
