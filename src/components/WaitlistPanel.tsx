import React, { useEffect, useState } from 'react';
import type { TableExtras } from '../hooks/useTableExtras';

interface Props {
  extras: TableExtras;
  playerId: string;
  isSeated: boolean;
  tableFull: boolean;
  canSit: boolean;
  onToggleWaitlist: (join: boolean) => void;
  onTakeSeat: (seatNumber: number) => void;
}

/**
 * Waitlist and seat-approval status for a player who is not seated: join or leave the waitlist,
 * take a seat held for you, or see that the host has your request.
 */
export default function WaitlistPanel({ extras, playerId, isSeated, tableFull, canSit, onToggleWaitlist, onTakeSeat }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const offer = extras.seatOffer && extras.seatOffer.playerId === playerId ? extras.seatOffer : null;
  useEffect(() => {
    if (!offer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [offer]);

  if (isSeated || !canSit) return null;
  const position = extras.waitlist.findIndex(w => w.playerId === playerId);

  if (offer) {
    const secondsLeft = Math.max(0, Math.ceil((offer.expiresAt - now) / 1000));
    return (
      <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 rounded-lg p-3" role="alert">
        <span className="text-sm text-emerald-900 dark:text-emerald-100">
          Seat {offer.seatNumber} is free and held for you for {secondsLeft}s.
        </span>
        <button onClick={() => onTakeSeat(offer.seatNumber)} className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium">
          Take seat {offer.seatNumber}
        </button>
      </div>
    );
  }

  if (extras.myPendingRequest) {
    return (
      <div className="lg:col-span-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg p-3 text-sm text-blue-900 dark:text-blue-100">
        Waiting for the host to approve your seat.
      </div>
    );
  }

  if (!tableFull && position < 0) return null;

  return (
    <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-lg shadow p-3">
      <span className="text-sm text-gray-700 dark:text-gray-200">
        {position >= 0
          ? `You are number ${position + 1} on the waitlist.`
          : `The table is full.${extras.waitlist.length ? ` ${extras.waitlist.length} waiting.` : ''}`}
      </span>
      <button
        onClick={() => onToggleWaitlist(position < 0)}
        className={`px-4 py-1.5 rounded text-sm font-medium text-white ${position >= 0 ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'}`}
      >
        {position >= 0 ? 'Leave waitlist' : 'Join waitlist'}
      </button>
    </div>
  );
}
