import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyShortcutTarget, resolveShortcut, type ShortcutCommand } from '../lib/shared/table-shortcuts';

/** How long the first press of A waits for the confirming second press. */
export const ALL_IN_CONFIRM_MS = 3000;

interface Options {
  /** It is this player's betting turn and the action panel is on screen. */
  enabled: boolean;
  onFold: () => void;
  onCheckOrCall: () => void;
}

const clickFirst = (selector: string): boolean => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.click();
  return true;
};

/**
 * Keyboard shortcuts for acting at the table. Amount commands press the panel's own preset,
 * nudge and submit buttons (found by data-shortcut-* attributes), so a key always does exactly
 * what the matching button does, and the page's duplicate-submit guard still applies.
 */
export function useTableShortcuts({ enabled, onFold, onCheckOrCall }: Options) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [allInArmed, setAllInArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ enabled, onFold, onCheckOrCall, allInArmed, helpOpen });
  stateRef.current = { enabled, onFold, onCheckOrCall, allInArmed, helpOpen };

  const disarm = useCallback(() => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = null;
    setAllInArmed(false);
  }, []);

  // An all-in armed on one turn must not carry over to the next
  useEffect(() => {
    if (!enabled) disarm();
  }, [enabled, disarm]);

  useEffect(() => () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
  }, []);

  useEffect(() => {
    const run = (cmd: ShortcutCommand): boolean => {
      const s = stateRef.current;
      switch (cmd.type) {
        case 'help':
          setHelpOpen(open => !open);
          return true;
        case 'clear': {
          const active = document.activeElement as HTMLElement | null;
          if (active?.closest?.('[data-shortcut-amount]')) active.blur();
          const handled = s.helpOpen || s.allInArmed || !!active?.closest?.('[data-shortcut-amount]');
          setHelpOpen(false);
          disarm();
          return handled;
        }
        case 'fold':
          disarm();
          s.onFold();
          return true;
        case 'check-or-call':
          disarm();
          s.onCheckOrCall();
          return true;
        case 'focus-amount': {
          const input = document.querySelector<HTMLInputElement>('[data-shortcut-amount]');
          if (!input) return false;
          input.focus();
          input.select?.();
          return true;
        }
        case 'preset':
          disarm();
          return clickFirst(`[data-shortcut-preset="${cmd.key}"]`);
        case 'nudge':
          disarm();
          return clickFirst(`[data-shortcut-nudge="${cmd.direction > 0 ? 'up' : 'down'}"]`);
        case 'submit':
          disarm();
          return clickFirst('[data-shortcut-submit]');
        case 'all-in': {
          if (!clickFirst('[data-shortcut-preset="allin"]')) return false;
          if (s.allInArmed) {
            disarm();
            // Let React apply the all-in amount before pressing the submit button
            setTimeout(() => clickFirst('[data-shortcut-submit]'), 0);
            return true;
          }
          setAllInArmed(true);
          if (armTimerRef.current) clearTimeout(armTimerRef.current);
          armTimerRef.current = setTimeout(() => setAllInArmed(false), ALL_IN_CONFIRM_MS);
          return true;
        }
      }
      return false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = classifyShortcutTarget(event.target instanceof Element ? event.target : null);
      const cmd = resolveShortcut(event, { isMyTurn: stateRef.current.enabled, target });
      if (!cmd) return;
      if (run(cmd)) event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disarm]);

  return { helpOpen, setHelpOpen, allInArmed };
}
