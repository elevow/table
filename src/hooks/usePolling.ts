import { useEffect, useRef } from 'react';

/** Polling stops after this long without the user touching the page, and resumes on the next touch. */
export const DEFAULT_IDLE_MS = 10 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

let lastActivity = Date.now();
let tracking = false;
const resumeListeners = new Set<() => void>();

function noteActivity() {
  lastActivity = Date.now();
  resumeListeners.forEach(resume => resume());
}

function trackActivity() {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  for (const event of ACTIVITY_EVENTS) window.addEventListener(event, noteActivity, { passive: true });
}

/** For tests: pretend the user just touched the page. */
export function markUserActive() {
  noteActivity();
}

export interface PollingOptions {
  /** Poll only while true. Default: true */
  enabled?: boolean;
  /** Pause after this long without user activity; null never pauses. Default: 10 minutes */
  idleMs?: number | null;
  /** Call `fn` straight away rather than after the first interval. Default: true */
  runOnStart?: boolean;
}

/**
 * Calls `fn` every `intervalMs` while enabled, but only while the tab is visible and the user has
 * been active recently: a background or forgotten tab makes no requests. Returning to the tab, or
 * touching the page after going idle, calls `fn` at once and restarts the interval. The latest
 * `fn` is always used, so passing an inline function does not restart polling.
 */
export function usePolling(fn: () => unknown, intervalMs: number, options: PollingOptions = {}) {
  const { enabled = true, idleMs = DEFAULT_IDLE_MS, runOnStart = true } = options;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    trackActivity();

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const idle = () => idleMs != null && Date.now() - lastActivity > idleMs;
    const paused = () => hidden() || idle();

    const call = () => {
      if (stopped) return;
      try {
        // Polling callers handle their own errors; one failure must not stop the loop
        Promise.resolve(fnRef.current()).catch(() => {});
      } catch {
        // as above, for a callback that throws synchronously
      }
    };

    const schedule = () => {
      if (stopped || timer || paused()) return;
      timer = setTimeout(() => {
        timer = null;
        if (paused()) return; // resume() restarts it
        schedule();
        call();
      }, intervalMs);
    };

    const run = () => {
      schedule();
      call();
    };

    // Back from a pause: refresh now rather than waiting out the interval
    const resume = () => {
      if (stopped || timer || paused()) return;
      run();
    };

    const onVisibility = () => {
      if (hidden()) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        resume();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    resumeListeners.add(resume);
    if (runOnStart && !paused()) run();
    else schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      resumeListeners.delete(resume);
    };
  }, [enabled, intervalMs, idleMs, runOnStart]);
}
