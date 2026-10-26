import React, { useEffect, useRef } from 'react';
import { SHORTCUT_HELP } from '../lib/shared/table-shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** List of the table's keyboard shortcuts, opened with "?". */
export default function ShortcutHelpOverlay({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog so screen readers land on it
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-shortcuts-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="table-shortcuts-title" className="text-lg font-semibold text-gray-900 dark:text-gray-50">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
          They work on your turn while you are not typing in chat or notes.
        </p>
        <dl className="space-y-2">
          {SHORTCUT_HELP.map(({ keys, description }) => (
            <div key={keys} className="flex items-start gap-3">
              <dt className="w-20 shrink-0">
                <kbd className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">{keys}</kbd>
              </dt>
              <dd className="text-sm text-gray-700 dark:text-gray-200">{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
