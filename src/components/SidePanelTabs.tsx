import React, { useEffect, useRef, useState } from 'react';

export type SidePanelTab = { id: string; label: string; content: React.ReactNode };

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
 */
export default function SidePanelTabs({ tabs }: { tabs: SidePanelTab[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setChosen(readSaved());
  }, []);

  if (tabs.length === 0) return null;
  // A remembered tab that isn't offered right now (e.g. Hand between games) falls back to the first
  const active = tabs.some(t => t.id === chosen) ? (chosen as string) : tabs[0].id;

  const choose = (id: string, focus = false) => {
    setChosen(id);
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
        role="tablist"
        aria-label="Table panels"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto overflow-y-hidden scrollbar-none [&::-webkit-scrollbar]:hidden border-b border-gray-100 px-3 pt-2 dark:border-white/6"
      >
        {tabs.map(t => {
          const selected = t.id === active;
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
              className={`-mb-px min-h-[40px] whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
                selected
                  ? 'border-emerald-500 text-gray-900 dark:text-gray-100'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
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
