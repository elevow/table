import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AppShell, { PageHeader } from '../../src/components/AppShell';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import { downloadHandHistory } from '../../src/utils/download-hand-history';
import MiniCard from '../../src/components/MiniCard';
import { useDisplaySettings } from '../../src/hooks/useDisplaySettings';
import type { HandSummary } from '../../src/types/hand-record';

const VARIANT_LABEL: Record<string, string> = {
  'texas-holdem': "Hold'em",
  omaha: 'Omaha',
  'omaha-hi-lo': 'Omaha Hi-Lo',
  'seven-card-stud': '7-Card Stud',
  'seven-card-stud-hi-lo': 'Stud Hi-Lo',
  'five-card-stud': '5-Card Stud',
  razz: 'Razz',
  'omaha-5': '5-Card Omaha',
};

function variantLabel(v?: string) {
  if (!v) return '';
  const [base, extra] = v.split(' (');
  return (VARIANT_LABEL[base] || base) + (extra ? ` (${extra}` : '');
}

export default function HandHistoryPage() {
  const router = useRouter();
  const roomId = typeof router.query.room === 'string' ? router.query.room : '';
  // Cards follow the player's display settings (and this table's own setting when showing one table)
  const { highContrastCards } = useDisplaySettings(roomId || null).settings;
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  // PokerStars-format download: one hand by id, or every hand at this table (all tables when none)
  const exportHands = async (key: string, query: Record<string, string>) => {
    setExporting(key);
    try {
      await downloadHandHistory(query);
    } catch (e: any) {
      setError(e?.message || 'Could not export hands');
    } finally {
      setExporting(null);
    }
  };

  const load = useCallback(async (before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '25' });
      if (roomId) qs.set('roomId', roomId);
      if (before) qs.set('before', before);
      const resp = await fetch(`/api/history/hands?${qs}`, { headers: authHeaders() });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(resp.status === 401 ? 'Sign in to see your hand history.' : data?.error || 'Could not load hands');
      setHands(prev => (before ? [...prev, ...data.hands] : data.hands));
      setNextBefore(data.nextBefore);
    } catch (e: any) {
      setError(e?.message || 'Could not load hands');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (router.isReady) load(null);
  }, [router.isReady, load]);

  return (
    <AppShell>
      <Head><title>Hand History - Table</title></Head>
      <main className="page">
        <PageHeader
          title="Hand history"
          subtitle={roomId ? <>Hands from table <span className="font-mono">{roomId}</span>. Select a hand to replay it.</> : 'Every hand you played. Select one to replay it step by step.'}
          actions={<>
            {roomId && <Link href={`/game/${roomId}`} className="btn btn-secondary">Back to table</Link>}
            {roomId && <Link href="/history" className="btn btn-ghost">All tables</Link>}
            {hands.length > 0 && (
              <button
                onClick={() => exportHands('all', roomId ? { roomId } : {})}
                disabled={exporting === 'all'}
                className="btn btn-secondary"
                title={`Download ${roomId ? 'hands at this table' : 'your latest 1000 hands'} in PokerStars hand-history format`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                {exporting === 'all' ? 'Exporting…' : 'Export .txt'}
              </button>
            )}
          </>}
        />

        {error && <div role="alert" className="p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">{error}</div>}

        {loading && hands.length === 0 && (
          <div className="surface p-6 space-y-3 animate-pulse" aria-label="Loading">
            <div className="h-4 w-1/3 rounded-sm bg-gray-200 dark:bg-white/6" />
            <div className="h-4 w-1/2 rounded-sm bg-gray-200 dark:bg-white/6" />
          </div>
        )}

        {!error && !loading && hands.length === 0 && (
          <div className="surface px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8M3 3v5h5M12 7v5l3 2" /></svg>
            </div>
            <p className="text-base font-semibold text-gray-900 dark:text-white">No hands yet</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Hands you play are saved here when they finish.</p>
          </div>
        )}

        {hands.length > 0 && (
          <div className="surface overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Hand</th>
                  <th>When</th>
                  <th>Game</th>
                  <th>Your cards</th>
                  <th>Winner</th>
                  <th className="text-right!">Pot</th>
                  <th className="text-right!">You</th>
                  <th className="text-right!">Export</th>
                </tr>
              </thead>
              <tbody>
                {hands.map(h => {
                  const cards = h.myCards?.hole?.length ? h.myCards.hole : [...(h.myCards?.down || []), ...(h.myCards?.up || [])];
                  return (
                    <tr
                      key={h.id}
                      className="cursor-pointer text-gray-900 dark:text-gray-100"
                      onClick={() => router.push(`/history/${h.id}`)}
                    >
                      <td>
                        <Link href={`/history/${h.id}`} className="font-medium tabular-nums text-gray-900 hover:text-emerald-600 dark:text-white dark:hover:text-emerald-300" onClick={e => e.stopPropagation()}>
                          #{h.handNumber}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-gray-600 dark:text-gray-300">{new Date(h.endedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="whitespace-nowrap text-gray-600 dark:text-gray-300">{variantLabel(h.variant)}</td>
                      <td>
                        <div className="flex gap-0.5">{cards.map((c, i) => <MiniCard key={i} card={c} highContrast={highContrastCards} />)}</div>
                      </td>
                      <td className="text-gray-600 dark:text-gray-300">{h.winners.map(w => w.name).join(', ') || '—'}</td>
                      <td className="text-right tabular-nums">${h.pot}</td>
                      <td className={`text-right tabular-nums font-semibold ${h.myNet > 0 ? 'text-emerald-600 dark:text-emerald-400' : h.myNet < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        {h.myNet > 0 ? '+' : h.myNet < 0 ? '\u2212' : ''}{Math.abs(h.myNet)}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={e => { e.stopPropagation(); exportHands(h.id, { handId: h.id }); }}
                          disabled={exporting === h.id}
                          className="btn btn-ghost btn-sm h-8! px-2! disabled:opacity-60"
                          title="Export this hand"
                          aria-label={`Export hand #${h.handNumber}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {nextBefore && (
          <div className="mt-6 text-center">
            <button onClick={() => load(nextBefore)} disabled={loading} className="btn btn-secondary">
              {loading ? 'Loading…' : 'Older hands'}
            </button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
