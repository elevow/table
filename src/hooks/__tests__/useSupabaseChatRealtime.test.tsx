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
import { useSupabaseChatRealtime } from '../useSupabaseChatRealtime';
import { getSupabaseBrowser } from '../../lib/realtime/supabaseClient';

describe('useSupabaseChatRealtime', () => {
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

  it('should not subscribe when roomId is undefined', () => {
    renderHook(() => useSupabaseChatRealtime(undefined));
    
    expect(getSupabaseBrowser).not.toHaveBeenCalled();
  });

  it('should not subscribe when Supabase client is null', () => {
    (getSupabaseBrowser as jest.Mock).mockReturnValue(null);
    
    renderHook(() => useSupabaseChatRealtime('room-123'));
    
    expect(mockChannel.subscribe).not.toHaveBeenCalled();
  });

  it('should subscribe to chat channel with roomId', () => {
    const mockSupabase = {
      channel: jest.fn(() => mockChannel),
    };
    (getSupabaseBrowser as jest.Mock).mockReturnValue(mockSupabase);

    renderHook(() => useSupabaseChatRealtime('room-123'));

    expect(mockSupabase.channel).toHaveBeenCalledWith('chat:room-123');
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('should register all chat event handlers', () => {
    renderHook(() => useSupabaseChatRealtime('room-123'));

    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'chat_new_message' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'chat_reaction' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'chat_reaction_removed' }, expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('broadcast', { event: 'chat_moderated' }, expect.any(Function));
  });

  it('should call onNewMessage callback when event is received', () => {
    const onNewMessage = jest.fn();
    const callbacks = { onNewMessage };

    renderHook(() => useSupabaseChatRealtime('room-123', callbacks));

    // Get the handler function from the mock call
    const newMessageCall = mockOn.mock.calls.find(
      call => call[1].event === 'chat_new_message'
    );
    expect(newMessageCall).toBeDefined();
    const handler = newMessageCall![2];

    // Simulate event
    const payload = { message: { id: 'msg1', message: 'Hello', senderId: 'user1' } };
    handler({ payload });

    expect(onNewMessage).toHaveBeenCalledWith(payload);
  });

  it('should call onReaction callback when event is received', () => {
    const onReaction = jest.fn();
    const callbacks = { onReaction };

    renderHook(() => useSupabaseChatRealtime('room-123', callbacks));

    const reactionCall = mockOn.mock.calls.find(
      call => call[1].event === 'chat_reaction'
    );
    expect(reactionCall).toBeDefined();
    const handler = reactionCall![2];

    const payload = { messageId: 'msg1', emoji: '👍', userId: 'user1' };
    handler({ payload });

    expect(onReaction).toHaveBeenCalledWith(payload);
  });

  it('should call onReactionRemoved callback when event is received', () => {
    const onReactionRemoved = jest.fn();
    const callbacks = { onReactionRemoved };

    renderHook(() => useSupabaseChatRealtime('room-123', callbacks));

    const reactionRemovedCall = mockOn.mock.calls.find(
      call => call[1].event === 'chat_reaction_removed'
    );
    expect(reactionRemovedCall).toBeDefined();
    const handler = reactionRemovedCall![2];

    const payload = { messageId: 'msg1', emoji: '👍', userId: 'user1' };
    handler({ payload });

    expect(onReactionRemoved).toHaveBeenCalledWith(payload);
  });

  it('should call onModerated callback when event is received', () => {
    const onModerated = jest.fn();
    const callbacks = { onModerated };

    renderHook(() => useSupabaseChatRealtime('room-123', callbacks));

    const moderatedCall = mockOn.mock.calls.find(
      call => call[1].event === 'chat_moderated'
    );
    expect(moderatedCall).toBeDefined();
    const handler = moderatedCall![2];

    const payload = { messageId: 'msg1', hidden: true, moderatorId: 'mod1' };
    handler({ payload });

    expect(onModerated).toHaveBeenCalledWith(payload);
  });

  it('should unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useSupabaseChatRealtime('room-123'));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should not throw if unsubscribe fails', () => {
    mockUnsubscribe.mockImplementation(() => {
      throw new Error('Unsubscribe failed');
    });

    const { unmount } = renderHook(() => useSupabaseChatRealtime('room-123'));

    expect(() => unmount()).not.toThrow();
  });

  it('should resubscribe when roomId changes', () => {
    const mockSupabase = {
      channel: jest.fn(() => mockChannel),
    };
    (getSupabaseBrowser as jest.Mock).mockReturnValue(mockSupabase);

    const { rerender } = renderHook(
      ({ roomId }) => useSupabaseChatRealtime(roomId),
      { initialProps: { roomId: 'room-123' } }
    );

    expect(mockSupabase.channel).toHaveBeenCalledWith('chat:room-123');
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    rerender({ roomId: 'room-456' });

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockSupabase.channel).toHaveBeenCalledWith('chat:room-456');
  });

  it('should handle missing callbacks gracefully', () => {
    renderHook(() => useSupabaseChatRealtime('room-123'));

    // Get any handler and call it - should not throw
    const newMessageCall = mockOn.mock.calls.find(
      call => call[1].event === 'chat_new_message'
    );
    expect(newMessageCall).toBeDefined();
    const handler = newMessageCall![2];

    expect(() => handler({ payload: {} })).not.toThrow();
  });
});
