import React, { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth-headers';

interface LedgerLine {
  playerId: string;
  playerName: string;
  boughtIn: number;
  cashedOut: number;
  onTable: number;
  net: number;
  // Side bets are separate money; total is poker and side bets together
  sideBets?: number;
  total?: number;
}

interface LedgerResponse {
  lines: LedgerLine[];
  payments: Array<{ from: string; to: string; amount: number }>;
  session: {
    handsPlayed: number; handsWon: number; biggestPotWon: number; boughtIn: number; net: number;
    sideBets?: number; total?: number; startedAt?: string | null;
  };
  mySideBets?: Array<{ handNumber: number; bet: string; note: string; amount: number }>;
}

// Whole dollars as they are; side bets can leave cents
const money = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2));
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}$${money(Math.abs(n))}`;
// "1h 12m" or "25m" between then and now
const elapsed = (from: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};

const netClass = (n: number) => (n > 0 ? 'text-emerald-600 dark:text-emerald-400' : n < 0 ? 'text-red-600 dark:text-red-400' : '');

/**
 * Your session at this table (time at the table, hands, wins, biggest pot, net), counted by the
 * server so it's the same on every device, and the table's chip ledger with the payments that
 * settle it, downloadable as CSV. Once side bets have been played, it splits your result into
 * poker and side bets (each side bet listed), and settles up on the two together. `refreshKey` changes after each hand.
 */
export default function SessionLedgerPanel({ tableId, refreshKey, embedded = false }: { tableId: string; refreshKey: unknown; embedded?: boolean }) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [showSideBets, setShowSideBets] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // The server only shares the ledger with people who have played here
  const [notPlaying, setNotPlaying] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    if (!tableId) return;
    fetch(`/api/games/ledger?tableId=${encodeURIComponent(tableId)}`, { headers: authHeaders() })
      .then(resp => {
        if (resp.status === 403) setNotPlaying(true);
        return resp.ok ? resp.json() : null;
      })
      .then(d => {
        if (!d) return;
        setData(d);
        setNotPlaying(false);
        setNow(Date.now());
      })
      .catch(() => {});
  }, [tableId]);

  useEffect(() => {
    // Give the server a moment to store the hand that just ended
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const resp = await fetch(`/api/games/ledger?tableId=${encodeURIComponent(tableId)}&format=csv`, { headers: authHeaders() });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ledger-${tableId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  if (!data && notPlaying) {
    return embedded ? <p className="text-sm text-gray-500 dark:text-gray-400">Take a seat and your session will be tracked here.</p> : null;
  }
  if (!data) return embedded ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading your session…</p> : null;
  const s = data.session;
  const mySideBets = data.mySideBets || [];
  // Only show side-bet figures once anyone at the table has played one
  const hasSideBets = mySideBets.length > 0 || data.lines.some(l => (l.sideBets ?? 0) !== 0);

  return (
    // Inside the side panel tabs the tab names it, so no card or heading of its own
    <div className={embedded ? '' : 'surface p-5'}>
      {!embedded && <h3 className="section-title mb-3">This session</h3>}
      {s.startedAt && (
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          At the table {elapsed(s.startedAt, now)}, since {new Date(s.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
        <div className="text-gray-600 dark:text-gray-300">Hands</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">{s.handsPlayed}</div>
        <div className="text-gray-600 dark:text-gray-300">Pots won</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">{s.handsWon}</div>
        <div className="text-gray-600 dark:text-gray-300">Win rate</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">{s.handsPlayed > 0 ? Math.round((s.handsWon / s.handsPlayed) * 100) : 0}%</div>
        <div className="text-gray-600 dark:text-gray-300">Biggest pot won</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">${s.biggestPotWon.toLocaleString()}</div>
        <div className="text-gray-600 dark:text-gray-300">Bought in</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">${s.boughtIn.toLocaleString()}</div>
        {hasSideBets ? (
          <>
            <div className="text-gray-600 dark:text-gray-300">Poker net</div>
            <div className={`text-right tabular-nums ${netClass(s.net)}`}>{signed(s.net)}</div>
            <div className="text-gray-600 dark:text-gray-300">
              <button type="button" className="link" onClick={() => setShowSideBets(v => !v)} aria-expanded={showSideBets}>
                Side bets net
              </button>
            </div>
            <div className={`text-right tabular-nums ${netClass(s.sideBets ?? 0)}`}>{signed(s.sideBets ?? 0)}</div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Night total</div>
            <div className={`text-right tabular-nums font-semibold ${netClass(s.total ?? s.net)}`}>{signed(s.total ?? s.net)}</div>
          </>
        ) : (
          <>
            <div className="font-semibold text-gray-900 dark:text-gray-100">Net</div>
            <div className={`text-right tabular-nums font-semibold ${netClass(s.net)}`}>{signed(s.net)}</div>
          </>
        )}
      </div>
      {hasSideBets && showSideBets && (
        <div className="mb-3">
          {mySideBets.length === 0
            ? <p className="text-xs text-gray-500 dark:text-gray-400">You haven&apos;t won or lost a side bet yet.</p>
            : (
              <ul className="text-xs text-gray-700 dark:text-gray-200 space-y-0.5" aria-label="Your side bets">
                {mySideBets.map((b, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    {/* Head to head isn't tied to a hand */}
                    <span>{b.handNumber > 0 ? `Hand ${b.handNumber} · ` : ''}{b.note}</span>
                    <span className={`tabular-nums ${netClass(b.amount)}`}>{signed(b.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="link text-sm"
        aria-expanded={open}
      >
        {open ? 'Hide table ledger' : 'Show table ledger'}
      </button>
      {open && (
        <div className="mt-3">
          <table className="w-full text-xs">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left py-1">Player</th>
                <th className="text-right py-1">In</th>
                <th className="text-right py-1">Out</th>
                <th className="text-right py-1">Table</th>
                <th className="text-right py-1">{hasSideBets ? 'Poker' : 'Net'}</th>
                {hasSideBets && <th className="text-right py-1">Side</th>}
                {hasSideBets && <th className="text-right py-1">Total</th>}
              </tr>
            </thead>
            <tbody className="text-gray-900 dark:text-gray-100">
              {data.lines.map(l => (
                <tr key={l.playerId} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-1">{l.playerName}</td>
                  <td className="text-right tabular-nums">{l.boughtIn}</td>
                  <td className="text-right tabular-nums">{l.cashedOut}</td>
                  <td className="text-right tabular-nums">{l.onTable}</td>
                  <td className={`text-right tabular-nums ${hasSideBets ? '' : 'font-semibold'} ${netClass(l.net)}`}>{signed(l.net)}</td>
                  {hasSideBets && <td className={`text-right tabular-nums ${netClass(l.sideBets ?? 0)}`}>{signed(l.sideBets ?? 0)}</td>}
                  {hasSideBets && <td className={`text-right tabular-nums font-semibold ${netClass(l.total ?? l.net)}`}>{signed(l.total ?? l.net)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data.payments.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">To settle up{hasSideBets ? ' (poker and side bets together)' : ''}</div>
              <ul className="text-xs text-gray-700 dark:text-gray-200 space-y-0.5">
                {data.payments.map((p, i) => <li key={i}>{p.from} pays {p.to} ${money(p.amount)}</li>)}
              </ul>
            </div>
          )}
          <button
            onClick={downloadCsv}
            disabled={downloading}
            className="mt-3 px-3 py-1 rounded-sm bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-60"
          >
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      )}
    </div>
  );
}
