import React, { useState } from 'react';
import { authHeaders } from '../utils/auth-headers';
import type { TableExtras } from '../hooks/useTableExtras';
import { isStudVariant } from '../lib/poker/variant-rules';
import { MIN_TURN_SECONDS, MAX_TURN_SECONDS, MIN_HAND_DELAY_SECONDS, MAX_HAND_DELAY_SECONDS, handDelayMs, turnTimeMs } from '../lib/shared/turn-clock';

interface Props {
  tableId: string;
  playerId: string;
  extras: TableExtras;
  gameState: any;
  // Other seated players the host could remove
  players: Array<{ id: string; name: string }>;
  onState: (gameState: any) => void;
  onRefresh: () => void;
  // Shown inside the side panel tabs, without its own card
  embedded?: boolean;
}

/**
 * The host's controls: pause, blinds for the next hand, bomb pots, straddles, turn time and time
 * banks, who may sit down, public or private and the private invite link,
 * and removing a player. Each shows only with its permission (extras.hostPermissions); staff
 * with admin.rooms.manage see them on any table.
 */
export default function HostControlsPanel({ tableId, playerId, extras, gameState, players, onState, onRefresh, embedded = false }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sb, setSb] = useState<string>('');
  const [bb, setBb] = useState<string>('');
  const [anteBB, setAnteBB] = useState<string>('2');
  const [kickId, setKickId] = useState<string>('');
  const [turnSeconds, setTurnSeconds] = useState<string>('');
  const [delaySeconds, setDelaySeconds] = useState<string>('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [copied, setCopied] = useState(false);

  const send = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setError(null);
    try {
      const resp = await fetch('/api/games/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tableId, playerId, ...body }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) setError(data?.error || 'That did not work');
      if (data?.gameState) onState(data.gameState);
      onRefresh();
    } catch {
      setError('That did not work');
    } finally {
      setBusy(null);
    }
  };

  const paused = !!gameState?.paused;
  const pending = gameState?.pendingBlinds;
  const bomb = gameState?.bombPotNext;
  const stud = isStudVariant(gameState?.variant);
  const can = (permission: string) => (extras.hostPermissions || []).includes(permission);
  const canConfigure = can('room.configure');
  const isPrivate = extras.visibility === 'private';
  const inviteLink = extras.inviteCode && typeof window !== 'undefined'
    ? `${window.location.origin}/join/${extras.inviteCode}`
    : null;
  const copyInviteLink = () => {
    if (!inviteLink) return;
    navigator.clipboard?.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setError('Copy the link from the box instead'));
  };

  const Wrapper: React.ElementType = embedded ? 'div' : 'details';
  return (
    // Inside the side panel tabs it shows open, under its tab, without its own card and header
    <Wrapper className={`group text-sm text-gray-800 dark:text-gray-200 ${embedded ? '' : 'surface'}`}>
      {!embedded && <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <h3 className="section-title">{extras.isHost ? 'Host controls' : 'Host controls (staff)'}</h3>
        <svg className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.2 7.2a1 1 0 011.4 0L10 10.6l3.4-3.4a1 1 0 111.4 1.4l-4.1 4.1a1 1 0 01-1.4 0L5.2 8.6a1 1 0 010-1.4z" clipRule="evenodd" /></svg>
      </summary>}
      <div className={`space-y-4 ${embedded ? '' : 'border-t border-gray-100 px-5 pb-5 pt-4 dark:border-white/6'} *:mt-0! [&>*+*]:border-t [&>*+*]:border-gray-100 dark:[&>*+*]:border-white/6 [&>*+*]:pt-4`}>
      {error && <div className="mb-2 text-xs text-red-700 dark:text-red-300">{error}</div>}

      {canConfigure && (
        <div className="mb-3 space-y-2">
          <label className="flex items-center justify-between gap-2">
            <span>{isPrivate ? 'Private: only people with the invite link' : 'Public: listed on the dashboard'}</span>
            <input
              type="checkbox"
              aria-label="Private table"
              className="switch"
              checked={isPrivate}
              disabled={!!busy}
              onChange={e => send('visibility', { action: 'set-visibility', private: e.target.checked })}
            />
          </label>
          {isPrivate && inviteLink && (
            <div>
              <div className="flex items-center gap-1">
                <input
                  readOnly
                  aria-label="Invite link"
                  value={inviteLink}
                  onFocus={e => e.target.select()}
                  className="flex-1 min-w-0 input h-9! px-2.5! text-xs"
                />
                <button className={`btn btn-secondary btn-sm`} onClick={copyInviteLink}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  className={`btn btn-ghost btn-sm`}
                  disabled={!!busy}
                  title="Stop the current link working and make a new one"
                  onClick={() => {
                    if (window.confirm('Make a new invite link? The current one stops working. Players already at the table keep their place.')) {
                      send('invite', { action: 'new-invite-code' });
                    }
                  }}
                >
                  New link
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Code {extras.inviteCode}: anyone with it can watch and ask to sit.</div>
            </div>
          )}
        </div>
      )}

      {can('room.start') && !extras.closed && (
        <div className="mb-3">
          {confirmClose ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20" role="alertdialog" aria-label="Close the table?">
              <p className="mb-2 text-red-800 dark:text-red-200">
                Close the table? Any hand in play finishes, then no more hands are dealt and nobody can sit down. This can&apos;t be undone.
              </p>
              <div className="flex gap-2">
                <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700" disabled={!!busy} onClick={() => send('close', { action: 'close-table' }).then(() => setConfirmClose(false))}>
                  Close table
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClose(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm text-red-600 dark:text-red-400" onClick={() => setConfirmClose(true)}>
              End game and close table
            </button>
          )}
        </div>
      )}

      {gameState && (
        <div className="space-y-3">
          {can('room.start') && (
          <div className="flex items-center justify-between">
            <span>{paused ? 'Game is paused' : 'Game is running'}</span>
            <button
              className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!!busy}
              onClick={() => send('pause', { action: paused ? 'resume' : 'pause' })}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          )}

          {canConfigure && (
          <div>
            <div className="mb-2 eyebrow">Blinds ${gameState.smallBlind}/${gameState.bigBlind}{pending ? ` → $${pending.smallBlind}/$${pending.bigBlind} next hand` : ''}</div>
            <div className="flex items-center gap-1">
              <input aria-label="Small blind" type="number" min={1} value={sb} onChange={e => setSb(e.target.value)} placeholder="SB" className="w-16 input h-9! px-2.5!" />
              <span>/</span>
              <input aria-label="Big blind" type="number" min={1} value={bb} onChange={e => setBb(e.target.value)} placeholder="BB" className="w-16 input h-9! px-2.5!" />
              <button
                className={`btn btn-secondary btn-sm`}
                disabled={!!busy || !(Number(sb) > 0) || !(Number(bb) >= Number(sb))}
                onClick={() => send('blinds', { action: 'set-blinds', smallBlind: Number(sb), bigBlind: Number(bb) })}
              >
                Set for next hand
              </button>
            </div>
          </div>
          )}

          {canConfigure && !stud && (
            <div>
              <div className="mb-2 eyebrow">{bomb ? `Bomb pot next hand (${bomb.anteBB} BB ante)` : 'Bomb pot: everyone antes, betting starts on the flop'}</div>
              <div className="flex items-center gap-1">
                {!bomb && (
                  <>
                    <input aria-label="Bomb pot ante in big blinds" type="number" min={1} value={anteBB} onChange={e => setAnteBB(e.target.value)} className="w-16 input h-9! px-2.5!" />
                    <span className="text-xs">BB</span>
                  </>
                )}
                <button
                  className={`btn btn-sm ${bomb ? 'btn-ghost' : 'btn-secondary'}`}
                  disabled={!!busy || (!bomb && !(Number(anteBB) > 0))}
                  onClick={() => send('bomb', { action: 'bomb-pot', anteBB: bomb ? null : Number(anteBB) })}
                >
                  {bomb ? 'Cancel bomb pot' : 'Schedule bomb pot'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {canConfigure && !stud && (
          <label className="flex items-center justify-between gap-2">
            <span>Allow straddles</span>
            <input
              type="checkbox"
              className="switch"
              checked={extras.allowStraddle}
              disabled={!!busy}
              onChange={e => send('straddle', { action: 'allow-straddle', allow: e.target.checked })}
            />
          </label>
        )}
        {canConfigure && !stud && (
          <label className="flex items-center justify-between gap-2">
            <span>Allow run it twice</span>
            <input
              type="checkbox"
              className="switch"
              checked={extras.allowRunItTwice}
              disabled={!!busy}
              onChange={e => send('rit', { action: 'allow-run-it-twice', allow: e.target.checked })}
            />
          </label>
        )}
        {canConfigure && (
          <label className="flex items-center justify-between gap-2" title="Everyone still in at a showdown shows their cards; nobody mucks">
            <span>Everyone shows at showdown</span>
            <input
              type="checkbox"
              className="switch"
              checked={!!extras.showAllAtShowdown}
              disabled={!!busy}
              onChange={e => send('showall', { action: 'show-all-at-showdown', show: e.target.checked })}
            />
          </label>
        )}
        {canConfigure && gameState && (
          <div>
            <div className="mb-2 eyebrow">Turn time {Math.round(turnTimeMs(gameState) / 1000)}s</div>
            <div className="flex items-center gap-1">
              <input
                aria-label="Turn time in seconds"
                type="number"
                min={MIN_TURN_SECONDS}
                max={MAX_TURN_SECONDS}
                value={turnSeconds}
                onChange={e => setTurnSeconds(e.target.value)}
                placeholder="secs"
                className="w-16 input h-9! px-2.5!"
              />
              <button
                className={`btn btn-secondary btn-sm`}
                disabled={!!busy || !(Number(turnSeconds) >= MIN_TURN_SECONDS && Number(turnSeconds) <= MAX_TURN_SECONDS)}
                onClick={() => send('turn', { action: 'set-turn-time', seconds: Number(turnSeconds) }).then(() => setTurnSeconds(''))}
              >
                Set turn time
              </button>
            </div>
          </div>
        )}
        {canConfigure && gameState && (
          <div>
            <div className="mb-2 eyebrow">Time between hands {Math.round(handDelayMs(gameState) / 1000)}s</div>
            <div className="flex items-center gap-1">
              <input
                aria-label="Time between hands in seconds"
                type="number"
                min={MIN_HAND_DELAY_SECONDS}
                max={MAX_HAND_DELAY_SECONDS}
                value={delaySeconds}
                onChange={e => setDelaySeconds(e.target.value)}
                placeholder="secs"
                className="w-16 input h-9! px-2.5!"
              />
              <button
                className={`btn btn-secondary btn-sm`}
                disabled={!!busy || !(Number(delaySeconds) >= MIN_HAND_DELAY_SECONDS && Number(delaySeconds) <= MAX_HAND_DELAY_SECONDS)}
                onClick={() => send('delay', { action: 'set-hand-delay', seconds: Number(delaySeconds) }).then(() => setDelaySeconds(''))}
              >
                Set pause
              </button>
            </div>
          </div>
        )}
        {canConfigure && gameState && Array.isArray(gameState.players) && gameState.players.length > 0 && (
          <div>
            <div className="mb-2 eyebrow">Time banks</div>
            <ul className="space-y-1">
              {gameState.players.map((p: any) => {
                const who = p.name || 'player';
                const count = typeof p.timeBanks === 'number' ? p.timeBanks : 0;
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{p.name || 'Player'}</span>
                    <span className="flex items-center gap-1">
                      <button
                        className="btn btn-secondary btn-sm h-8! w-8! px-0!"
                        disabled={!!busy || count <= 0}
                        aria-label={`Remove a time bank from ${who}`}
                        onClick={() => send('banks', { action: 'adjust-time-banks', targetId: p.id, delta: -1 })}
                      >−</button>
                      <span className="w-8 text-center tabular-nums" aria-label={`${count} time banks`}>{count}</span>
                      <button
                        className="btn btn-secondary btn-sm h-8! w-8! px-0!"
                        disabled={!!busy}
                        aria-label={`Give ${who} a time bank`}
                        onClick={() => send('banks', { action: 'adjust-time-banks', targetId: p.id, delta: 1 })}
                      >+</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {can('room.approve_seat') && (
        <label className="flex items-center justify-between gap-2">
          <span>Approve players before they sit</span>
          <input
            type="checkbox"
            className="switch"
            checked={extras.requireSeatApproval}
            disabled={!!busy}
            onChange={e => send('approval', { action: 'require-approval', required: e.target.checked })}
          />
        </label>
        )}
        {can('room.approve_seat') && (extras.seatRequests || []).length > 0 && (
          <ul className="space-y-1">
            {extras.seatRequests!.map(r => (
              <li key={r.playerId} className="flex items-center justify-between gap-2 surface-muted px-2 py-1">
                <span>{r.playerName} wants seat {r.seatNumber}</span>
                <span className="flex gap-1">
                  <button className={`btn btn-primary btn-sm`} disabled={!!busy} onClick={() => send('approve', { action: 'approve', targetId: r.playerId })}>Approve</button>
                  <button className={`btn btn-ghost btn-sm`} disabled={!!busy} onClick={() => send('deny', { action: 'deny', targetId: r.playerId })}>Deny</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {can('room.kick_player') && players.length > 0 && (
        <div className="mt-3 flex items-center gap-1">
          <select
            aria-label="Player to remove"
            value={kickId}
            onChange={e => setKickId(e.target.value)}
            className="flex-1 input h-9! px-2.5! text-xs"
          >
            <option value="">Remove a player…</option>
            {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            className={`btn btn-danger btn-sm`}
            disabled={!!busy || !kickId}
            onClick={() => {
              const name = players.find(p => p.id === kickId)?.name || 'this player';
              const privateNote = isPrivate ? ' To keep them out, also make a new invite link.' : '';
              if (window.confirm(`Remove ${name} from the table? They are folded out of the current hand and leave with their chips.${privateNote}`)) {
                send('kick', { action: 'kick', targetId: kickId }).then(() => setKickId(''));
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
      </div>
    </Wrapper>
  );
}
