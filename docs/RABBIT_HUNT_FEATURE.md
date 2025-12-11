# Rabbit Hunt Feature

## Overview

The Rabbit Hunt feature allows players to see what cards would have been dealt if the hand had continued after everyone except one player folded. This satisfies player curiosity about "what could have been" and adds an interesting post-hand analysis element to the game.

## User Story

**As a player,**
I want to see the cards that would have come after a fold,
So that I can satisfy my curiosity about the outcome.

## Implementation

### Backend (Already Implemented)

The backend infrastructure was already in place:
- API endpoints: `/api/rabbit-hunt/preview`, `/api/rabbit-hunt/request`, `/api/rabbit-hunt/list`, `/api/rabbit-hunt/cooldown`
- `PokerEngine` methods: `previewRabbitHunt()` and `prepareRabbitPreview()`
- `RabbitHuntService` for business logic
- Database tables for rabbit hunt records and cooldowns
- Comprehensive test coverage (50 tests passing)

### Frontend (Newly Implemented)

Added UI integration in the game page (`pages/game/[id].tsx`):

1. **State Management**
   - `rabbitHuntLoading`: Tracks loading state during API calls
   - `rabbitHuntError`: Stores error messages
   - `rabbitHuntResult`: Stores the revealed cards
   - `rabbitHuntCooldown`: Tracks cooldown status

2. **UI Components**
   - Buttons to show Flop, Turn, or River cards (based on current game state)
   - Display of revealed cards with proper card rendering
   - Error and cooldown message display
   - Integrated into the win-by-fold banner

3. **User Flow**
   - When a hand ends with only one player remaining (win-by-fold), the rabbit hunt UI appears
   - Players can click buttons to reveal Flop (if not dealt), Turn (if flop was dealt), or River
   - The revealed cards are displayed with the same styling as community cards
   - Cooldown messages prevent excessive usage
   - State resets when a new hand starts

## How to Test

### Prerequisites
1. Set up a local development environment with the database running
2. Start the development server: `npm run dev`
3. Create a game room and have at least 2 players join

### Test Scenario 1: Preflop Fold
1. Start a hand with 2+ players
2. Have all players except one fold before the flop
3. Observe the "wins the pot" message with rabbit hunt buttons
4. Click "Show Flop" to see what the flop would have been
5. Click "Show Turn" or "Show River" to see additional cards
6. Verify cards are displayed correctly

### Test Scenario 2: Post-Flop Fold
1. Start a hand and let the flop be dealt normally
2. Have all players except one fold after the flop
3. Observe the rabbit hunt section
4. Click "Show Turn" to see what the turn would have been
5. Click "Show River" to see the river card
6. Verify only undealt streets are available

### Test Scenario 3: Cooldown
1. Perform a rabbit hunt
2. Immediately try to perform another rabbit hunt
3. Verify the cooldown message appears
4. Wait for cooldown to expire (60 seconds)
5. Verify rabbit hunt works again

## API Details

### GET /api/rabbit-hunt/preview
**Query Parameters:**
- `roomId`: The game room ID
- `street`: 'flop', 'turn', or 'river'
- `userId`: The requesting user's ID
- `communityCards`: Comma-separated list of already-dealt cards (optional)

**Response:**
```json
{
  "street": "flop",
  "revealedCards": ["Ah", "Kd", "Qs"],
  "remainingDeck": ["2c", "3h", ...]
}
```

## Technical Details

### Card Format Conversion
- Database/API format: "Ah" (rank + suit first letter)
- Internal format: `{ rank: 'A', suit: 'hearts' }`
- The UI handles conversion automatically

### Cooldown System
- Default cooldown: 60 seconds per user
- Tracked in `feature_cooldowns` table
- Enforced on both client and server side

### Integration Points
1. **Game State**: Uses `pokerGameState.communityCards` to determine which streets can be revealed
2. **Player Context**: Uses `playerId` for authentication and cooldown tracking
3. **Room Context**: Uses room ID to fetch the current game engine state

## Future Enhancements

Potential improvements for future iterations:
1. **Group Rabbit Hunt**: Allow all players to vote on revealing cards
2. **Animation**: Add card flip animations when revealing
3. **Statistics**: Track rabbit hunt usage in game analytics
4. **Cost System**: Optional chip cost for rabbit hunts (configurable per room)
5. **History**: Show previous rabbit hunts in a hand history view

## Files Modified

- `pages/game/[id].tsx`: Added rabbit hunt state, handler function, and UI components

## Testing

All existing tests continue to pass:
- 50 rabbit hunt-specific tests ✅
- 244 game-related tests ✅
- Build succeeds ✅

No regressions introduced.
