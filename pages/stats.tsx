import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { authHeaders } from '../src/utils/auth-headers';
import { downloadHandHistory } from '../src/utils/download-hand-history';
import ProfitChart from '../src/components/ProfitChart';
import { formatDuration, type PlayedSession, type ProfitPoint } from '../src/lib/shared/profit-sessions';

interface ProfitData {
  series: ProfitPoint[];
  sessions: PlayedSession[];
  roomNames: Record<string, string>;
  totals: { hands: number; net: number };
  truncated: boolean;
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(Math.round(n * 100) / 100).toLocaleString()}`;
const netClass = (n: number) => (n > 0 ? 'text-emerald-600 dark:text-emerald-400' : n < 0 ? 'text-red-600 dark:text-red-400' : '');

export default function StatsPage() {
  const [data, setData] = useState<ProfitData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stats/profit', { headers: authHeaders() })
      .then(async resp => {
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(resp.status === 401 ? 'Sign in to see your results.' : body?.error || 'Could not load your results');
        setData(body);
      })
      .catch(e => setError(e?.message || 'Could not load your results'));
  }, []);

  const exportSession = async (s: PlayedSession) => {
    const key = `${s.roomId}:${s.start}`;
    setExporting(key);
    try {
      await downloadHandHistory({
        roomId: s.roomId,
        // A minute either side so the first hand's start and last hand's end are both inside
        from: new Date(s.start - 60000).toISOString(),
        to: new Date(s.end + 60000).toISOString(),
      });
    } catch (e: any) {
      setError(e?.message || 'Could not export hands');
    } finally {
      setExporting(null);
    }
  };

  const wins = data?.sessions.filter(s => s.net > 0).length ?? 0;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head><title>My Results - Table</title></Head>
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">My Results</h1>
          <div className="flex gap-3 text-sm">
            <Link href="/history" className="text-blue-600 dark:text-blue-400 hover:underline">Hand history</Link>
            <Link href="/leaderboard" className="text-blue-600 dark:text-blue-400 hover:underline">Leaderboard</Link>
            <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">Dashboard</Link>
          </div>
        </div>

        {error && <div className="p-3 mb-4 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 text-sm">{error}</div>}
        {!data && !error && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}

        {data && data.totals.hands === 0 && (
          <div className="p-6 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            No hands yet. Your results appear here once you have played a few hands.
          </div>
        )}

        {data && data.totals.hands > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Net result', value: signed(data.totals.net), cls: netClass(data.totals.net) },
                { label: 'Hands', value: data.totals.hands.toLocaleString(), cls: '' },
                { label: 'Sessions', value: data.sessions.length.toLocaleString(), cls: '' },
                { label: 'Winning sessions', value: `${wins} of ${data.sessions.length}`, cls: '' },
              ].map(t => (
                <div key={t.label} className="rounded-lg bg-white dark:bg-gray-800 shadow p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t.label}</div>
                  <div className={`text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100 ${t.cls}`}>{t.value}</div>
                </div>
              ))}
            </div>

            <section className="rounded-lg bg-white dark:bg-gray-800 shadow p-4 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Profit over time</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Running total, one step per hand{data.truncated ? ` (your latest ${data.totals.hands.toLocaleString()} hands)` : ''}.
              </p>
              <ProfitChart points={data.series} />
            </section>

            <section className="rounded-lg bg-white dark:bg-gray-800 shadow overflow-x-auto">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-4 pt-4">Sessions</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 px-4 mb-2">A break of more than two hours at a table starts a new session.</p>
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Table</th>
                    <th className="px-3 py-2 text-right">Hands</th>
                    <th className="px-3 py-2 text-right">Duration</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map(s => {
                    const key = `${s.roomId}:${s.start}`;
                    return (
                      <tr key={key} className="border-b border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(s.start).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <Link href={`/history?room=${encodeURIComponent(s.roomId)}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                            {data.roomNames[s.roomId] || s.roomId}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.hands}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatDuration(s.durationMs)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${netClass(s.net)}`}>{signed(s.net)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => exportSession(s)}
                            disabled={exporting === key}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-60"
                          >
                            {exporting === key ? 'Exporting…' : 'Export'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
