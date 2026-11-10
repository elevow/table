import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AppShell, { PageHeader } from '../src/components/AppShell';
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

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(Math.round(n * 100) / 100).toLocaleString()}`;
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
    <AppShell>
      <Head><title>My Results - Table</title></Head>
      <main className="page">
        <PageHeader title="Results" subtitle="Your profit and sessions across every cash table." />

        {error && <div className="p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">{error}</div>}
        {notice && <div role="status" className="p-3 mb-4 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 text-sm">{notice}</div>}
        {!data && !error && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}

        {data && data.totals.hands === 0 && (
          <div className="surface p-8 text-center text-sm text-gray-500 dark:text-gray-400">
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
                <div key={t.label} className="surface px-5 py-4">
                  <div className="text-[13px] font-medium text-gray-500 dark:text-gray-400">{t.label}</div>
                  <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${t.cls || 'text-gray-900 dark:text-white'}`}>{t.value}</div>
                </div>
              ))}
            </div>

            <section className="surface p-5 sm:p-6 mb-6">
              <h2 className="section-title mb-1">Profit over time</h2>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">
                Running total, one step per hand{data.truncated ? ` (your latest ${data.totals.hands.toLocaleString()} hands)` : ''}.
              </p>
              <ProfitChart points={data.series} />
            </section>

            <section className="surface overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6">
                <h2 className="section-title">Sessions</h2>
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
              <p className="text-[13px] text-gray-500 dark:text-gray-400 px-6 mt-1 mb-3">A break of more than two hours at a table starts a new session.</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Table</th>
                    <th className="text-right!">Hands</th>
                    <th className="text-right!">Duration</th>
                    <th className="text-right!">Net</th>
                    <th className="text-right!">Export</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map(s => {
                    const key = `${s.roomId}:${s.start}`;
                    return (
                      <tr key={key} className="text-gray-900 dark:text-gray-100">
                        <td className="whitespace-nowrap text-gray-600 dark:text-gray-300">{new Date(s.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td>
                          <Link href={`/history?room=${encodeURIComponent(s.roomId)}`} className={`${data.roomNames[s.roomId] ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'} hover:text-emerald-600 dark:hover:text-emerald-300`}>
                            {data.roomNames[s.roomId] || s.roomId}
                          </Link>
                        </td>
                        <td className="text-right tabular-nums">{s.hands}</td>
                        <td className="text-right tabular-nums text-gray-600 dark:text-gray-300">{formatDuration(s.durationMs)}</td>
                        <td className={`text-right tabular-nums font-semibold ${netClass(s.net)}`}>{signed(s.net)}</td>
                        <td className="text-right whitespace-nowrap">
                          <button
                            onClick={() => exportSession(s)}
                            disabled={exporting === key}
                            className="btn btn-ghost btn-sm h-8! px-2! disabled:opacity-60"
                            title="Export this session"
                            aria-label={exporting === key ? 'Exporting…' : 'Export'}
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => deleteSessions(s)}
                              disabled={deleting !== null}
                              aria-label={`Delete the session at ${data.roomNames[s.roomId] || s.roomId} on ${new Date(s.start).toLocaleString()}`}
                              className="btn btn-ghost btn-sm text-red-600 dark:text-red-400 disabled:opacity-60"
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
    </AppShell>
  );
}
