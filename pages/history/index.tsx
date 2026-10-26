import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import MiniCard from '../../src/components/MiniCard';
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
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head><title>Hand History - Table</title></Head>
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Hand History</h1>
          <div className="flex gap-3 text-sm">
            {roomId && <Link href={`/game/${roomId}`} className="text-blue-600 dark:text-blue-400 hover:underline">Back to table</Link>}
            {roomId && <Link href="/history" className="text-blue-600 dark:text-blue-400 hover:underline">All tables</Link>}
            <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">Dashboard</Link>
          </div>
        </div>
        {roomId && <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Showing hands from table {roomId}.</p>}

        {error && <div className="p-3 mb-4 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 text-sm">{error}</div>}

        {!error && !loading && hands.length === 0 && (
          <div className="p-6 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            No hands yet. Hands you play are saved here when they finish.
          </div>
        )}

        {hands.length > 0 && (
          <div className="overflow-x-auto rounded-lg shadow bg-white dark:bg-gray-800">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-3 py-2">Hand</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2">Your cards</th>
                  <th className="px-3 py-2">Winner</th>
                  <th className="px-3 py-2 text-right">Pot</th>
                  <th className="px-3 py-2 text-right">You</th>
                </tr>
              </thead>
              <tbody>
                {hands.map(h => {
                  const cards = h.myCards?.hole?.length ? h.myCards.hole : [...(h.myCards?.down || []), ...(h.myCards?.up || [])];
                  return (
                    <tr
                      key={h.id}
                      className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-gray-900 dark:text-gray-100"
                      onClick={() => router.push(`/history/${h.id}`)}
                    >
                      <td className="px-3 py-2">
                        <Link href={`/history/${h.id}`} className="text-blue-600 dark:text-blue-400 hover:underline" onClick={e => e.stopPropagation()}>
                          #{h.handNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(h.endedAt).toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{variantLabel(h.variant)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-0.5">{cards.map((c, i) => <MiniCard key={i} card={c} />)}</div>
                      </td>
                      <td className="px-3 py-2">{h.winners.map(w => w.name).join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${h.pot}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${h.myNet > 0 ? 'text-emerald-600 dark:text-emerald-400' : h.myNet < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                        {h.myNet > 0 ? '+' : ''}{h.myNet}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {nextBefore && (
          <div className="mt-4 text-center">
            <button
              onClick={() => load(nextBefore)}
              disabled={loading}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm"
            >
              {loading ? 'Loading…' : 'Older hands'}
            </button>
          </div>
        )}
        {loading && hands.length === 0 && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}
      </main>
    </div>
  );
}
