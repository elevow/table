import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AppShell, { PageHeader } from '../../src/components/AppShell';
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
  if (t.status === 'setup') {
    return t.startsAt
      ? `Starts ${new Date(t.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
      : 'Registering';
  }
  if (t.status === 'completed') return 'Finished';
  if (t.status === 'cancelled') return 'Cancelled';
  const state = t.status === 'paused' ? 'paused' : t.status === 'on-break' ? 'on break' : '';
  return `Level ${t.level}${state ? `, ${state}` : ''}`;
};



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
    <AppShell>
    <main className="page">
      <Head><title>Tournaments - Table</title></Head>
      <PageHeader
        title="Tournaments"
        subtitle="Scheduled events with rising blinds. Register, then take your seat when it starts."
        actions={canCreate && (
          <Link href="/tournaments/create" className="btn btn-primary">Create tournament</Link>
        )}
      />

      <div role="tablist" className="segmented mb-5">
        {TABS.map(tab => (
          <button key={tab.key} role="tab" aria-selected={filter === tab.key}
            onClick={() => { setTournaments(null); setFilter(tab.key); }}>
            {tab.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!signedIn && <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">Sign in to register.</p>}
      {tournaments === null && !error && (
        <div className="surface p-6 space-y-3 animate-pulse" aria-label="Loading">
          <div className="h-4 w-1/3 rounded-sm bg-gray-200 dark:bg-white/6" />
          <div className="h-4 w-1/2 rounded-sm bg-gray-200 dark:bg-white/6" />
        </div>
      )}
      {tournaments?.length === 0 && (
        <div className="surface px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/10 text-amber-500 dark:text-amber-300">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3" /></svg>
          </div>
          <p className="text-base font-semibold text-gray-900 dark:text-white">No {filter} tournaments</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {filter === 'upcoming' ? 'When one is scheduled, it will show up here for registration.' : 'Check the other tabs for more events.'}
          </p>
          {canCreate && filter === 'upcoming' && (
            <Link href="/tournaments/create" className="btn btn-secondary mt-5">Create tournament</Link>
          )}
        </div>
      )}

      {tournaments && tournaments.length > 0 && (
        <div className="surface overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Status</th>
                <th>Players</th>
                <th>Buy-in</th>
                <th>Stack</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tournaments.map(t => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tournaments/${t.id}`} className="font-medium text-gray-900 hover:text-emerald-600 dark:text-white dark:hover:text-emerald-300">{t.name}</Link>
                    {t.visibility === 'private' && <span className="badge ml-2">Private</span>}
                    {t.reentry && (
                      <span className="badge badge-emerald ml-2">Re-entry</span>
                    )}
                    {t.bounty && (
                      <span className="badge badge-amber ml-2">
                        {t.bounty === 'progressive' ? 'PKO' : 'Knockout'}
                      </span>
                    )}
                  </td>
                  <td className="text-gray-600 dark:text-gray-300">{statusText(t)}</td>
                  <td className="tabular-nums">
                    {t.status === 'setup' ? t.entrants : `${t.remaining} / ${t.entrants}`}{t.maxPlayers && t.status === 'setup' ? ` / ${t.maxPlayers}` : ''}
                  </td>
                  <td>{t.costs.entry > 0 ? formatMoney(t.costs.entry) : 'Free'}</td>
                  <td className="tabular-nums">{t.startingStack.toLocaleString()}</td>
                  <td className="whitespace-nowrap space-x-2 text-right">
                    {signedIn && t.you && !t.you.registered && t.registrationOpen && (
                      <button className="btn btn-primary btn-sm" disabled={busy === t.id} onClick={() => act('register', t.id)}
                        aria-label={`Register for ${t.name}`}>
                        {t.status === 'setup' ? 'Register' : 'Late register'}
                      </button>
                    )}
                    {t.you?.registered && t.status === 'setup' && (
                      <button className="btn btn-secondary btn-sm" disabled={busy === t.id} onClick={() => act('unregister', t.id)}
                        aria-label={`Unregister from ${t.name}`}>
                        Unregister
                      </button>
                    )}
                    {t.you?.registered && t.status !== 'setup' && <span className="text-xs text-gray-500 dark:text-gray-400">{t.you.eliminated ? 'Out' : 'Playing'}</span>}
                    {t.canManage && (
                      <Link href={`/tournaments/${t.id}/manage`} className="btn btn-ghost btn-sm">Manage</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
    </AppShell>
  );
}
