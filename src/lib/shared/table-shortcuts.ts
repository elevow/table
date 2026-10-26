/**
 * Keyboard shortcuts for the table's action panel, as a pure key -> command mapping.
 * The hook (useTableShortcuts) carries the commands out.
 */

export type ShortcutCommand =
  | { type: 'fold' }
  | { type: 'check-or-call' }
  | { type: 'focus-amount' }
  | { type: 'preset'; key: '1' | '2' | '3' | '4' }
  | { type: 'all-in' }
  | { type: 'nudge'; direction: 1 | -1 }
  | { type: 'submit' }
  | { type: 'clear' }
  | { type: 'help' };

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * Where the key was pressed:
 * - 'typing': a text field, select or editable area (chat, notes) - shortcuts stay out of the way
 * - 'amount': the bet/raise amount box, where only Enter, Esc and the arrows mean something
 * - 'control': a focused button, link, slider or checkbox, which keeps its own Enter/Space/arrows
 * - 'other': anywhere else on the page
 */
export type ShortcutTarget = 'typing' | 'amount' | 'control' | 'other';

export interface ShortcutContext {
  /** It is this player's betting turn and the action panel is showing. */
  isMyTurn: boolean;
  target: ShortcutTarget;
}

export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: 'F', description: 'Fold' },
  { keys: 'C', description: 'Check, or call the bet' },
  { keys: 'R or B', description: 'Jump to the raise/bet amount (Enter submits)' },
  { keys: '1 2 3 4', description: 'Amount presets: min, ½ pot, ⅔ pot, pot' },
  { keys: 'A', description: 'All-in (press again to confirm)' },
  { keys: '↑ / ↓', description: 'Amount up or down by one big blind' },
  { keys: 'Enter', description: 'Bet or raise the chosen amount' },
  { keys: 'Esc', description: 'Clear: cancel all-in, leave the amount box, close this help' },
  { keys: '?', description: 'Show or hide this help' },
];

const PRESET_KEYS = new Set(['1', '2', '3', '4']);

export function resolveShortcut(event: ShortcutKeyEvent, ctx: ShortcutContext): ShortcutCommand | null {
  // Leave browser and OS shortcuts (Ctrl+C, Cmd+R, ...) alone
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (ctx.target === 'typing') return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (ctx.target === 'amount') {
    if (key === 'Escape') return { type: 'clear' };
    if (!ctx.isMyTurn) return null;
    if (key === 'Enter') return { type: 'submit' };
    if (key === 'ArrowUp') return { type: 'nudge', direction: 1 };
    if (key === 'ArrowDown') return { type: 'nudge', direction: -1 };
    // Digits and letters are the player typing an amount
    return null;
  }

  if (key === '?') return { type: 'help' };
  if (key === 'Escape') return { type: 'clear' };
  if (!ctx.isMyTurn) return null;

  switch (key) {
    case 'f': return { type: 'fold' };
    case 'c': return { type: 'check-or-call' };
    case 'r':
    case 'b': return { type: 'focus-amount' };
    case 'a': return { type: 'all-in' };
  }
  if (PRESET_KEYS.has(key)) return { type: 'preset', key: key as '1' | '2' | '3' | '4' };

  // A focused button or slider keeps its own Enter and arrow keys
  if (ctx.target === 'control') return null;
  if (key === 'Enter') return { type: 'submit' };
  if (key === 'ArrowUp') return { type: 'nudge', direction: 1 };
  if (key === 'ArrowDown') return { type: 'nudge', direction: -1 };
  return null;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);

/** Decide what kind of element a key event came from. */
export function classifyShortcutTarget(el: Element | null): ShortcutTarget {
  if (!el || typeof (el as HTMLElement).closest !== 'function') return 'other';
  const html = el as HTMLElement;
  if (html.closest('[data-shortcut-amount]')) return 'amount';
  if (html.isContentEditable || html.closest('[contenteditable=""], [contenteditable="true"]')) return 'typing';
  const tag = html.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return 'typing';
  if (tag === 'input') {
    const type = ((html as HTMLInputElement).getAttribute('type') || '').toLowerCase();
    return TEXT_INPUT_TYPES.has(type) ? 'typing' : 'control';
  }
  if (html.closest('button, a[href], summary, [role="button"], [role="slider"], [role="menuitem"]')) return 'control';
  return 'other';
}
