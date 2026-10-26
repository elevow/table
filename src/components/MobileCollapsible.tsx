import React, { useState } from 'react';

interface Props {
  title: string;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

/**
 * On a phone, folds a side panel behind a tap-to-open header so the table and action bar stay
 * close together; from the sm breakpoint up the panel always shows and the header is hidden.
 * The panel stays mounted while folded, so chat and other live panels keep their subscriptions.
 */
export default function MobileCollapsible({ title, children, className = '', defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="sm:hidden w-full min-h-[44px] flex items-center justify-between rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-md dark:bg-gray-800 dark:text-gray-100"
      >
        <span>{title}</span>
        <span aria-hidden="true" className="text-gray-500 dark:text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      <div className={open ? 'max-sm:mt-2' : 'hidden sm:block'}>
        {children}
      </div>
    </div>
  );
}
