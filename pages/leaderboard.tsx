import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { authHeaders } from '../src/utils/auth-headers';
import { resolveSessionUserId } from '../src/utils/session-identity';
import { ACHIEVEMENTS } from '../src/lib/shared/achievements';

type Metric = 'total_profit' | 'hands_won' | 'hands_played' | 'biggest_pot';

const METRICS: Array<{ key: Metric; label: string; money: boolean }> = [
  { key: 'total_profit', label: 'Profit', money: true },
  { key: 'hands_won', label: 'Pots won', money: false },
  { key: 'hands_played', label: 'Hands played', money: false },
  { key: 'biggest_pot', label: 'Biggest pot', money: true },
];

interface Entry {
  userId: string;
  username?: string | null;
  value: number;
  handsPlayed?: number;
  rank: number;
}

export default function LeaderboardPage() {
  const [metric, setMetric] = useState<Metric>('total_profit');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [earned, setEarned] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/stats/leaderboard?metric=${metric}&limit=25`)
      .then(async resp => {
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || 'Could not load the leaderboard');
        setEntries(data.items || []);
      })
      .catch(e => setError(e?.message || 'Could not load the leaderboard'))
      .finally(() => setLoading(false));
  }, [metric]);

  useEffect(() => {
    resolveSessionUserId().then(id => {
      setUserId(id);
      if (!id) return;
      fetch(`/api/stats/achievements/list?userId=${encodeURIComponent(id)}&limit=100`, { headers: authHeaders() })
        .then(resp => resp.json())
        .then(data => {
          const map: Record<string, string> = {};
          (data.items || []).forEach((a: any) => { map[a.achievementType] = a.achievedAt; });
          setEarned(map);
        })
        .catch(() => {});
    });
  }, []);

  const current = METRICS.find(m => m.key === metric)!;
  const format = (v: number) => (current.money ? `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString()}` : v.toLocaleString());

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head><title>Leaderboard - Table</title></Head>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Leaderboard</h1>
          <div className="flex gap-3 text-sm">
            <Link href="/history" className="text-blue-600 dark:text-blue-400 hover:underline">Hand history</Link>
            <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">Dashboard</Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Rank by">
          {METRICS.map(m => (
            <button
              key={m.key}
              role="tab"
              aria-selected={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={`px-4 py-1.5 rounded-full text-sm border ${metric === m.key
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {error && <div className="p-3 mb-4 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 text-sm">{error}</div>}

        <div className="overflow-x-auto rounded-lg shadow bg-white dark:bg-gray-800 mb-10">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2 w-12">#</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2 text-right">{current.label}</th>
                <th className="px-3 py-2 text-right">Hands</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="px-3 py-4 text-gray-500 dark:text-gray-400">Loading…</td></tr>}
              {!loading && entries.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-gray-500 dark:text-gray-400">No hands played yet.</td></tr>
              )}
              {!loading && entries.map(e => (
                <tr
                  key={e.userId}
                  className={`border-b border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 ${e.userId === userId ? 'bg-blue-50 dark:bg-blue-900/30 font-semibold' : ''}`}
                >
                  <td className="px-3 py-2">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</td>
                  <td className="px-3 py-2">{e.username || `Player ${e.userId.slice(0, 6)}`}{e.userId === userId ? ' (you)' : ''}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${current.money && e.value < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{format(e.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(e.handsPlayed ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Achievements</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          {userId
            ? `${Object.keys(earned).length} of ${ACHIEVEMENTS.length} earned.`
            : 'Sign in to track your achievements.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ACHIEVEMENTS.map(a => {
            const when = earned[a.type];
            return (
              <div
                key={a.type}
                className={`rounded-lg p-4 shadow ${when ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-800/50 opacity-60'}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-3xl ${when ? '' : 'grayscale'}`} aria-hidden="true">{a.icon}</span>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{a.label}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">{a.description}</div>
                    {when && <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Earned {new Date(when).toLocaleDateString()}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
