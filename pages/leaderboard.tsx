import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import AppShell, { PageHeader } from '../src/components/AppShell';
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
  // Staff with admin.leaderboard can take players (test accounts) off the board and put them back
  const [canManage, setCanManage] = useState(false);
  const [hiddenPlayers, setHiddenPlayers] = useState<Array<{ userId: string; username: string | null; handsPlayed: number }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadBoard = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetch(`/api/stats/leaderboard?metric=${metric}&limit=25`)
      .then(async resp => {
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || 'Could not load the leaderboard');
        setEntries(data.items || []);
      })
      .catch(e => setError(e?.message || 'Could not load the leaderboard'))
      .finally(() => setLoading(false));
  }, [metric]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const loadHidden = useCallback(() => {
    return fetch('/api/admin/leaderboard', { headers: authHeaders() })
      .then(resp => (resp.ok ? resp.json() : null))
      .then(data => { if (data) setHiddenPlayers(data.hidden || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const headers = authHeaders();
    if (!headers.Authorization) return;
    fetch('/api/auth/check-admin', { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(me => {
        const allowed = !!me?.permissions?.includes('admin.leaderboard');
        setCanManage(allowed);
        if (allowed) loadHidden();
      })
      .catch(() => {});
  }, [loadHidden]);

  const setHidden = async (target: { userId: string; username?: string | null }, hidden: boolean) => {
    const name = target.username || `Player ${target.userId.slice(0, 6)}`;
    if (hidden && !window.confirm(`Remove ${name} from the leaderboard? Their own results stay as they are, and you can put them back.`)) return;
    setBusy(target.userId);
    setError(null);
    try {
      const resp = await fetch('/api/admin/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId: target.userId, hidden }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Could not change the leaderboard');
      await Promise.all([loadBoard(), loadHidden()]);
    } catch (e: any) {
      setError(e?.message || 'Could not change the leaderboard');
    } finally {
      setBusy(null);
    }
  };

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
    <AppShell>
      <Head><title>Leaderboard - Table</title></Head>
      <main className="page">
        <PageHeader title="Leaderboard" subtitle="Who's on top across every table." />

        <div className="segmented mb-5" role="tablist" aria-label="Rank by">
          {METRICS.map(m => (
            <button
              key={m.key}
              role="tab"
              aria-selected={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {error && <div className="p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">{error}</div>}

        <div className="surface overflow-x-auto mb-12">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-14">#</th>
                <th className="w-full">Player</th>
                <th className="text-right!">{current.label}</th>
                <th className="text-right!">Hands</th>
                {canManage && <th><span className="sr-only">Manage</span></th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={canManage ? 5 : 4} className="text-gray-500 dark:text-gray-400">Loading…</td></tr>}
              {!loading && entries.length === 0 && (
                <tr><td colSpan={canManage ? 5 : 4} className="py-10! text-center text-gray-500 dark:text-gray-400">No hands played yet. Rankings appear once hands are finished.</td></tr>
              )}
              {!loading && entries.map(e => (
                <tr
                  key={e.userId}
                  className={`text-gray-900 dark:text-gray-100 ${e.userId === userId ? 'bg-emerald-50 dark:bg-emerald-400/6 font-semibold' : ''}`}
                >
                  <td>
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                      e.rank === 1 ? 'bg-amber-400/20 text-amber-600 dark:text-amber-300'
                        : e.rank === 2 ? 'bg-gray-300/40 text-gray-700 dark:bg-gray-300/15 dark:text-gray-200'
                        : e.rank === 3 ? 'bg-orange-400/20 text-orange-700 dark:text-orange-300'
                        : 'text-gray-500 dark:text-gray-400'}`}>{e.rank}</span>
                  </td>
                  <td>{e.username || `Player ${e.userId.slice(0, 6)}`}{e.userId === userId && <span className="badge badge-emerald ml-2">You</span>}</td>
                  <td className={`text-right tabular-nums ${current.money && e.value < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{format(e.value)}</td>
                  <td className="text-right tabular-nums text-gray-600 dark:text-gray-300">{(e.handsPlayed ?? 0).toLocaleString()}</td>
                  {canManage && (
                    <td className="text-right">
                      <button
                        onClick={() => setHidden(e, true)}
                        disabled={busy !== null}
                        aria-label={`Remove ${e.username || `Player ${e.userId.slice(0, 6)}`} from the leaderboard`}
                        className="text-xs font-normal text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                      >
                        {busy === e.userId ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage && hiddenPlayers.length > 0 && (
          <section aria-label="Removed from the leaderboard" className="surface p-5 mb-12 -mt-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Removed from the leaderboard</h2>
            <ul className="text-sm divide-y divide-gray-100 dark:divide-gray-700">
              {hiddenPlayers.map(p => (
                <li key={p.userId} className="flex items-center justify-between py-1.5 text-gray-900 dark:text-gray-100">
                  <span>{p.username || `Player ${p.userId.slice(0, 6)}`} <span className="text-xs text-gray-500 dark:text-gray-400">· {p.handsPlayed.toLocaleString()} hands</span></span>
                  <button
                    onClick={() => setHidden(p, false)}
                    disabled={busy !== null}
                    className="link text-xs disabled:opacity-60"
                  >
                    {busy === p.userId ? 'Restoring…' : 'Put back'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Achievements</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {userId ? 'Milestones you unlock by playing.' : 'Sign in to track your achievements.'}
            </p>
          </div>
          {userId && (
            <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
              <span className="tabular-nums">{Object.keys(earned).length} of {ACHIEVEMENTS.length}</span>
              <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${(Object.keys(earned).length / ACHIEVEMENTS.length) * 100}%` }} />
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ACHIEVEMENTS.map(a => {
            const when = earned[a.type];
            return (
              <div
                key={a.type}
                className={`min-h-[92px] ${when ? 'surface p-4' : 'surface-muted p-4 border-dashed'}`}
              >
                <div className="flex items-start gap-4">
                  <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${when ? 'bg-emerald-400/10' : 'bg-gray-200/60 dark:bg-white/5'}`} aria-hidden="true">
                    <span className={when ? '' : 'grayscale-50 opacity-75'}>{a.icon}</span>
                    {!when && (
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-500 ring-2 ring-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-900">
                        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v2H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1V6a4 4 0 00-4-4zm2 6V6a2 2 0 10-4 0v2h4z" clipRule="evenodd" /></svg>
                      </span>
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${when ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>{a.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{a.description}</div>
                    {when && <div className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Earned {new Date(when).toLocaleDateString()}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}
