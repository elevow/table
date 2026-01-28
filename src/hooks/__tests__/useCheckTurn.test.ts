import { renderHook, waitFor } from '@testing-library/react';
import { useCheckTurn } from '../useCheckTurn';

// Mock fetch globally
global.fetch = jest.fn();

describe('useCheckTurn', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should not make requests when tableId or playerId is missing', () => {
    const { result } = renderHook(() => useCheckTurn(undefined, 'player1'));
    
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.turnStatus).toBeNull();
  });

  it('should not make requests when disabled', () => {
    const { result } = renderHook(() => 
      useCheckTurn('table1', 'player1', { enabled: false })
    );
    
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.turnStatus).toBeNull();
  });

  it('should fetch turn status on mount when enabled', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      })
    });

    const { result } = renderHook(() => useCheckTurn('table1', 'player1'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/games/check-turn?tableId=table1&playerId=player1'
      );
    });

    await waitFor(() => {
      expect(result.current.turnStatus).toEqual({
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      });
    });
  });

  it('should poll at specified interval', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      })
    });

    renderHook(() => useCheckTurn('table1', 'player1', { interval: 5000 }));

    // Initial call
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Advance time and check for second call
    jest.advanceTimersByTime(5000);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Advance time again
    jest.advanceTimersByTime(5000);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  it('should call onTurnChange when turn status changes', async () => {
    const onTurnChange = jest.fn();
    
    // First call returns not my turn
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      })
    });

    renderHook(() => useCheckTurn('table1', 'player1', { onTurnChange }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Should not call onTurnChange for initial state
    expect(onTurnChange).not.toHaveBeenCalled();

    // Second call returns my turn
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: true,
        activePlayer: 'player1',
        tableState: 'flop',
        handNumber: 5
      })
    });

    jest.advanceTimersByTime(10000);

    await waitFor(() => {
      expect(onTurnChange).toHaveBeenCalledWith({
        isMyTurn: true,
        activePlayer: 'player1',
        tableState: 'flop',
        handNumber: 5
      });
    });
  });

  it('should handle fetch errors gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useCheckTurn('table1', 'player1'));

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });

    // Should continue polling after error
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      })
    });

    jest.advanceTimersByTime(10000);

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.turnStatus).not.toBeNull();
    });
  });

  it('should handle HTTP errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Table not found' })
    });

    const { result } = renderHook(() => useCheckTurn('table1', 'player1'));

    await waitFor(() => {
      expect(result.current.error).toBe('Table not found');
    });
  });

  it('should allow manual check via checkNow', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      })
    });

    const { result } = renderHook(() => useCheckTurn('table1', 'player1'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Manual check
    await result.current.checkNow();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should prevent concurrent checks', async () => {
    // Mock a slow response
    (global.fetch as jest.Mock).mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: async () => ({
          success: true,
          isMyTurn: false,
          activePlayer: 'player2',
          tableState: 'flop',
          handNumber: 5
        })
      }), 100))
    );

    const { result } = renderHook(() => useCheckTurn('table1', 'player1'));

    // Try to trigger multiple checks quickly
    result.current.checkNow();
    result.current.checkNow();
    result.current.checkNow();

    // Should only have one call in flight
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('should cleanup timeout on unmount', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        isMyTurn: false,
        activePlayer: 'player2',
        tableState: 'flop',
        handNumber: 5
      })
    });

    const { unmount } = renderHook(() => useCheckTurn('table1', 'player1'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
