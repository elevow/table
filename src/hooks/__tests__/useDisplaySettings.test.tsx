import { act, renderHook, waitFor } from '@testing-library/react';
import { useDisplaySettings } from '../useDisplaySettings';

let profile: Record<string, boolean> | null;
beforeEach(() => {
  localStorage.clear();
  profile = { highContrastCards: true, showPotOdds: false, showStackInBB: false };
  (global as any).fetch = jest.fn(async () => (profile ? { ok: true, json: async () => ({ display: profile }) } : { ok: false }));
});

test('a table starts from the profile settings', async () => {
  const { result } = renderHook(() => useDisplaySettings('t1'));
  await waitFor(() => expect(result.current.settings.highContrastCards).toBe(true));
  expect(result.current.settings).toEqual({ highContrastCards: true, showPotOdds: false, showStackInBB: false, showHandValue: true });
  expect(result.current.hasOverrides).toBe(false);
});

test('a change at a table applies to that table only, and resetting goes back to the profile', async () => {
  const { result } = renderHook(() => useDisplaySettings('t1'));
  await waitFor(() => expect(result.current.settings.highContrastCards).toBe(true));
  act(() => result.current.change('highContrastCards', false));
  expect(result.current.settings.highContrastCards).toBe(false);
  expect(result.current.hasOverrides).toBe(true);
  expect(JSON.parse(localStorage.getItem('game_settings_t1')!)).toEqual({ highContrastCards: false });

  const other = renderHook(() => useDisplaySettings('t2'));
  await waitFor(() => expect(other.result.current.settings.highContrastCards).toBe(true));

  act(() => result.current.reset());
  expect(result.current.settings.highContrastCards).toBe(true);
  expect(localStorage.getItem('game_settings_t1')).toBeNull();
});

test('changing back to the profile\'s value isn\'t kept as a change', async () => {
  const { result } = renderHook(() => useDisplaySettings('t1'));
  await waitFor(() => expect(result.current.settings.highContrastCards).toBe(true));
  act(() => result.current.change('showStackInBB', true));
  act(() => result.current.change('showStackInBB', false));
  expect(result.current.hasOverrides).toBe(false);
  expect(localStorage.getItem('game_settings_t1')).toBeNull();
});

test('signed out, or the profile can\'t be read: the usual defaults, with this table\'s changes', async () => {
  profile = null;
  localStorage.setItem('game_settings_t1', JSON.stringify({ showStackInBB: true, soundEnabled: false }));
  const { result } = renderHook(() => useDisplaySettings('t1'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(result.current.settings).toEqual({ highContrastCards: false, showPotOdds: true, showStackInBB: true, showHandValue: true });
});
