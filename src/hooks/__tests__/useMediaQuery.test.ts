import { act, renderHook } from '@testing-library/react';
import { NARROW_SCREEN_QUERY, useMediaQuery } from '../useMediaQuery';

describe('useMediaQuery', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  const fakeList = (matches: boolean, modern = true) => {
    const listeners = new Set<() => void>();
    const list: any = { matches };
    if (modern) {
      list.addEventListener = (_: string, fn: () => void) => listeners.add(fn);
      list.removeEventListener = (_: string, fn: () => void) => listeners.delete(fn);
    } else {
      list.addListener = (fn: () => void) => listeners.add(fn);
      list.removeListener = (fn: () => void) => listeners.delete(fn);
    }
    window.matchMedia = jest.fn(() => list) as any;
    return { list, fire: (next: boolean) => { list.matches = next; listeners.forEach(fn => fn()); }, listeners };
  };

  it('follows the query as it changes', () => {
    const media = fakeList(true);
    const { result, unmount } = renderHook(() => useMediaQuery(NARROW_SCREEN_QUERY));
    expect(result.current).toBe(true);
    act(() => media.fire(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('supports the older listener API', () => {
    const media = fakeList(false, false);
    const { result, unmount } = renderHook(() => useMediaQuery(NARROW_SCREEN_QUERY));
    act(() => media.fire(true));
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('is false without matchMedia', () => {
    (window as any).matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery(NARROW_SCREEN_QUERY));
    expect(result.current).toBe(false);
  });
});
