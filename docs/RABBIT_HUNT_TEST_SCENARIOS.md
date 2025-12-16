# Rabbit Hunt Feature - Test Scenarios

## Scenario 1: Preflop Fold (All Streets Available)

### Setup
1. Start a poker game with 3 players
2. Each player is dealt hole cards
3. No community cards are dealt yet

### User Action
1. All players except one fold during preflop betting
2. Winner banner appears: "[Player Name] wins the pot"
3. Below the winner message, the rabbit hunt section appears with the text:
   "Rabbit Hunt - See what would have come:"
4. Three buttons are visible:
   - "Show Flop" (green button)
   - "Show Turn" (green button)  
   - "Show River" (green button)

### Expected Behavior
1. Click "Show Flop":
   - Button changes to "..." during loading
   - Three cards appear in a card display below the buttons
   - Cards are rendered with rank and suit (e.g., A♥, K♦, Q♠)
   - Cards use the same styling as community cards in the game

2. Click "Show Turn":
   - One additional card appears
   - Total of 4 cards now visible

3. Click "Show River":
   - One final card appears
   - Total of 5 cards now visible

### Visual Appearance
```
┌─────────────────────────────────────────┐
│ [Player Name] wins the pot              │
│                                         │
│ Rabbit Hunt - See what would have come: │
│ [Show Flop] [Show Turn] [Show River]   │
│                                         │
│ Revealed Flop Cards:                    │
│ ┌───┐ ┌───┐ ┌───┐                      │
│ │ A │ │ K │ │ Q │                      │
│ │ ♥ │ │ ♦ │ │ ♠ │                      │
│ └───┘ └───┘ └───┘                      │
└─────────────────────────────────────────┘
```

## Scenario 2: Post-Flop Fold (Partial Streets)

### Setup
1. Game progresses to flop
2. Three community cards are dealt: [7♥, 8♦, 9♣]
3. All players except one fold

### Expected Behavior
1. Only "Show Turn" and "Show River" buttons appear (no "Show Flop")
2. Current community cards (7♥, 8♦, 9♣) are visible in the main game area
3. Clicking "Show Turn" reveals what the turn card would have been
4. Clicking "Show River" reveals what the river card would have been

### Visual Appearance
```
┌─────────────────────────────────────────┐
│ [Player Name] wins the pot              │
│                                         │
│ Rabbit Hunt - See what would have come: │
│ [Show Turn] [Show River]                │
└─────────────────────────────────────────┘
```

## Scenario 3: Post-Turn Fold (Single Street)

### Setup
1. Game progresses through flop and turn
2. Four community cards are dealt: [7♥, 8♦, 9♣, J♠]
3. All players except one fold

### Expected Behavior
1. Only "Show River" button appears
2. Clicking it reveals the final card

### Visual Appearance
```
┌─────────────────────────────────────────┐
│ [Player Name] wins the pot              │
│                                         │
│ Rabbit Hunt - See what would have come: │
│ [Show River]                            │
└─────────────────────────────────────────┘
```

## Scenario 4: Cooldown Handling

### Setup
1. Player successfully performs a rabbit hunt
2. A new hand starts and ends with a fold
3. Same player tries to perform another rabbit hunt within 60 seconds

### Expected Behavior
1. Buttons are still visible and clickable
2. Upon clicking, an error message appears:
   "Feature on cooldown" (in amber/yellow text)
3. After 60 seconds, the player can use rabbit hunt again

### Visual Appearance (During Cooldown)
```
┌─────────────────────────────────────────┐
│ [Player Name] wins the pot              │
│                                         │
│ Rabbit Hunt - See what would have come: │
│ [Show Flop] [Show Turn] [Show River]   │
│                                         │
│ ⚠ Feature on cooldown                   │
└─────────────────────────────────────────┘
```

## Scenario 5: Error Handling

### Setup
1. Network issue or API error occurs during rabbit hunt request

### Expected Behavior
1. Error message appears in red text below the buttons
2. Example: "Failed to preview cards"
3. User can try again once issue is resolved

### Visual Appearance
```
┌─────────────────────────────────────────┐
│ [Player Name] wins the pot              │
│                                         │
│ Rabbit Hunt - See what would have come: │
│ [Show Flop] [Show Turn] [Show River]   │
│                                         │
│ ✗ Failed to preview cards               │
└─────────────────────────────────────────┘
```

## Scenario 6: Regular Showdown (No Rabbit Hunt)

### Setup
1. Hand proceeds to showdown with 2+ players
2. Winner is determined by hand ranking

### Expected Behavior
1. NO rabbit hunt section appears
2. Only the winner announcement is shown
3. Rabbit hunt is only available when hand ends by fold

### Visual Appearance
```
┌─────────────────────────────────────────┐
│ [Player Name] wins the pot (Full House) │
└─────────────────────────────────────────┘
```

## Scenario 7: State Reset on New Hand

### Setup
1. Player performs a rabbit hunt and sees revealed cards
2. Next hand starts

### Expected Behavior
1. All rabbit hunt state is cleared
2. Revealed cards from previous hand disappear
3. If new hand ends with a fold, fresh rabbit hunt buttons appear
4. No lingering state from previous rabbit hunt

## Dark Mode Compatibility

All scenarios should work correctly in both light and dark modes:

### Light Mode Colors
- Background: emerald-50 (light green)
- Border: emerald-300
- Text: emerald-900
- Buttons: emerald-600 (hover: emerald-700)
- Error text: red-600
- Warning text: amber-600

### Dark Mode Colors
- Background: emerald-900/30 (dark green with transparency)
- Border: emerald-700
- Text: emerald-100
- Buttons: emerald-500 (hover: emerald-600)
- Error text: red-400
- Warning text: amber-400

## Accessibility

1. All buttons have proper hover states
2. Disabled state during loading (opacity 50%)
3. Proper contrast ratios for text
4. Card symbols use Unicode characters (♥♦♣♠)
5. High contrast card mode is supported (uses highContrastCards setting)

## Integration Points

1. **State Trigger**: Feature activates when `getActiveNonFoldedPlayers().length === 1`
2. **Street Detection**: Based on `pokerGameState?.communityCards.length`
3. **API Call**: Uses `/api/rabbit-hunt/preview` with room ID, street, user ID, and community cards
4. **Card Format**: Converts between "Ah" (API) and `{rank: 'A', suit: 'hearts'}` (UI)
5. **Style Consistency**: Uses same card rendering as rest of game (8px width, 12px height, rounded borders)

## Performance Considerations

1. Loading state prevents double-clicks
2. State cleanup on unmount prevents memory leaks
3. API calls are debounced through loading state
4. Minimal re-renders (only when state changes)

## Security Notes

1. User ID is required for authentication
2. Cooldown enforced on both client and server
3. Room access validated on server
4. No sensitive game state exposed (only unused cards)
