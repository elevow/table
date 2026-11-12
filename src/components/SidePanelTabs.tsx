import React, { useEffect, useRef, useState } from 'react';
import { useHydrated } from '../hooks/useHydrated';

export type SidePanelTab = {
  id: string;
  label: string;
  content: React.ReactNode;
  /** A count shown on the tab, such as unread chat messages; nothing is shown for 0 */
  badge?: number;
};

const STORAGE_KEY = 'table-side-panel-tab';

const readSaved = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * The table's side panels in one card, a tab for each. Every panel stays mounted while its tab is
 * hidden, so live panels keep their data and subscriptions. The last tab chosen is remembered.
 * onActiveChange hears which tab is showing, including the remembered one once it's read.
 */
export default function SidePanelTabs({ tabs, onActiveChange }: { tabs: SidePanelTab[]; onActiveChange?: (id: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const tablist = useRef<HTMLDivElement | null>(null);
  // The tab chosen here, else the one remembered from last time (read once hydrated)
  const hydrated = useHydrated();
  const chosen = picked ?? (hydrated ? readSaved() : null);

  // A remembered tab that isn't offered right now (e.g. Hand between games) falls back to the first
  const active = tabs.some(t => t.id === chosen) ? (chosen as string) : (tabs[0]?.id ?? null);

  useEffect(() => {
    if (active) onActiveChange?.(active);
  }, [active, onActiveChange]);

  // A tab with something new that's scrolled out of the narrow tab row slides into view, without
  // moving the page itself
  const unreadKey = tabs.filter(t => t.id !== active && (t.badge ?? 0) > 0).map(t => t.id).join(',');
  useEffect(() => {
    const row = tablist.current;
    const id = unreadKey.split(',')[0];
    const btn = id ? buttons.current[id] : null;
    if (!row || !btn) return;
    const left = btn.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    const right = left + btn.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [unreadKey]);

  if (tabs.length === 0 || !active) return null;

  const choose = (id: string, focus = false) => {
    setPicked(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Remembering the tab is a convenience only
    }
    if (focus) buttons.current[id]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(t => t.id === active);
    const next =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length :
      e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length :
      e.key === 'Home' ? 0 :
      e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(tabs[next].id, true);
  };

  return (
    <div className="surface overflow-hidden">
      <div
        ref={tablist}
        role="tablist"
        aria-label="Table panels"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto overflow-y-hidden scrollbar-none [&::-webkit-scrollbar]:hidden border-b border-gray-100 px-3 pt-2 dark:border-white/6"
      >
        {tabs.map(t => {
          const selected = t.id === active;
          const unread = !selected && !!t.badge && t.badge > 0;
          return (
            <button
              key={t.id}
              ref={el => { buttons.current[t.id] = el; }}
              type="button"
              role="tab"
              id={`side-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`side-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(t.id)}
              data-unread={unread || undefined}
              className={`-mb-px min-h-[40px] whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
                selected
                  ? 'border-emerald-500 font-semibold text-gray-900 dark:text-gray-100'
                  : unread
                    // Something new behind this tab: bold, green and underlined so it stands out
                    ? 'border-emerald-300 font-bold text-emerald-700 hover:text-emerald-800 dark:border-emerald-500/50 dark:text-emerald-300 dark:hover:text-emerald-200'
                    : 'border-transparent font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
              {!!t.badge && t.badge > 0 && (
                <span className="relative ml-1.5 inline-flex">
                  {unread && (
                    // Pings a few times per new count (the key restarts it), then settles
                    <span key={t.badge} aria-hidden className="absolute inset-0 rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping [animation-iteration-count:3]" />
                  )}
                  <span className="relative inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-semibold leading-[18px] text-white tabular-nums">
                    {t.badge > 99 ? '99+' : t.badge}
                    <span className="sr-only"> unread</span>
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map(t => (
        <div
          key={t.id}
          role="tabpanel"
          id={`side-panel-${t.id}`}
          aria-labelledby={`side-tab-${t.id}`}
          hidden={t.id !== active}
          className="p-5"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
