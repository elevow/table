import { act, renderHook } from '@testing-library/react';
import { useTurnClock } from '../useTurnClock';
import { BASE_TURN_MS, TIMEOUT_GRACE_MS } from '../../lib/shared/turn-clock';

global.fetch = jest.fn();

const state = (overrides: Record<string, unknown> = {}) => ({
  turnSeq: 7,
  activePlayer: 'p2',
  stage: 'flop',
  turnTimeRemainingMs: BASE_TURN_MS + 10_000,
  players: [{ id: 'p1', timeBank: 30 }, { id: 'p2', timeBank: 10 }],
  ...overrides,
});

describe('useTurnClock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    (global.fetch as jest.Mock).mockReset();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('counts down the base time, then the time bank', () => {
    const { result } = renderHook(() => useTurnClock({ state: state(), tableId: 't', playerId: 'p1', enforce: false }));
    expect(result.current.activePlayer).toBe('p2');
    expect(result.current.inTimeBank).toBe(false);

    act(() => { jest.advanceTimersByTime(BASE_TURN_MS + 2_000); });
    expect(result.current.baseRemainingMs).toBe(0);
    expect(result.current.inTimeBank).toBe(true);
    expect(Math.ceil(result.current.remainingMs! / 1000)).toBe(8);
  });

  it('keeps one countdown when the same turn arrives again', () => {
    let current = state();
    const { result, rerender } = renderHook(() => useTurnClock({ state: current, tableId: 't', playerId: 'p1', enforce: false }));
    act(() => { jest.advanceTimersByTime(5_000); });
    // A later copy of the same turn reports less time left; the countdown does not jump
    current = state({ turnTimeRemainingMs: BASE_TURN_MS });
    rerender();
    expect(Math.round(result.current.remainingMs! / 1000)).toBe(Math.round((BASE_TURN_MS + 5_000) / 1000));
  });

  it('asks the server to enforce the clock once it has run out, and applies the result', async () => {
    const onState = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ gameState: { turnSeq: 8 } }) });
    renderHook(() => useTurnClock({ state: state({ turnTimeRemainingMs: 1_000 }), tableId: 't', playerId: 'p1', enforce: true, onState }));

    // Not before the grace period
    act(() => { jest.advanceTimersByTime(1_000 + TIMEOUT_GRACE_MS - 500); });
    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => { jest.advanceTimersByTime(1_000); });
    // The request goes out after a random spread (0 here), scheduled once the expiry renders
    await act(async () => { jest.advanceTimersByTime(10); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/games/timeout');
    expect(JSON.parse(init.body)).toEqual({ tableId: 't', playerId: 'p1', expectedTurnSeq: 7 });
    await act(async () => { await Promise.resolve(); });
    expect(onState).toHaveBeenCalledWith({ turnSeq: 8 });

    // The countdown keeps ticking, but the request is not repeated for the same turn
    await act(async () => { jest.advanceTimersByTime(5_000); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not enforce for spectators', async () => {
    renderHook(() => useTurnClock({ state: state({ turnTimeRemainingMs: 0 }), tableId: 't', playerId: '', enforce: false }));
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows no clock when nobody is to act', () => {
    const { result } = renderHook(() => useTurnClock({ state: state({ activePlayer: '', turnTimeRemainingMs: undefined }), tableId: 't', playerId: 'p1', enforce: true }));
    expect(result.current.remainingMs).toBeNull();
  });
});
