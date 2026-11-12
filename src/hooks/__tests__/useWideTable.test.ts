import { act, renderHook } from '@testing-library/react';
import { useWideTable, WIDE_TABLE_KEY } from '../useWideTable';

describe('useWideTable', () => {
  beforeEach(() => localStorage.clear());

  it('is off by default', () => {
    const { result } = renderHook(() => useWideTable());
    expect(result.current[0]).toBe(false);
  });

  it('reads the choice this browser remembers', () => {
    localStorage.setItem(WIDE_TABLE_KEY, 'true');
    const { result } = renderHook(() => useWideTable());
    expect(result.current[0]).toBe(true);
  });

  it('turns on and off, and remembers the choice', () => {
    const { result } = renderHook(() => useWideTable());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(WIDE_TABLE_KEY)).toBe('true');

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(WIDE_TABLE_KEY)).toBe('false');
  });

  it('still switches when storage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      const { result } = renderHook(() => useWideTable());
      expect(result.current[0]).toBe(false);
      act(() => result.current[1](true));
      expect(result.current[0]).toBe(true);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
