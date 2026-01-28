import { useEffect, useRef, useState } from 'react';

interface TurnStatus {
  isMyTurn: boolean;
  activePlayer: string;
  tableState: string;
  handNumber: number;
}

interface UseCheckTurnOptions {
  /** Polling interval in milliseconds. Default: 10000 (10 seconds) */
  interval?: number;
  /** Enable/disable polling. Default: true */
  enabled?: boolean;
  /** Callback when turn status changes */
  onTurnChange?: (status: TurnStatus) => void;
}

/**
 * Hook that polls the server to check if it's the player's turn.
 * 
 * This provides a fallback mechanism alongside Supabase Realtime notifications,
 * ensuring players are notified of their turn even if websocket messages are missed.
 * 
 * Polling automatically stops when it becomes the player's turn (to reduce load),
 * and resumes when the turn changes to someone else.
 * 
 * @param tableId - The table/room ID
 * @param playerId - The current player's ID
 * @param options - Configuration options
 * @returns Current turn status and loading/error states
 */
export function useCheckTurn(
  tableId: string | undefined,
  playerId: string | undefined,
  options: UseCheckTurnOptions = {}
) {
  const { interval = 10000, enabled = true, onTurnChange } = options;
  
  const [turnStatus, setTurnStatus] = useState<TurnStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const previousTurnStatusRef = useRef<TurnStatus | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCheckingRef = useRef(false);

  const checkTurn = async () => {
    // Prevent concurrent checks
    if (isCheckingRef.current) return;
    if (!tableId || !playerId) return;
    
    isCheckingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/games/check-turn?tableId=${encodeURIComponent(tableId)}&playerId=${encodeURIComponent(playerId)}`
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        const newStatus: TurnStatus = {
          isMyTurn: data.isMyTurn,
          activePlayer: data.activePlayer,
          tableState: data.tableState,
          handNumber: data.handNumber
        };
        
        setTurnStatus(newStatus);
        
        // Check if turn status changed
        const prev = previousTurnStatusRef.current;
        if (prev && (
          prev.isMyTurn !== newStatus.isMyTurn ||
          prev.activePlayer !== newStatus.activePlayer ||
          prev.handNumber !== newStatus.handNumber
        )) {
          onTurnChange?.(newStatus);
        }
        
        previousTurnStatusRef.current = newStatus;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to check turn status';
      setError(errorMsg);
      console.error('[useCheckTurn] Error:', errorMsg);
    } finally {
      setIsLoading(false);
      isCheckingRef.current = false;
    }
  };

  useEffect(() => {
    // Don't poll if disabled or missing required params
    if (!enabled || !tableId || !playerId) {
      return;
    }

    // Initial check
    checkTurn();

    // Set up polling interval
    const startPolling = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        checkTurn().then(() => {
          // Continue polling
          startPolling();
        });
      }, interval);
    };

    startPolling();

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [tableId, playerId, enabled, interval]);

  return {
    turnStatus,
    isLoading,
    error,
    /** Manually trigger a turn check (useful for testing or forced refresh) */
    checkNow: checkTurn
  };
}
