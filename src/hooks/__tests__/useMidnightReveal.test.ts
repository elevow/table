import { act, renderHook } from '@testing-library/react';
import { useMidnightReveal } from '../useMidnightReveal';

const card = (rank: string) => ({ rank, suit: 'clubs' });

// A Midnight Baseball state: a turned K, then b turned Q and A
const state = (handId: string, extra: Record<string, unknown> = {}) => ({
  variant: 'midnight-baseball',
  handId,
  stage: 'third',
  activePlayer: 'b',
  turnTimeRemainingMs: 30000,
  studState: {
    midnight: { holder: 'b', flips: ['a', 'b', 'b'] },
    playerCards: {
      a: { downCards: [], upCards: [card('K')], downCount: 6 },
      b: { downCards: [], upCards: [card('Q'), card('A')], downCount: 5 },
    },
  },
  ...extra,
});

const ups = (s: any, id: string) => s.studState.playerCards[id].upCards.map((c: any) => c.rank);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useMidnightReveal', () => {
  test('arriving mid-hand shows everything at once', () => {
    const s = state('h1');
    const { result } = renderHook(() => useMidnightReveal(s));
    expect(result.current).toBe(s);
  });

  test('a new hand shows its turned cards one at a time, two seconds apart, with nobody to act until the last', () => {
    let current: any = state('h1');
    const { result, rerender } = renderHook(() => useMidnightReveal(current));
    current = state('h2');
    rerender();
    expect(ups(result.current, 'a')).toEqual([]);
    expect(result.current.studState.playerCards.a.downCount).toBe(7);
    expect(result.current.activePlayer).toBe('');
    act(() => { jest.advanceTimersByTime(2000); });
    expect(ups(result.current, 'a')).toEqual(['K']);
    expect(ups(result.current, 'b')).toEqual([]);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(ups(result.current, 'b')).toEqual(['Q']);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(ups(result.current, 'b')).toEqual(['Q', 'A']);
    expect(result.current.activePlayer).toBe('b');
    // The clock's time left counts from when the state arrived, so the reveal used 6 seconds of it
    expect(result.current.turnTimeRemainingMs).toBe(24000);
  });

  test('the result waits for the last card', () => {
    let current: any = state('h1');
    const { result, rerender } = renderHook(() => useMidnightReveal(current));
    current = state('h2', { stage: 'showdown', handResult: { pot: 4, winnings: { b: 4 } } });
    rerender();
    expect(result.current.stage).toBe('third');
    expect(result.current.handResult).toBeUndefined();
    for (let i = 0; i < 3; i++) act(() => { jest.advanceTimersByTime(2000); });
    expect(result.current.stage).toBe('showdown');
    expect(result.current.handResult).toEqual({ pot: 4, winnings: { b: 4 } });
  });

  test('other games pass straight through', () => {
    const s = { variant: 'texas-holdem', handId: 'h1' };
    const { result } = renderHook(() => useMidnightReveal(s));
    expect(result.current).toBe(s);
  });
});
