import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { authHeaders } from '../../src/utils/auth-headers';
import { formatMoney } from '../../src/lib/tournament/format';
import { loadPermissions, postTournamentAction } from '../../src/lib/tournament/client';
import type { TournamentSummary } from '../../src/lib/tournament/tournament-view';

type Filter = 'upcoming' | 'running' | 'finished';

const TABS: { key: Filter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'running', label: 'Running' },
  { key: 'finished', label: 'Finished' },
];

const statusText = (t: TournamentSummary) => {
  if (t.status === 'setup') return 'Registering';
  if (t.status === 'completed') return 'Finished';
  if (t.status === 'cancelled') return 'Cancelled';
  const state = t.status === 'paused' ? 'paused' : t.status === 'on-break' ? 'on break' : '';
  return `Level ${t.level}${state ? `, ${state}` : ''}`;
};

const button = 'px-3 py-1 rounded text-sm text-white disabled:opacity-50';

export default function TournamentLobbyPage() {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [canCreate, setCanCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/list?filter=${filter}`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Could not load tournaments (${res.status})`);
      setTournaments(body.tournaments);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load tournaments');
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSignedIn(!!authHeaders().Authorization);
    loadPermissions().then(p => setCanCreate(!!p?.includes('tournament.create')));
  }, []);

  const act = async (action: 'register' | 'unregister', id: string) => {
    setBusy(id);
    try {
      await postTournamentAction(action, { tournamentId: id });
      await load();
    } catch (err: any) {
      setError(err?.message || 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <Head><title>Tournaments</title></Head>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tournaments</h1>
        {canCreate && (
          <Link href="/tournaments/create" className="px-4 py-2 bg-blue-600 text-white rounded">Create tournament</Link>
        )}
      </div>

      <div role="tablist" className="flex gap-2 mb-4">
        {TABS.map(tab => (
          <button key={tab.key} role="tab" aria-selected={filter === tab.key}
            className={`px-3 py-1 rounded text-sm ${filter === tab.key ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
            onClick={() => { setTournaments(null); setFilter(tab.key); }}>
            {tab.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {!signedIn && <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Sign in to register.</p>}
      {tournaments === null && !error && <p>Loading…</p>}
      {tournaments?.length === 0 && <p className="text-gray-600 dark:text-gray-400">No {filter} tournaments.</p>}

      {tournaments && tournaments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400">
                <th className="py-2 pr-3">Tournament</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Players</th>
                <th className="py-2 pr-3">Buy-in</th>
                <th className="py-2 pr-3">Stack</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {tournaments.map(t => (
                <tr key={t.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="py-2 pr-3">
                    <Link href={`/tournaments/${t.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{t.name}</Link>
                    {t.bounty && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                        {t.bounty === 'progressive' ? 'PKO' : 'Knockout'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{statusText(t)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {t.status === 'setup' ? t.entrants : `${t.remaining} / ${t.entrants}`}{t.maxPlayers && t.status === 'setup' ? ` / ${t.maxPlayers}` : ''}
                  </td>
                  <td className="py-2 pr-3">{t.costs.entry > 0 ? formatMoney(t.costs.entry) : 'Free'}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.startingStack.toLocaleString()}</td>
                  <td className="py-2 whitespace-nowrap space-x-2 text-right">
                    {signedIn && t.you && !t.you.registered && t.registrationOpen && (
                      <button className={`${button} bg-green-600`} disabled={busy === t.id} onClick={() => act('register', t.id)}
                        aria-label={`Register for ${t.name}`}>
                        {t.status === 'setup' ? 'Register' : 'Late register'}
                      </button>
                    )}
                    {t.you?.registered && t.status === 'setup' && (
                      <button className={`${button} bg-gray-500`} disabled={busy === t.id} onClick={() => act('unregister', t.id)}
                        aria-label={`Unregister from ${t.name}`}>
                        Unregister
                      </button>
                    )}
                    {t.you?.registered && t.status !== 'setup' && <span className="text-xs text-gray-600 dark:text-gray-400">{t.you.eliminated ? 'Out' : 'Playing'}</span>}
                    {t.canManage && (
                      <Link href={`/tournaments/${t.id}/manage`} className="text-blue-600 dark:text-blue-400 hover:underline">Manage</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
