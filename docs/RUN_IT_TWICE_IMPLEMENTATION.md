# Run-It-Twice (RIT) Implementation

## Overview
Run-It-Twice functionality has been fully implemented in the poker engine and UI, allowing the remaining board cards to be dealt multiple times after an all-in situation, with each run awarding a portion of the pot.

## Features Implemented

### 1. Core Engine Logic (`src/lib/poker/poker-engine.ts`)
- **`executeRunItTwice()` method**: Handles the complete RIT flow
  - Deals remaining community cards for each run using separate deck instances
  - Preserves shared cards (cards dealt before all-in)
  - Evaluates winners independently for each run
  - Splits pot evenly across runs (e.g., 2 runs = 50% per run)
  - **Handles ties within each run**: If multiple players tie in a single run, the run's pot share is split equally among tied winners
  - Distributes winnings and updates player stacks
  - Clears pot and current bets
  - Preserves chip conservation (total chips remain constant)

### 2. Stage-Specific Board Dealing
The implementation correctly handles RIT based on when the all-in occurred:

#### Pre-Flop All-In
- **Shared cards**: None
- **Per-run cards**: Full 5-card board (flop, turn, river)
- **Example**: Player A goes all-in pre-flop, RIT enabled with 2 runs
  - Run 1: Deal 5 cards → Evaluate winner → Award 50% of pot
  - Run 2: Deal different 5 cards → Evaluate winner → Award remaining 50%

#### Post-Flop All-In
- **Shared cards**: The 3 flop cards
- **Per-run cards**: Turn and river (2 cards)
- **Example**: All-in on flop (A♥ K♦ Q♣), RIT enabled
  - Run 1: Use A♥ K♦ Q♣ + deal turn & river → Evaluate → Award 50%
  - Run 2: Use A♥ K♦ Q♣ + deal different turn & river → Evaluate → Award 50%

#### Post-Turn All-In
- **Shared cards**: The 4 cards (flop + turn)
- **Per-run cards**: River (1 card)
- **Example**: All-in on turn (A♥ K♦ Q♣ J♠), RIT enabled
  - Run 1: Use A♥ K♦ Q♣ J♠ + deal river → Evaluate → Award 50%
  - Run 2: Use A♥ K♦ Q♣ J♠ + deal different river → Evaluate → Award 50%

### 3. Tie Handling
**When multiple players tie within a single run**, the engine splits that run's pot share among all tied winners:

**Example**: 
- Pot: $300
- RIT: 2 runs ($150 per run)
- Run 1: Player A wins alone → Gets $150
- Run 2: Players B and C tie → Each gets $75 ($150 / 2)
- **Final distribution**: A: $150, B: $75, C: $75

### 4. UI Display (`pages/game/[id].tsx`)
Enhanced the game page to properly display RIT results:

- **Multiple Board Display**: Shows all boards stacked vertically with "Run 1", "Run 2", etc. labels
- **Shared vs. New Cards**: Visually preserves the shared portion (cards dealt before all-in) across all runs
- **Per-Run Winners**: Displays winners and pot shares for each individual run
- **Total Distribution**: Shows aggregate winnings per player across all runs
- **Tie Display**: Clearly shows when multiple players split a run's pot

```tsx
{/* RIT Results Banner */}
{pokerGameState.runItTwice?.results.map((res, idx) => (
  <div key={idx}>
    <div>Board {idx + 1}</div>
    {/* Display board cards */}
    {res.winners.map(w => (
      <div>{w.playerId}: +${w.potShare}</div>
    ))}
  </div>
))}
```

### 5. Pot Distribution with Odd Amounts
The engine handles odd pot amounts correctly:
- **Example**: Pot $101, 2 runs
  - Run 1: $51 (includes remainder)
  - Run 2: $50
  - **All $101 distributed, no chips lost**

### 6. Multiple Runs (3+)
While "Run-It-Twice" is the standard terminology, the implementation supports arbitrary numbers of runs:
- 3 runs: Pot split 3 ways (33.33% each)
- 4 runs: Pot split 4 ways (25% each)
- Remainder chips distributed to early runs

### 7. RNG Security & Determinism
- Each run uses a separate, deterministic seed
- Seeds can be verified for fairness
- Deck exclusions ensure no card duplication across runs or with known cards

## Types & Data Structures (`src/types/poker.ts`)

```typescript
export interface RunItTwice {
  enabled: boolean;
  numberOfRuns: number;
  seeds: string[];  // RNG seeds per run
  boards: Card[][]; // Full 5-card boards per run
  results: RunResult[];  // Winners and pot shares per run
  potDistribution: PotSplit[];  // Aggregate winnings per player
  rngSecurity?: RNGSecurity;  // VRF verification data
}

export interface RunResult {
  boardId: string;  // e.g., "run-1", "run-2"
  winners: Array<{
    playerId: string;
    winningHand: HandRanking;
    potShare: number;  // This run's pot portion (split if tied)
  }>;
}

export interface PotSplit {
  playerId: string;
  amount: number;  // Total won across all runs
}
```

## Testing

Comprehensive test suite in `src/lib/poker/__tests__/run-it-twice.test.ts` covering:

1. ✅ **Basic 2-run split**: Pot divided correctly, chip conservation verified
2. **Tie scenarios**: Multiple winners splitting a run's pot
3. **Pre-flop all-in**: Full 5-card boards dealt per run
4. **Post-flop all-in**: Shared flop, independent turn/river per run
5. **Post-turn all-in**: Shared flop+turn, independent river per run
6. **3+ runs**: Pot split across multiple runs
7. **Odd pot amounts**: Remainder distribution verified

## Usage

### Enable RIT in Engine
```typescript
const engine = new PokerEngine(tableId, players, smallBlind, bigBlind);
engine.startNewHand();

// Enable RIT with 2 runs and deterministic seeds
engine.enableRunItTwice(2, ['seed1', 'seed2']);

// Execute RIT (called automatically at showdown or manually for testing)
engine.runItTwiceNow();

const state = engine.getState();
console.log(state.runItTwice.results); // Per-run winners
console.log(state.runItTwice.potDistribution); // Total per player
```

### UI Integration
The game page automatically displays RIT results when `pokerGameState.runItTwice` is populated:
- Boards displayed with labels
- Winners and pot shares shown per run
- Total distribution summarized

## Future Enhancements

1. **Player Opt-In/Opt-Out**: Allow players to vote on RIT before execution
2. **Animation**: Animate dealing of multiple boards sequentially
3. **Hand History**: Store RIT details in database for review
4. **Statistics**: Track RIT usage and outcomes in player profiles

## References

- Engine Implementation: `src/lib/poker/poker-engine.ts` (lines 1049-1155)
- UI Display: `pages/game/[id].tsx` (community cards and showdown sections)
- Types: `src/types/poker.ts`
- Tests: `src/lib/poker/__tests__/run-it-twice.test.ts`
- Documentation: `docs/GAME_MECHANICS.md` (Run It Twice section)
