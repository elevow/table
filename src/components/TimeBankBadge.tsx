import React from 'react';

interface Props {
  // Time banks left; undefined for games saved before time banks were counted
  count?: number;
  // Length of each time bank in seconds
  seconds?: number;
  compact?: boolean;
}

/** How many time banks a player has left, e.g. "⏱ ×2". */
export default function TimeBankBadge({ count, seconds, compact = false }: Props) {
  if (typeof count !== 'number') return null;
  const label = `${count} time bank${count === 1 ? '' : 's'} left${seconds ? `, ${seconds}s each` : ''}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1 ${compact ? 'text-[10px]' : 'text-xs'} font-semibold ${count > 0
        ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-100'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
      title={label}
      aria-label={label}
    >
      <span aria-hidden="true">⏱</span>×{count}
    </span>
  );
}
