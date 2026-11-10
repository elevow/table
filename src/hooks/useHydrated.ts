import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False during the server render and the first (hydrating) client render, true after. Lets a
 * component read browser-only values (localStorage, navigator, Notification) during render
 * without a hydration mismatch, instead of copying them into state from an effect.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
