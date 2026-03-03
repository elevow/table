# Big Blinds Display Feature

## Overview

This feature allows players to view their stack sizes in Big Blinds (BB) instead of raw chip counts. This is a common preference in poker games as it provides better context for stack sizes relative to the blinds.

## Implementation Decision

**This is implemented as a Player Setting** rather than a Game Setting because:
- It's a personal display preference that doesn't affect game rules
- Different players at the same table may prefer different display modes
- It's consistent with other UI preferences like "Show Pot Odds" and "High Contrast Cards"

## Usage

### 1. GameSettings Component

The setting is available in the `GameSettings` component:

```typescript
interface GameSettings {
  // ... other settings
  showStackInBB: boolean; // true = show as BB, false = show as chips
}
```

### 2. Utility Functions

Use the `formatChips` utility function to display stack amounts:

```typescript
import { formatChips } from '../utils/chip-display';

// Format based on user preference
const displayStack = formatChips(
  player.stack,      // chip amount
  bigBlind,          // current big blind value
  settings.showStackInBB  // user preference
);

// Examples:
// formatChips(10000, 100, false) => "10,000"
// formatChips(10000, 100, true)  => "100.0 BB"
```

### 3. Example Integration

See `src/examples/bb-display-integration.tsx` for a complete example:

```typescript
import { PlayerStackDisplay } from '../examples/bb-display-integration';

<PlayerStackDisplay
  player={player}
  bigBlind={bigBlind}
  settings={gameSettings}
/>
```

## How It Works

1. **User Toggle**: Players can enable "Show Stack in Big Blinds" in the Game Settings panel
2. **Persistent Storage**: The preference is saved to localStorage per game
3. **Display Conversion**: When enabled, all stack displays show `X.X BB` format instead of raw chips
4. **Fallback**: If big blind is invalid (0 or negative), displays fall back to chip count

## Benefits

- **Better Context**: "100 BB" is more meaningful than "10,000 chips"
- **Tournament Play**: Essential for tournament strategy where blinds increase
- **Professional Standard**: Matches how poker is commonly discussed and analyzed
- **Personal Choice**: Each player can choose their preferred display mode

## Technical Details

- **Formatting**: Displays 1 decimal place by default (e.g., "100.0 BB")
- **Calculation**: BB = stack / bigBlind
- **Storage**: Saved in localStorage as `game_settings_{gameId}`
- **Type Safety**: Fully typed with TypeScript interfaces

## Testing

Comprehensive tests are provided:
- `src/utils/__tests__/chip-display.test.ts` - Utility function tests
- `src/components/__tests__/GameSettings.test.tsx` - Setting toggle tests
- `src/examples/__tests__/bb-display-integration.test.tsx` - Integration tests

Run tests with:
```bash
npm test -- chip-display
npm test -- GameSettings
```
