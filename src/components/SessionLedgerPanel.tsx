import React, { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth-headers';

interface LedgerLine {
  playerId: string;
  playerName: string;
  boughtIn: number;
  cashedOut: number;
  onTable: number;
  net: number;
}

interface LedgerResponse {
  lines: LedgerLine[];
  payments: Array<{ from: string; to: string; amount: number }>;
  session: { handsPlayed: number; handsWon: number; biggestPotWon: number; boughtIn: number; net: number };
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;
const netClass = (n: number) => (n > 0 ? 'text-emerald-600 dark:text-emerald-400' : n < 0 ? 'text-red-600 dark:text-red-400' : '');

/**
 * Your session at this table (hands, wins, biggest pot, net) and the table's chip ledger with
 * the payments that settle it, downloadable as CSV. `refreshKey` changes after each hand.
 */
export default function SessionLedgerPanel({ tableId, refreshKey }: { tableId: string; refreshKey: unknown }) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(() => {
    if (!tableId) return;
    fetch(`/api/games/ledger?tableId=${encodeURIComponent(tableId)}`, { headers: authHeaders() })
      .then(resp => (resp.ok ? resp.json() : null))
      .then(d => { if (d) setData(d); })
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

  if (!data) return null;
  const s = data.session;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">This session</h3>
      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
        <div className="text-gray-600 dark:text-gray-300">Hands</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">{s.handsPlayed}</div>
        <div className="text-gray-600 dark:text-gray-300">Pots won</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">{s.handsWon}</div>
        <div className="text-gray-600 dark:text-gray-300">Biggest pot won</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">${s.biggestPotWon.toLocaleString()}</div>
        <div className="text-gray-600 dark:text-gray-300">Bought in</div>
        <div className="text-right tabular-nums text-gray-900 dark:text-gray-100">${s.boughtIn.toLocaleString()}</div>
        <div className="font-semibold text-gray-900 dark:text-gray-100">Net</div>
        <div className={`text-right tabular-nums font-semibold ${netClass(s.net)}`}>{signed(s.net)}</div>
      </div>

      <button
        onClick={() => setOpen(o => !o)}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
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
                <th className="text-right py-1">Net</th>
              </tr>
            </thead>
            <tbody className="text-gray-900 dark:text-gray-100">
              {data.lines.map(l => (
                <tr key={l.playerId} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-1">{l.playerName}</td>
                  <td className="text-right tabular-nums">{l.boughtIn}</td>
                  <td className="text-right tabular-nums">{l.cashedOut}</td>
                  <td className="text-right tabular-nums">{l.onTable}</td>
                  <td className={`text-right tabular-nums font-semibold ${netClass(l.net)}`}>{signed(l.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.payments.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">To settle up</div>
              <ul className="text-xs text-gray-700 dark:text-gray-200 space-y-0.5">
                {data.payments.map((p, i) => <li key={i}>{p.from} pays {p.to} ${p.amount.toLocaleString()}</li>)}
              </ul>
            </div>
          )}
          <button
            onClick={downloadCsv}
            disabled={downloading}
            className="mt-3 px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-60"
          >
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      )}
    </div>
  );
}
