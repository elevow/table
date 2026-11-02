import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import { formatMoney, ordinal } from '../../src/lib/tournament/format';
import { postTournamentAction } from '../../src/lib/tournament/client';
import { useTournamentView } from '../../src/lib/tournament/use-tournament-view';
import TournamentClock from '../../src/components/tournament/TournamentClock';
import type { TournamentView } from '../../src/lib/tournament/tournament-view';

const statusLabel: Record<TournamentView['status'], string> = {
  setup: 'Registering', running: 'Running', paused: 'Paused', 'on-break': 'On break', completed: 'Finished', cancelled: 'Cancelled',
};

const card = 'rounded-lg bg-gray-50 dark:bg-gray-800 p-4';

export default function TournamentPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : null;
  const { view, error, reload, levelLeft, breakLeft } = useTournamentView(id);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setSignedIn(!!authHeaders().Authorization), []);

  const act = async (action: 'register' | 'unregister' | 'rebuy' | 'add-on') => {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      await postTournamentAction(action, { tournamentId: id });
      await reload();
    } catch (err: any) {
      setActionError(err?.message || 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div className="container mx-auto p-6">
        {error ? <p role="alert" className="text-red-600">{error}</p> : <p>Loading tournament…</p>}
      </div>
    );
  }

  const finisherAt = (place: number) => view.finishers.find(f => f.place === place);

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <Head><title>{view.name}</title></Head>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{view.name}</h1>
        <span className="text-sm px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{statusLabel[view.status]}</span>
        {error && <span role="alert" className="text-sm text-amber-700 dark:text-amber-400">Couldn&apos;t refresh: {error}</span>}
      </div>

      <TournamentClock view={view} levelLeft={levelLeft} breakLeft={breakLeft} />

      <Actions view={view} signedIn={signedIn} busy={busy} onAct={act} />
      {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}

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

      {view.tables.length > 0 && view.status !== 'completed' && (
        <section aria-label="Tables">
          <h2 className="text-lg font-semibold mb-2">Tables</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {view.tables.map(tb => (
              <div key={tb.number} className={card}>
                <p className="font-medium mb-1">Table {tb.number}</p>
                <ul className="text-sm space-y-0.5">
                  {tb.players.map(p => <li key={p.userId}>Seat {p.seat}: {p.name}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

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

/** What the viewer can do here: register, unregister, rebuy, take the add-on, or run the tournament. */
function Actions({ view, signedIn, busy, onAct }: {
  view: TournamentView;
  signedIn: boolean;
  busy: boolean;
  onAct: (action: 'register' | 'unregister' | 'rebuy' | 'add-on') => void;
}) {
  const btn = 'px-4 py-2 rounded text-white disabled:opacity-50';
  const cost = (n: number | null) => (n ? ` (${formatMoney(n)})` : '');
  const items: React.ReactNode[] = [];
  if (!view.you && view.registration.open && signedIn) {
    items.push(
      <button key="register" className={`${btn} bg-green-600`} disabled={busy} onClick={() => onAct('register')}>
        {view.status === 'setup' ? 'Register' : 'Late register'}{cost(view.costs.entry)}
      </button>
    );
  }
  if (!view.you && view.registration.full && view.status === 'setup') items.push(<span key="full">Registration is full</span>);
  if (!view.you && !signedIn && view.registration.open) items.push(<span key="signin">Sign in to register</span>);
  if (view.you?.canUnregister) {
    items.push(<button key="unregister" className={`${btn} bg-gray-500`} disabled={busy} onClick={() => onAct('unregister')}>Unregister</button>);
  }
  if (view.you?.canRebuy) {
    items.push(
      <button key="rebuy" className={`${btn} bg-blue-600`} disabled={busy} onClick={() => onAct('rebuy')}>
        {view.you.eliminated ? 'Rebuy and return' : 'Rebuy'}{cost(view.costs.rebuy)}
      </button>
    );
  }
  if (view.you?.canAddOn) {
    items.push(
      <button key="addon" className={`${btn} bg-blue-600`} disabled={busy} onClick={() => onAct('add-on')}>Take the add-on{cost(view.costs.addOn)}</button>
    );
  }
  if (view.canManage) {
    items.push(<Link key="manage" href={`/tournaments/${view.id}/manage`} className="text-blue-600 dark:text-blue-400 hover:underline">Director controls</Link>);
  }
  if (items.length === 0) return null;
  return <section aria-label="Actions" className="flex flex-wrap items-center gap-3">{items}</section>;
}
