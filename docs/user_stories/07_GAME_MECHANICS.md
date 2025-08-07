# Game Mechanics User Stories

## Core Poker Engine

### US-025: Basic Game Flow
As a player,
I want the game to follow standard poker hand progression,
So that I can play a complete hand of poker according to official rules.

**Acceptance Criteria:**
- Pre-game setup with position assignments
- Correct blind postings
- Proper dealing of hole cards
- Community card dealing in correct sequence
- Proper betting round progression
- Accurate showdown evaluation

**Technical Notes:**
```typescript
interface GameFlow {
  stage: 'setup' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  positions: Map<string, number>;
  blinds: { small: number; big: number };
  button: number;
  activePlayer: string;
  pot: number;
  currentBet: number;
}
```

### US-026: Hand Rankings
As a player,
I want my hand to be correctly evaluated against other players,
So that the right winner is determined at showdown.

**Acceptance Criteria:**
- Implement all poker hand rankings
- Handle ties correctly
- Support high card comparisons
- Calculate kickers properly
- Support split pot scenarios

**Technical Notes:**
```typescript
interface HandRanking {
  rank: number;
  name: string;
  cards: Card[];
  kickers: Card[];
  strength: number;
}

enum HandRank {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
  RoyalFlush = 10
}
```

## Betting Structures

### US-027: No-Limit Betting
As a player,
I want to be able to bet any amount up to my stack size,
So that I can employ various betting strategies.

**Acceptance Criteria:**
- Allow bets up to player's entire stack
- Enforce minimum bet equal to big blind
- Validate minimum raise amounts
- Handle all-in scenarios
- Calculate side pots correctly

**Technical Notes:**
```typescript
interface BettingAction {
  type: 'bet' | 'raise' | 'call' | 'fold';
  amount: number;
  isAllIn: boolean;
  playerId: string;
}

interface BettingLimits {
  minBet: number;
  minRaise: number;
  maxBet: number;
  currentBet: number;
}
```

### US-028: Pot-Limit Betting
As a player,
I want pot-limit betting rules enforced correctly,
So that I can't bet more than the current pot size.

**Acceptance Criteria:**
- Calculate maximum bet based on pot size
- Include all calls in pot size calculation
- Announce pot size on request
- Validate bet amounts against pot limit
- Handle all-in bets under limit

**Technical Notes:**
```typescript
interface PotLimitCalc {
  currentPot: number;
  pendingBets: number;
  pendingCalls: number;
  maxBet: number;
}
```

## Special Features

### US-029: Run it Twice Implementation
As a player involved in an all-in situation,
I want to run the board multiple times,
So that I can reduce variance in big pots.

**Acceptance Criteria:**
- Detect valid all-in situations
- Get unanimous agreement from players
- Deal remaining cards multiple times
- Split pot equally between runs
- Support 2-4 runs
- Maintain separate deck/RNG per run

**Technical Notes:**
```typescript
interface RunItTwice {
  enabled: boolean;
  numberOfRuns: number;
  boards: Board[];
  results: RunResult[];
  potDistribution: PotSplit[];
  seeds: string[]; // RNG seeds
}

interface RunResult {
  boardId: string;
  winner: string;
  winningHand: HandRanking;
  potShare: number;
}
```

### US-030: Run it Twice RNG Security
As a system administrator,
I want to ensure the integrity of multiple board runs,
So that players can trust the fairness of the feature.

**Acceptance Criteria:**
- Generate unique seed per board
- Use hardware-based entropy source
- Implement verifiable random function
- Maintain audit trail per board
- Provide seed verification system

**Technical Notes:**
```typescript
interface RNGSecurity {
  seedGeneration: {
    entropy: Buffer;
    timestamp: number;
    playerEntropy: string;
    vrf: string;
  };
  verification: {
    publicSeed: string;
    hashChain: string[];
    proof: string;
  };
}
```

### US-031: Rabbit Hunting
As a player,
I want to see the cards that would have come after a fold,
So that I can satisfy my curiosity about the outcome.

**Acceptance Criteria:**
- Enable post-hand card reveals
- Preserve remaining deck state
- Allow street selection for reveal
- Implement cooldown system
- Track usage history

**Technical Notes:**
```typescript
interface RabbitHunt {
  handId: string;
  remainingDeck: Card[];
  revealedCards: {
    street: 'flop' | 'turn' | 'river';
    cards: Card[];
  };
  cooldown: {
    lastUsed: Date;
    nextAvailable: Date;
  };
}
```

## Game State Management

### US-032: Disconnection Handling
As a player,
I want my game state preserved during disconnection,
So that I can rejoin and continue playing without loss.

**Acceptance Criteria:**
- Implement reconnection grace period
- Execute auto-actions on timeout
- Preserve hand history
- Maintain stack amounts
- Keep position in game

**Technical Notes:**
```typescript
interface DisconnectionState {
  playerId: string;
  graceTime: number;
  autoAction: {
    type: 'fold' | 'check-fold';
    executeAt: Date;
  };
  preservedStack: number;
  position: number;
  reconnectBy: Date;
}
```

### US-033: Multi-Way All-in Resolution
As a dealer,
I want to correctly handle multi-way all-in situations,
So that side pots are created and resolved properly.

**Acceptance Criteria:**
- Calculate main and side pots
- Handle partial calls
- Track pot eligibility
- Resolve pots in correct order
- Support Run it Twice for eligible pots

**Technical Notes:**
```typescript
interface PotResolution {
  mainPot: {
    amount: number;
    eligiblePlayers: string[];
  };
  sidePots: {
    amount: number;
    eligiblePlayers: string[];
  }[];
  runItTwice: boolean;
  potResults: PotResult[];
}
```

### US-034: Time Bank System
As a player,
I want access to additional decision time when needed,
So that I can think through complex situations.

**Acceptance Criteria:**
- Allocate initial time bank
- Show time bank remaining
- Allow time bank usage
- Implement replenishment rules
- Execute auto-actions when time expires

**Technical Notes:**
```typescript
interface TimeBank {
  initialAmount: number;
  currentAmount: number;
  replenishAmount: number;
  replenishInterval: number;
  lastReplenished: Date;
  isActive: boolean;
  autoAction?: PlayerAction;
}
```
