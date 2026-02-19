# Turn Polling System

## Overview

The turn polling system provides a redundant mechanism for notifying players when it's their turn to act. It works alongside the existing Supabase Realtime notifications to ensure players are notified even if websocket messages are missed due to network issues or client disconnections.

## Architecture

### Components

1. **API Endpoint**: `/api/games/check-turn`
   - Lightweight endpoint that returns minimal turn status information
   - Significantly faster than fetching full game state
   - Returns: `{ isMyTurn: boolean, activePlayer: string, tableState: string, handNumber: number }`

2. **React Hook**: `useCheckTurn`
   - Custom hook that polls the API at configurable intervals (default: 10 seconds)
   - Automatically enables/disables based on game state
   - Provides turn status and error handling
   - Calls optional `onTurnChange` callback when turn status changes

3. **Integration**: Game page (`pages/game/[id].tsx`)
   - Polls only when player is seated and waiting for their turn
   - Fetches full game state when polling detects it's now the player's turn
   - Stops polling when it becomes the player's turn or when not seated

## Usage

### Basic Usage

```typescript
import { useCheckTurn } from '../hooks/useCheckTurn';

function GameComponent({ tableId, playerId }) {
  const { turnStatus, isLoading, error } = useCheckTurn(tableId, playerId, {
    enabled: true,
    interval: 10000, // Poll every 10 seconds
    onTurnChange: (status) => {
      console.log('Turn changed:', status);
      // Optionally fetch full game state or update UI
    }
  });

  if (turnStatus?.isMyTurn) {
    return <div>It's your turn!</div>;
  }

  return <div>Waiting for {turnStatus?.activePlayer}...</div>;
}
```

### Configuration Options

```typescript
interface UseCheckTurnOptions {
  /** Enable/disable polling. Default: true */
  enabled?: boolean;
  
  /** Polling interval in milliseconds. Default: 10000 (10 seconds) */
  interval?: number;
  
  /** Callback invoked when turn status changes */
  onTurnChange?: (status: TurnStatus) => void;
}
```

### Return Value

```typescript
{
  turnStatus: TurnStatus | null;  // Current turn status
  isLoading: boolean;              // Whether a check is in progress
  error: string | null;            // Last error message, if any
  checkNow: () => Promise<void>;   // Manually trigger a check
}
```

## Design Decisions

### Why Polling Instead of WebSockets Only?

While the application primarily uses Supabase Realtime (websockets), polling provides several benefits:

1. **Redundancy**: Ensures turn notifications even if websocket messages are lost
2. **Reconnection**: Players who reconnect mid-hand get turn status updates
3. **Network Issues**: Works even with spotty connections where websockets may fail
4. **Simple Implementation**: No additional infrastructure required
5. **Minimal Load**: Only polls when waiting (not when it's your turn)

### Performance Optimizations

1. **Lightweight Endpoint**: Returns minimal data instead of full game state
2. **Conditional Polling**: Only polls when player is seated and waiting
3. **Auto-Disable**: Stops polling when it becomes player's turn
4. **Concurrent Check Prevention**: Prevents multiple simultaneous API calls
5. **Error Recovery**: Continues polling after errors (with exponential backoff potential)

### Alternative Approaches Considered

1. **Server-Sent Events (SSE)**: Would require infrastructure changes
2. **Long Polling**: Would increase server load significantly
3. **Increased Websocket Reconnection**: May not solve all edge cases
4. **Pure Event-Driven**: Less reliable in poor network conditions

## Implementation Details

### Polling Logic

```
Player joins game → Sits at table → Game starts
  ↓
  Is it my turn?
    YES → Stop polling, enable actions
    NO  → Start polling every 10 seconds
  ↓
Poll detects turn change
  ↓
Fetch full game state (includes hole cards)
  ↓
Update UI, stop polling
```

### Integration with Realtime

- Polling complements (does not replace) Supabase Realtime
- Both systems can trigger state updates
- Sequence numbers prevent out-of-order updates
- Realtime updates are instant, polling is fallback

## Testing

### Unit Tests

- API endpoint: 10 tests covering all scenarios
- Hook: 10 tests covering polling, errors, and lifecycle

### Test Coverage

```bash
# Run API tests
npm test -- src/pages-api/__tests__/check-turn-api.test.ts

# Run hook tests
npm test -- src/hooks/__tests__/useCheckTurn.test.ts
```

## Monitoring

### Client-Side Logs

The hook logs important events:
- `🔔 Turn status changed via polling:` - Turn detected via polling
- `🔔 Polling detected our turn, fetching latest game state...` - Full state fetch triggered
- `[useCheckTurn] Error:` - Polling errors

### API Endpoint Logs

The endpoint logs errors:
- `Error checking turn status:` - Server-side errors

## Future Improvements

1. **Exponential Backoff**: Increase interval after consecutive errors
2. **Adaptive Polling**: Adjust interval based on game pace
3. **Metrics**: Track polling effectiveness and error rates
4. **Connection Quality**: Adjust polling based on connection quality
5. **Push Notifications**: Mobile app notifications for turn changes

## Troubleshooting

### Player doesn't receive turn notification

1. Check browser console for polling errors
2. Verify player is seated (`currentPlayerSeat !== null`)
3. Check network tab for API calls to `/api/games/check-turn`
4. Ensure `enabled` prop is true when waiting

### Polling not stopping after turn

1. Check that `pokerGameState.activePlayer` matches `playerId`
2. Verify game state is being updated correctly
3. Check that `isWaitingForTurn` condition is evaluating correctly

### Too many API calls

1. Verify polling is disabled when it's player's turn
2. Check that multiple components aren't all polling
3. Ensure cleanup on unmount is working

## Related Documentation

- [Supabase Realtime Integration](./REALTIME.md)
- [Game State Management](./GAME_STATE.md)
- [API Routes](./API_ROUTES.md)
