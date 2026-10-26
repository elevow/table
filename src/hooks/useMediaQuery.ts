import { useEffect, useState } from 'react';

/** Matches Tailwind's max-sm (below the 640px sm breakpoint): phones in portrait. */
export const NARROW_SCREEN_QUERY = '(max-width: 639px)';

/**
 * Whether a media query matches, following changes (rotation, window resizes).
 * False during server rendering and the first client render, so markup matches on hydration.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    // Safari before 14 only has the older addListener API
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    }
    list.addListener(update);
    return () => list.removeListener(update);
  }, [query]);

  return matches;
}
