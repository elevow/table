import { useEffect, useRef } from 'react';

/** Scrolls the element into view each time `active` turns on, and leaves it be if already visible. */
export function useRevealWhen<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  return ref;
}
