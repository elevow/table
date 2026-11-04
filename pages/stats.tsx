import React, { useCallback, useEffect, useState } from 'react';
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
  // Hidden unless the player has stats.delete_sessions; the API checks it again
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/stats/profit', { headers: authHeaders() })
      .then(async resp => {
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(resp.status === 401 ? 'Sign in to see your results.' : body?.error || 'Could not load your results');
        setData(body);
      })
      .catch(e => setError(e?.message || 'Could not load your results'));
  }, []);

  useEffect(() => {
    load();
    const headers = authHeaders();
    if (!headers.Authorization) return;
    fetch('/api/auth/check-admin', { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(me => setCanDelete(!!me?.permissions?.includes('stats.delete_sessions')))
      .catch(() => {});
  }, [load]);

  const deleteSessions = async (which: PlayedSession | 'all') => {
    const question = which === 'all'
      ? "Delete all your sessions? Every hand you have played will be removed from your results, hand history and leaderboard totals. Other players keep their copies. This can't be undone."
      : `Delete this session (${which.hands} hand${which.hands === 1 ? '' : 's'})? The hands will be removed from your results, hand history and leaderboard totals. Other players keep their copies. This can't be undone.`;
    if (!window.confirm(question)) return;
    const key = which === 'all' ? 'all' : `${which.roomId}:${which.start}`;
    setDeleting(key);
    setError(null);
    setNotice(null);
    try {
      const resp = await fetch('/api/stats/sessions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(which === 'all' ? { all: true } : { roomId: which.roomId, start: which.start, end: which.end }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body?.error || 'Could not delete the sessions');
      setNotice(`Deleted ${body.hands} hand${body.hands === 1 ? '' : 's'} from your results.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not delete the sessions');
    } finally {
      setDeleting(null);
    }
  };

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
        {notice && <div role="status" className="p-3 mb-4 rounded bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-sm">{notice}</div>}
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
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sessions</h2>
                {canDelete && data.sessions.length > 0 && (
                  <button
                    onClick={() => deleteSessions('all')}
                    disabled={deleting !== null}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                  >
                    {deleting === 'all' ? 'Deleting…' : 'Delete all sessions'}
                  </button>
                )}
              </div>
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
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => exportSession(s)}
                            disabled={exporting === key}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-60"
                          >
                            {exporting === key ? 'Exporting…' : 'Export'}
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => deleteSessions(s)}
                              disabled={deleting !== null}
                              aria-label={`Delete the session at ${data.roomNames[s.roomId] || s.roomId} on ${new Date(s.start).toLocaleString()}`}
                              className="ml-3 text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                            >
                              {deleting === key ? 'Deleting…' : 'Delete'}
                            </button>
                          )}
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
