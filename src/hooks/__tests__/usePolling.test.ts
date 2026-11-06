import { act, renderHook } from '@testing-library/react';
import { DEFAULT_IDLE_MS, markUserActive, usePolling } from '../usePolling';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

// Let the awaited callback settle so the next interval gets scheduled
async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function advance(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await flush();
}

describe('usePolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setVisibility('visible');
    markUserActive();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('calls at once, then every interval', async () => {
    const fn = jest.fn();
    renderHook(() => usePolling(fn, 1000));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('does nothing while disabled', async () => {
    const fn = jest.fn();
    renderHook(() => usePolling(fn, 1000, { enabled: false }));
    await advance(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  test('a new inline function each render does not restart polling', async () => {
    let calls = 0;
    const { rerender } = renderHook(() => usePolling(() => { calls += 1; }, 1000));
    await flush();
    for (let i = 0; i < 5; i++) rerender();
    await flush();
    expect(calls).toBe(1);
  });

  test('pauses while the tab is hidden and refreshes on return', async () => {
    const fn = jest.fn();
    renderHook(() => usePolling(fn, 1000));
    await flush();
    act(() => setVisibility('hidden'));
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => setVisibility('visible'));
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('stops after the user goes idle and resumes on activity', async () => {
    const fn = jest.fn();
    renderHook(() => usePolling(fn, 60_000));
    await flush();
    await advance(DEFAULT_IDLE_MS + 60_000);
    const whileIdle = fn.mock.calls.length;
    await advance(10 * 60_000);
    expect(fn).toHaveBeenCalledTimes(whileIdle);
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    await flush();
    expect(fn).toHaveBeenCalledTimes(whileIdle + 1);
  });

  test('a failing call does not stop polling', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000));
    await flush();
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('stops on unmount', async () => {
    const fn = jest.fn();
    const { unmount } = renderHook(() => usePolling(fn, 1000));
    await flush();
    unmount();
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
