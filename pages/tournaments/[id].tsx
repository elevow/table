import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import { formatClock, formatMoney } from '../../src/lib/tournament/format';
import type { LevelView, TournamentView } from '../../src/lib/tournament/tournament-view';

const POLL_MS = 5000;

const blinds = (l: LevelView) =>
  `${l.smallBlind.toLocaleString()}/${l.bigBlind.toLocaleString()}${l.ante ? ` ante ${l.ante.toLocaleString()}` : ''}`;

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const statusLabel: Record<TournamentView['status'], string> = {
  setup: 'Registering', running: 'Running', paused: 'Paused', 'on-break': 'On break', completed: 'Finished', cancelled: 'Cancelled',
};

const card = 'rounded-lg bg-gray-50 dark:bg-gray-800 p-4';

export default function TournamentPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : null;
  const [view, setView] = useState<TournamentView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/tournaments/view?tournamentId=${encodeURIComponent(id)}`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Could not load the tournament (${res.status})`);
      const at = Date.now();
      setView(body);
      setFetchedAt(at);
      setNow(at);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the tournament');
    }
  }, [id]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  if (!view) {
    return (
      <div className="container mx-auto p-6">
        {error ? <p role="alert" className="text-red-600">{error}</p> : <p>Loading tournament…</p>}
      </div>
    );
  }

  // Count down locally between polls; a paused clock stands still
  const elapsed = view.status === 'paused' ? 0 : Math.max(0, now - fetchedAt);
  const levelLeft = view.levelRemainingMs !== null ? view.levelRemainingMs - (view.status === 'running' ? elapsed : 0) : null;
  const breakLeft = view.breakRemainingMs !== null ? view.breakRemainingMs - (view.status === 'on-break' ? elapsed : 0) : null;
  const finisherAt = (place: number) => view.finishers.find(f => f.place === place);

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <Head><title>{view.name}</title></Head>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{view.name}</h1>
        <span className="text-sm px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{statusLabel[view.status]}</span>
        {error && <span role="alert" className="text-sm text-amber-700 dark:text-amber-400">Couldn&apos;t refresh: {error}</span>}
      </div>

      <section aria-label="Clock" className={`${card} text-center`}>
        {view.status === 'setup' && <p className="text-lg">Waiting to start. First level: {view.nextLevel && blinds(view.nextLevel)}</p>}
        {view.onBreak && breakLeft !== null && (
          <>
            <p className="text-sm uppercase tracking-wide text-amber-700 dark:text-amber-300">Break{view.status === 'paused' ? ' (paused)' : ''}</p>
            <p className="text-5xl font-bold tabular-nums my-2">{formatClock(breakLeft)}</p>
            {view.level && <p>Back with level {view.level.number}: {blinds(view.level)}</p>}
          </>
        )}
        {!view.onBreak && view.level && view.status !== 'setup' && (
          <>
            <p className="text-sm uppercase tracking-wide text-gray-600 dark:text-gray-400">
              Level {view.level.number}{view.status === 'paused' ? ' (paused)' : ''}
            </p>
            <p className="text-3xl font-semibold my-1">{blinds(view.level)}</p>
            {levelLeft !== null && view.status !== 'completed' && (
              <p className="text-5xl font-bold tabular-nums my-2">{view.nextLevel ? formatClock(levelLeft) : 'Final level'}</p>
            )}
            {view.nextLevel && view.status !== 'completed' && <p className="text-gray-600 dark:text-gray-400">Next: {blinds(view.nextLevel)}</p>}
          </>
        )}
      </section>

      <section aria-label="Summary" className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        <div className={card}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Players left</p>
          <p className="text-2xl font-semibold">{view.players.remaining} / {view.players.entrants}</p>
        </div>
        <div className={card}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Average stack</p>
          <p className="text-2xl font-semibold">{view.averageStack !== null ? view.averageStack.toLocaleString() : '–'}</p>
        </div>
        <div className={card}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Prize pool</p>
          <p className="text-2xl font-semibold">{formatMoney(view.prizePool)}</p>
        </div>
        <div className={card}>
          <p className="text-sm text-gray-600 dark:text-gray-400">{view.bounty ? 'Bounty pool' : 'Chips in play'}</p>
          <p className="text-2xl font-semibold">{view.bounty ? formatMoney(view.bounty.total) : view.chipsInPlay.toLocaleString()}</p>
        </div>
      </section>

      {view.you && (
        <section aria-label="You" className={`${card} flex flex-wrap gap-x-8 gap-y-1`}>
          <span className="font-semibold">You</span>
          {view.you.place !== null
            ? <span>Finished {ordinal(view.you.place)}{finisherAt(view.you.place)?.prize ? `, won ${formatMoney(finisherAt(view.you.place)!.prize)}` : ''}</span>
            : view.you.table !== null && <span>Table {view.you.table}, seat {view.you.seat}</span>}
          {view.you.bounty !== null && <span>Bounty on you: {formatMoney(view.you.bounty)}</span>}
          {view.bounty && <span>Bounties won: {formatMoney(view.you.bountyWon)}</span>}
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section aria-label="Payouts">
          <h2 className="text-lg font-semibold mb-2">Payouts</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            Top {view.players.paidPlaces} paid{view.status !== 'completed' && view.status !== 'setup' ? `, ${view.players.remaining} left` : ''}
          </p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-600 dark:text-gray-400"><th className="py-1">Place</th><th className="py-1">Prize</th><th className="py-1">Player</th></tr></thead>
            <tbody>
              {view.payouts.map(p => (
                <tr key={p.place} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="py-1">{ordinal(p.place)}</td>
                  <td className="py-1 tabular-nums">{formatMoney(p.amount)} <span className="text-gray-500">({p.percentage}%)</span></td>
                  <td className="py-1">{finisherAt(p.place)?.name ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {view.bounty && (
          <section aria-label="Bounties">
            <h2 className="text-lg font-semibold mb-2">Bounties</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {formatMoney(view.bounty.amount)} {view.bounty.type === 'progressive'
                ? 'progressive: knock a player out to win half their bounty; the other half goes on yours'
                : 'per knockout'}
            </p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-600 dark:text-gray-400"><th className="py-1">Player</th><th className="py-1">Won</th><th className="py-1">On their head</th></tr></thead>
              <tbody>
                {view.bounty.board.map(b => (
                  <tr key={b.userId} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="py-1">{b.name}</td>
                    <td className="py-1 tabular-nums">{formatMoney(b.won)}</td>
                    <td className="py-1 tabular-nums">{b.bounty !== null ? formatMoney(b.bounty) : 'Out'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {view.finishers.length > 0 && (
        <section aria-label="Results">
          <h2 className="text-lg font-semibold mb-2">Results so far</h2>
          <ol className="text-sm space-y-0.5">
            {view.finishers.map(f => (
              <li key={`${f.place}-${f.userId}`}>
                {ordinal(f.place)}: {f.name}{f.prize > 0 ? `, ${formatMoney(f.prize)}` : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
