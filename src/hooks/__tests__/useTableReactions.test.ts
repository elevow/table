let tableEvent: ((payload: any) => void) | undefined;
jest.mock('../useSupabaseRealtime', () => ({
  useSupabaseRealtime: (_tableId: unknown, callbacks: any) => { tableEvent = callbacks?.onTableEvent; },
}));

import { act, renderHook } from '@testing-library/react';
import { useTableReactions } from '../useTableReactions';
import { REACTION_COOLDOWN_MS, REACTION_SHOW_MS, REACTIONS_MUTED_KEY } from '../../lib/shared/reactions';

describe('useTableReactions', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const receive = (payload: any) => act(() => { tableEvent?.(payload); });

  it('shows other players\' reactions for a few seconds', () => {
    const { result } = renderHook(() => useTableReactions('t1', 'me'));
    receive({ type: 'reaction', playerId: 'bob', emote: '🔥' });
    expect(result.current.bubbles.bob?.emote).toBe('🔥');
    act(() => { jest.advanceTimersByTime(REACTION_SHOW_MS + 1); });
    expect(result.current.bubbles.bob).toBeUndefined();
  });

  it('restarts the bubble when the same player reacts again', () => {
    const { result } = renderHook(() => useTableReactions('t1', 'me'));
    receive({ type: 'reaction', playerId: 'bob', emote: '🔥' });
    act(() => { jest.advanceTimersByTime(REACTION_SHOW_MS - 500); });
    receive({ type: 'reaction', playerId: 'bob', emote: 'GG' });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current.bubbles.bob?.emote).toBe('GG');
  });

  it('ignores other table events and unknown reactions', () => {
    const { result } = renderHook(() => useTableReactions('t1', 'me'));
    receive({ type: 'kicked', playerId: 'bob' });
    receive({ type: 'reaction', playerId: 'bob', emote: '💩' });
    receive({ type: 'reaction', emote: '👍' });
    expect(result.current.bubbles).toEqual({});
  });

  it('sends our reaction, shows it right away and waits before the next', async () => {
    const { result } = renderHook(() => useTableReactions('t1', 'me'));
    await act(async () => { await result.current.send('👍'); });
    expect(result.current.bubbles.me?.emote).toBe('👍');
    expect(result.current.coolingDown).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/games/react', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tableId: 't1', playerId: 'me', emote: '👍' });

    await act(async () => { await result.current.send('😂'); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => { jest.advanceTimersByTime(REACTION_COOLDOWN_MS); });
    expect(result.current.coolingDown).toBe(false);

    // The broadcast of our own reaction doesn't show it twice
    receive({ type: 'reaction', playerId: 'me', emote: '🔥' });
    expect(result.current.bubbles.me?.emote).toBe('👍');
  });

  it('survives a failed send', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useTableReactions('t1', 'me'));
    await act(async () => { await result.current.send('GG'); });
    expect(result.current.bubbles.me?.emote).toBe('GG');
  });

  it('mutes other players\' reactions and remembers the choice', () => {
    const { result, unmount } = renderHook(() => useTableReactions('t1', 'me'));
    act(() => { result.current.setMuted(true); });
    expect(localStorage.getItem(REACTIONS_MUTED_KEY)).toBe('true');
    receive({ type: 'reaction', playerId: 'bob', emote: '🔥' });
    expect(result.current.bubbles).toEqual({});
    unmount();

    const again = renderHook(() => useTableReactions('t1', 'me'));
    expect(again.result.current.muted).toBe(true);
  });
});
