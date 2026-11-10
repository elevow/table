import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Whether the browser reports being offline; false during the server render. */
export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
}
