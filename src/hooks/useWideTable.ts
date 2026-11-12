import { useCallback, useState } from 'react';
import { useHydrated } from './useHydrated';

export const WIDE_TABLE_KEY = 'table_wideView';

function readWide(): boolean {
  try {
    return localStorage.getItem(WIDE_TABLE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Whether the player wants the wide table layout: the table across the full width with the side
 * panel moved below it. Remembered in this browser, for every table. Off until hydrated, so the
 * server and first client render match.
 */
export function useWideTable(): [boolean, (on: boolean) => void] {
  const hydrated = useHydrated();
  // The choice made here, else what this browser remembers
  const [choice, setChoice] = useState<boolean | null>(null);
  const wide = choice ?? (hydrated ? readWide() : false);

  const setWide = useCallback((on: boolean) => {
    setChoice(on);
    try {
      localStorage.setItem(WIDE_TABLE_KEY, String(on));
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist
    }
  }, []);

  return [wide, setWide];
}
