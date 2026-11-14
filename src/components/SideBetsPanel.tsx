import React, { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth-headers';
import {
  MAX_SIDE_BET_STAKE, SIDE_BETS, SIDE_BET_INFO, SUIT_SYMBOLS, bestSuitForHand, formatMoney,
  type SideBetKey, type SideBetStakes,
} from '../lib/shared/side-bets';

interface BetView {
  bet: SideBetKey;
  stake: number;
  players: string[];
  joined: boolean;
  pick: string | null;
  pot?: number;
}

interface ChallengeView {
  id: string;
  challengerId: string;
  challengerName: string;
  opponentId: string;
  opponentName: string;
  stake: number;
  status: 'pending' | 'active';
}

interface SideBetsResponse {
  bets: BetView[];
  stakes: SideBetStakes;
  canConfigure: boolean;
  seated: boolean;
  // Seated players, for picking one (next hand winner) or challenging one (head to head)
  players?: Array<{ id: string; name: string }>;
  me?: string;
  challenges?: ChallengeView[];
}

interface Props {
  tableId: string;
  // The hand being played, so best suit can show its suit
  handNumber?: number;
  // Changes after each hand and when side bets change, to reload
  refreshKey: unknown;
}

/**
 * The Side bets tab: join or leave each side bet the host turned on, make your pick, and see
 * who else is in and what is in the pots. The host turns side bets on and sets the stakes here
 * too. Side bets are separate money from the chips; results show in the Session tab.
 */
export default function SideBetsPanel({ tableId, handNumber, refreshKey }: Props) {
  const [data, setData] = useState<SideBetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!tableId) return;
    fetch(`/api/games/side-bets?tableId=${encodeURIComponent(tableId)}`, { headers: authHeaders() })
      .then(resp => (resp.ok ? resp.json() : null))
      .then(d => { if (d) setData(d); })
      .catch(() => {});
  }, [tableId]);

  useEffect(() => {
    // Give the server a moment to settle the hand that just ended
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  const send = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const resp = await fetch('/api/games/side-bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tableId, ...body }),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(result.error || 'Something went wrong');
        return false;
      }
      if (result.nextHand) setNotice('Counts from the next hand.');
      load();
      return true;
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading side bets…</p>;

  const startEditing = () => {
    setDraft(Object.fromEntries(SIDE_BETS.map(b => [b, data.stakes[b] ? String(data.stakes[b]) : ''])));
    setEditing(true);
  };
  const saveStakes = async () => {
    const stakes: Record<string, number> = {};
    for (const b of SIDE_BETS) {
      const n = parseFloat(draft[b] || '');
      if (Number.isFinite(n) && n > 0) stakes[b] = n;
    }
    if (await send('configure', { action: 'configure', stakes })) setEditing(false);
  };

  // Head to head: challenge a player, answer challenges, and see the matchups under way
  const renderHeadToHead = (b: BetView) => {
    const info = SIDE_BET_INFO[b.bet];
    const challenges = data.challenges || [];
    const me = data.me;
    const busyWith = (other: string) => challenges.some(c =>
      (c.challengerId === me && c.opponentId === other) || (c.opponentId === me && c.challengerId === other));
    const others = (data.players || []).filter(p => p.id !== me && !busyWith(p.id));
    return (
      <section key={b.bet} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700" aria-label={info.name}>
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">{info.name}</h4>
          <span className="tabular-nums text-gray-600 dark:text-gray-300">{formatMoney(b.stake)} a challenge</span>
        </div>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{info.summary}</p>
        {challenges.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-200" aria-label="Head to head challenges">
            {challenges.map(c => {
              const mine = c.challengerId === me || c.opponentId === me;
              const toMe = c.status === 'pending' && c.opponentId === me;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {c.challengerName} vs {c.opponentName} · {formatMoney(c.stake)}
                    {c.status === 'pending' ? (toMe ? ' · challenged you' : ' · waiting for an answer') : ' · under way'}
                  </span>
                  {toMe && data.seated && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => send(c.id, { action: 'accept', challengeId: c.id })}>
                      Accept
                    </button>
                  )}
                  {mine && c.status === 'pending' && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => send(c.id, { action: 'cancel', challengeId: c.id })}>
                      {toMe ? 'Decline' : 'Withdraw'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data.seated && others.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">
              Challenge
              <select className="input h-9! px-2! text-xs" value={opponentId} disabled={!!busy} onChange={e => setOpponentId(e.target.value)}>
                <option value="">Choose a player…</option>
                {others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!!busy || !opponentId}
              onClick={async () => { if (await send('challenge', { action: 'challenge', opponentId })) setOpponentId(''); }}
            >
              Send challenge
            </button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Side bets are separate from your chips. What you win or lose is added to your night in the Session tab and settled up with the poker.
      </p>

      {data.bets.length === 0 && !editing && (
        <p className="text-gray-600 dark:text-gray-300">
          {data.canConfigure ? 'No side bets are on yet. Turn some on below.' : 'The host hasn\'t turned on any side bets.'}
        </p>
      )}

      {!editing && data.bets.map(b => {
        const info = SIDE_BET_INFO[b.bet];
        if (info.challenge) return renderHeadToHead(b);
        const suit = b.bet === 'best-suit' && typeof handNumber === 'number' ? bestSuitForHand(handNumber) : null;
        const options = info.pick?.fromPlayers
          ? (data.players || []).map(p => ({ value: p.id, label: p.id === data.me ? `${p.name} (you)` : p.name }))
          : info.pick?.options || [];
        return (
          <section key={b.bet} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700" aria-label={info.name}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">{info.name}</h4>
              <span className="tabular-nums text-gray-600 dark:text-gray-300">{formatMoney(b.stake)} a hand</span>
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{info.summary}</p>
            {suit && <p className="mt-1 text-xs text-gray-700 dark:text-gray-200">This hand: {SUIT_SYMBOLS[suit]} {suit}</p>}
            {b.pot !== undefined && (
              <p className="mt-1 text-xs text-gray-700 dark:text-gray-200">
                {b.bet === 'bad-beat' ? 'Jackpot' : 'Pot'}: <span className="tabular-nums font-semibold">{formatMoney(b.pot)}</span>
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {b.players.length ? `In: ${b.players.join(', ')}` : 'Nobody is in yet.'} Needs two players.
            </p>
            {data.seated && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {info.pick && (
                  <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">
                    {info.pick.label}
                    <select
                      className="input h-9! px-2! text-xs"
                      value={b.pick ?? ''}
                      disabled={!!busy}
                      onChange={e => e.target.value && send(b.bet, { action: 'join', bet: b.bet, pick: e.target.value })}
                    >
                      <option value="">Choose…</option>
                      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                )}
                {b.joined ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => send(b.bet, { action: 'leave', bet: b.bet })}>
                    Leave
                  </button>
                ) : !info.pick && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => send(b.bet, { action: 'join', bet: b.bet })}>
                    Join
                  </button>
                )}
                {b.joined && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">You&apos;re in</span>}
              </div>
            )}
          </section>
        );
      })}

      {!data.seated && data.bets.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Take a seat to join side bets.</p>
      )}
      {notice && <p className="text-xs text-gray-600 dark:text-gray-300" role="status">{notice}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}

      {data.canConfigure && !editing && (
        <button type="button" className="link text-sm" onClick={startEditing}>Choose side bets and stakes</button>
      )}
      {editing && (
        <div className="space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">Set a stake to turn a side bet on; leave it empty to turn it off. Changes apply from the next hand.</p>
          {SIDE_BETS.map(b => (
            <label key={b} className="flex items-center justify-between gap-2">
              <span className="text-gray-800 dark:text-gray-100">{SIDE_BET_INFO[b].name}</span>
              <span className="flex items-center gap-1">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_SIDE_BET_STAKE}
                  step="0.25"
                  inputMode="decimal"
                  aria-label={`${SIDE_BET_INFO[b].name} stake`}
                  className="input w-24 h-9! px-2.5! text-right"
                  placeholder="Off"
                  value={draft[b] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [b]: e.target.value }))}
                />
              </span>
            </label>
          ))}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={saveStakes}>Save</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
