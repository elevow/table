import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatMoney, ordinal } from '../../../src/lib/tournament/format';
import { postTournamentAction } from '../../../src/lib/tournament/client';
import { useTournamentView } from '../../../src/lib/tournament/use-tournament-view';
import TournamentClock from '../../../src/components/tournament/TournamentClock';

const btn = 'px-4 py-2 rounded text-white disabled:opacity-50';
const card = 'rounded-lg bg-gray-50 dark:bg-gray-800 p-4';
const select =
  'border border-gray-300 dark:border-gray-600 rounded p-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100';

/** The director's screen: run the clock, record knockouts, and take rebuys and add-ons at the desk. */
export default function ManageTournamentPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : null;
  const { view, error, reload, levelLeft, breakLeft } = useTournamentView(id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [out, setOut] = useState('');
  const [by, setBy] = useState('');
  const [deskPlayer, setDeskPlayer] = useState('');

  // Players still in, by table and seat; and everyone who has played, for rebuys
  const seated = useMemo(
    () => (view?.tables ?? []).flatMap(tb => tb.players.map(p => ({ ...p, label: `${p.name} (table ${tb.number}, seat ${p.seat})` }))),
    [view]
  );
  const everyone = useMemo(() => {
    const finished = (view?.finishers ?? []).filter(f => !seated.some(s => s.userId === f.userId));
    return [...seated.map(s => ({ userId: s.userId, label: s.name })), ...finished.map(f => ({ userId: f.userId, label: `${f.name} (out)` }))]
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [view, seated]);

  const run = async (action: string, body: Record<string, unknown>, done: string) => {
    if (!id) return;
    setBusy(true);
    setMessage(null);
    try {
      await postTournamentAction(action, { tournamentId: id, ...body });
      setMessage({ kind: 'ok', text: done });
      await reload();
      return true;
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'That did not work' });
      return false;
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
  if (!view.canManage) {
    return (
      <div className="container mx-auto p-6 space-y-2">
        <p>Only the tournament director can run {view.name}.</p>
        <Link href={`/tournaments/${view.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">Back to the tournament</Link>
      </div>
    );
  }

  const nameOf = (userId: string) => seated.find(p => p.userId === userId)?.name ?? everyone.find(p => p.userId === userId)?.label ?? userId;
  const inPlay = view.status === 'running' || view.status === 'paused' || view.status === 'on-break';
  const bountyRequired = !!view.bounty;

  const eliminate = async () => {
    if (!out) return;
    const knocker = by ? ` by ${nameOf(by)}` : '';
    if (!window.confirm(`Eliminate ${nameOf(out)}${knocker}?`)) return;
    const ok = await run('eliminate', { userId: out, ...(by ? { eliminatedBy: by } : {}) }, `${nameOf(out)} is out`);
    if (ok) { setOut(''); setBy(''); }
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <Head><title>{`Run ${view.name}`}</title></Head>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Run {view.name}</h1>
        <Link href={`/tournaments/${view.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">Player view</Link>
      </div>
      {error && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">Couldn&apos;t refresh: {error}</p>}

      <TournamentClock view={view} levelLeft={levelLeft} breakLeft={breakLeft} />

      <section aria-label="Clock controls" className="flex flex-wrap items-center gap-3">
        {view.status === 'setup' && (
          <button className={`${btn} bg-green-600`} disabled={busy || view.players.entrants < 2} onClick={() => run('start', {}, 'Tournament started')}>
            Start tournament ({view.players.entrants} registered)
          </button>
        )}
        {(view.status === 'running' || view.status === 'on-break') && (
          <button className={`${btn} bg-amber-600`} disabled={busy} onClick={() => run('pause', {}, 'Paused')}>Pause</button>
        )}
        {view.status === 'paused' && (
          <button className={`${btn} bg-green-600`} disabled={busy} onClick={() => run('resume', {}, 'Resumed')}>Resume</button>
        )}
        {view.status === 'running' && view.nextLevel && (
          <button className={`${btn} bg-blue-600`} disabled={busy} onClick={() => run('advance-level', {}, 'Moved to the next level')}>Next level now</button>
        )}
        {view.onBreak && (
          <button className={`${btn} bg-blue-600`} disabled={busy} onClick={() => run('end-break', {}, 'Break ended')}>End break now</button>
        )}
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {view.players.remaining} of {view.players.entrants} left · prize pool {formatMoney(view.prizePool)}
        </span>
      </section>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-green-700 dark:text-green-400'}`}>
          {message.text}
        </p>
      )}

      {inPlay && (
        <section aria-label="Eliminate a player" className={`${card} space-y-2`}>
          <h2 className="text-lg font-semibold">Eliminate a player</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Player out
              <select className={`${select} block`} value={out} onChange={e => { setOut(e.target.value); if (e.target.value === by) setBy(''); }}>
                <option value="">Choose…</option>
                {seated.map(p => <option key={p.userId} value={p.userId}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              Knocked out by{bountyRequired ? '' : ' (optional)'}
              <select className={`${select} block`} value={by} onChange={e => setBy(e.target.value)}>
                <option value="">{bountyRequired ? 'Choose…' : 'Not recorded'}</option>
                {seated.filter(p => p.userId !== out).map(p => <option key={p.userId} value={p.userId}>{p.label}</option>)}
              </select>
            </label>
            <button className={`${btn} bg-red-600`} disabled={busy || !out || (bountyRequired && !by)} onClick={eliminate}>Eliminate</button>
          </div>
          {bountyRequired && <p className="text-xs text-gray-600 dark:text-gray-400">Knockout tournament: the bounty goes to the player who made the knockout.</p>}
        </section>
      )}

      {inPlay && (view.costs.rebuy !== null || view.costs.addOn !== null) && (
        <section aria-label="Desk" className={`${card} space-y-2`}>
          <h2 className="text-lg font-semibold">Rebuys and add-ons at the desk</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Player
              <select className={`${select} block`} value={deskPlayer} onChange={e => setDeskPlayer(e.target.value)}>
                <option value="">Choose…</option>
                {everyone.map(p => <option key={p.userId} value={p.userId}>{p.label}</option>)}
              </select>
            </label>
            {view.costs.rebuy !== null && (
              <button className={`${btn} bg-blue-600`} disabled={busy || !deskPlayer}
                onClick={() => run('rebuy', { forPlayer: deskPlayer }, `Rebuy recorded for ${nameOf(deskPlayer)}`)}>
                Rebuy ({formatMoney(view.costs.rebuy)})
              </button>
            )}
            {view.costs.addOn !== null && (
              <button className={`${btn} bg-blue-600`} disabled={busy || !deskPlayer}
                onClick={() => run('add-on', { forPlayer: deskPlayer }, `Add-on recorded for ${nameOf(deskPlayer)}`)}>
                Add-on ({formatMoney(view.costs.addOn)})
              </button>
            )}
          </div>
        </section>
      )}

      {view.tables.length > 0 && view.status !== 'completed' && (
        <section aria-label="Tables">
          <h2 className="text-lg font-semibold mb-2">Tables</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {view.tables.map(tb => (
              <div key={tb.number} className={card}>
                <p className="font-medium mb-1">Table {tb.number} · {tb.players.length} players</p>
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
          <h2 className="text-lg font-semibold mb-2">Results</h2>
          <ol className="text-sm space-y-0.5">
            {view.finishers.map(f => (
              <li key={`${f.place}-${f.userId}`}>
                {ordinal(f.place)}: {f.name}{f.prize > 0 ? `, ${formatMoney(f.prize)}` : ''}
                {f.eliminatedBy ? ` (knocked out by ${nameOf(f.eliminatedBy)})` : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
