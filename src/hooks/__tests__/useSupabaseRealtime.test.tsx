// Mock Supabase before any imports
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
    })),
  })),
}));

// Mock the Supabase client module
jest.mock('../../lib/realtime/supabaseClient');

import { renderHook } from '@testing-library/react';
import { useSupabaseRealtime } from '../useSupabaseRealtime';
import { getSupabaseBrowser } from '../../lib/realtime/supabaseClient';

describe('useSupabaseRealtime', () => {
  let mockChannel: any;
  let mockUnsubscribe: jest.Mock;
  let mockOn: jest.Mock;
  let mockSubscribe: jest.Mock;

  beforeEach(() => {
    mockUnsubscribe = jest.fn();
    mockOn = jest.fn().mockReturnThis();
    mockSubscribe = jest.fn();

    mockChannel = {
      on: mockOn,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    };

    (getSupabaseBrowser as jest.Mock).mockReturnValue({
      channel: jest.fn(() => mockChannel),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should not subscribe when tableId is undefined', () => {
    renderHook(() => useSupabaseRealtime(undefined));
    
    expect(getSupabaseBrowser).not.toHaveBeenCalled();
  });

  it('should not subscribe when Supabase client is null', () => {
    (getSupabaseBrowser as jest.Mock).mockReturnValue(null);
    
    renderHook(() => useSupabaseRealtime('table-123'));
    
    expect(mockChannel.subscribe).not.toHaveBeenCalled();
  });

  it('should subscribe to table channel with string tableId', () => {
    const mockSupabase = {
      channel: jest.fn(() => mockChannel),
    };
    (getSupabaseBrowser as jest.Mock).mockReturnValue(mockSupabase);

    renderHook(() => useSupabaseRealtime('table-123'));

    expect(mockSupabase.channel).toHaveBeenCalledWith('table:table-123');
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('should subscribe with first element of array tableId', () => {
    const mockSupabase = {
      channel: jest.fn(() => mockChannel),
    };
    (getSupabaseBrowser as jest.Mock).mockReturnValue(mockSupabase);

    renderHook(() => useSupabaseRealtime(['table-456', 'table-789']));

    expect(mockSupabase.channel).toHaveBeenCalledWith('table:table-456');
  });

  it('should register all event handlers', () => {
    renderHook(() => useSupabaseRealtime('table-123'));

    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'seat_claimed' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'seat_vacated' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'seat_state' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'game_state_update' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'awaiting_dealer_choice' }, expect.any(Function));
  });

  it('should call onSeatClaimed callback when event is received', () => {
    const onSeatClaimed = jest.fn();
    const callbacks = { onSeatClaimed };

    renderHook(() => useSupabaseRealtime('table-123', callbacks));

    // Get the handler function from the mock call
    const seatClaimedCall = mockOn.mock.calls.find(
      call => call[1].event === 'seat_claimed'
    );
    const handler = seatClaimedCall[2];

    // Simulate event
    const payload = { seatNumber: 1, playerId: 'player1', playerName: 'John', chips: 100 };
    handler({ payload });

    expect(onSeatClaimed).toHaveBeenCalledWith(payload);
  });

  it('should call onSeatVacated callback when event is received', () => {
    const onSeatVacated = jest.fn();
    const callbacks = { onSeatVacated };

    renderHook(() => useSupabaseRealtime('table-123', callbacks));

    const seatVacatedCall = mockOn.mock.calls.find(
      call => call[1].event === 'seat_vacated'
    );
    const handler = seatVacatedCall[2];

    const payload = { seatNumber: 1, playerId: 'player1' };
    handler({ payload });

    expect(onSeatVacated).toHaveBeenCalledWith(payload);
  });

  it('should call onGameStateUpdate callback when event is received', () => {
    const onGameStateUpdate = jest.fn();
    const callbacks = { onGameStateUpdate };

    renderHook(() => useSupabaseRealtime('table-123', callbacks));

    const gameStateCall = mockOn.mock.calls.find(
      call => call[1].event === 'game_state_update'
    );
    const handler = gameStateCall[2];

    const payload = { gameState: { pot: 100 }, lastAction: { action: 'bet' } };
    handler({ payload });

    expect(onGameStateUpdate).toHaveBeenCalledWith(payload);
  });

  it('should unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useSupabaseRealtime('table-123'));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should not throw if unsubscribe fails', () => {
    mockUnsubscribe.mockImplementation(() => {
      throw new Error('Unsubscribe failed');
    });

    const { unmount } = renderHook(() => useSupabaseRealtime('table-123'));

    expect(() => unmount()).not.toThrow();
  });

  it('should resubscribe when tableId changes', () => {
    const mockSupabase = {
      channel: jest.fn(() => mockChannel),
    };
    (getSupabaseBrowser as jest.Mock).mockReturnValue(mockSupabase);

    const { rerender } = renderHook(
      ({ tableId }) => useSupabaseRealtime(tableId),
      { initialProps: { tableId: 'table-123' } }
    );

    expect(mockSupabase.channel).toHaveBeenCalledWith('table:table-123');
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    rerender({ tableId: 'table-456' });

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockSupabase.channel).toHaveBeenCalledWith('table:table-456');
  });

  it('should handle missing callbacks gracefully', () => {
    renderHook(() => useSupabaseRealtime('table-123'));

    // Get any handler and call it - should not throw
    const seatClaimedCall = mockOn.mock.calls.find(
      call => call[1].event === 'seat_claimed'
    );
    const handler = seatClaimedCall[2];

    expect(() => handler({ payload: {} })).not.toThrow();
  });
});
