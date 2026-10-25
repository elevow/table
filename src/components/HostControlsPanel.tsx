import React, { useState } from 'react';
import { authHeaders } from '../utils/auth-headers';
import type { TableExtras } from '../hooks/useTableExtras';

interface Props {
  tableId: string;
  playerId: string;
  extras: TableExtras;
  gameState: any;
  // Other seated players the host could remove
  players: Array<{ id: string; name: string }>;
  onState: (gameState: any) => void;
  onRefresh: () => void;
}

/**
 * The host's controls: pause, blinds for the next hand, bomb pots, straddles, who may sit down,
 * and removing a player.
 */
export default function HostControlsPanel({ tableId, playerId, extras, gameState, players, onState, onRefresh }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sb, setSb] = useState<string>('');
  const [bb, setBb] = useState<string>('');
  const [anteBB, setAnteBB] = useState<string>('2');
  const [kickId, setKickId] = useState<string>('');

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
  const stud = String(gameState?.variant || '').includes('stud');
  const button = 'px-3 py-1 rounded text-xs font-medium disabled:opacity-60';

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg shadow-md p-4 text-sm text-gray-900 dark:text-gray-100">
      <h3 className="font-semibold mb-3">Host controls</h3>
      {error && <div className="mb-2 text-xs text-red-700 dark:text-red-300">{error}</div>}

      {gameState && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span>{paused ? 'Game is paused' : 'Game is running'}</span>
            <button
              className={`${button} ${paused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-700 hover:bg-gray-800'} text-white`}
              disabled={!!busy}
              onClick={() => send('pause', { action: paused ? 'resume' : 'pause' })}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>

          <div>
            <div className="mb-1">Blinds ${gameState.smallBlind}/${gameState.bigBlind}{pending ? ` → $${pending.smallBlind}/$${pending.bigBlind} next hand` : ''}</div>
            <div className="flex items-center gap-1">
              <input aria-label="Small blind" type="number" min={1} value={sb} onChange={e => setSb(e.target.value)} placeholder="SB" className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
              <span>/</span>
              <input aria-label="Big blind" type="number" min={1} value={bb} onChange={e => setBb(e.target.value)} placeholder="BB" className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
              <button
                className={`${button} bg-blue-600 hover:bg-blue-700 text-white`}
                disabled={!!busy || !(Number(sb) > 0) || !(Number(bb) >= Number(sb))}
                onClick={() => send('blinds', { action: 'set-blinds', smallBlind: Number(sb), bigBlind: Number(bb) })}
              >
                Set for next hand
              </button>
            </div>
          </div>

          {!stud && (
            <div>
              <div className="mb-1">{bomb ? `Bomb pot next hand (${bomb.anteBB} BB ante)` : 'Bomb pot: everyone antes, betting starts on the flop'}</div>
              <div className="flex items-center gap-1">
                {!bomb && (
                  <>
                    <input aria-label="Bomb pot ante in big blinds" type="number" min={1} value={anteBB} onChange={e => setAnteBB(e.target.value)} className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
                    <span className="text-xs">BB</span>
                  </>
                )}
                <button
                  className={`${button} ${bomb ? 'bg-gray-500 hover:bg-gray-600' : 'bg-orange-600 hover:bg-orange-700'} text-white`}
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
        {!stud && (
          <label className="flex items-center justify-between gap-2">
            <span>Allow straddles</span>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={extras.allowStraddle}
              disabled={!!busy}
              onChange={e => send('straddle', { action: 'allow-straddle', allow: e.target.checked })}
            />
          </label>
        )}
        {!stud && (
          <label className="flex items-center justify-between gap-2">
            <span>Allow run it twice</span>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={extras.allowRunItTwice}
              disabled={!!busy}
              onChange={e => send('rit', { action: 'allow-run-it-twice', allow: e.target.checked })}
            />
          </label>
        )}
        <label className="flex items-center justify-between gap-2">
          <span>Approve players before they sit</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={extras.requireSeatApproval}
            disabled={!!busy}
            onChange={e => send('approval', { action: 'require-approval', required: e.target.checked })}
          />
        </label>
        {(extras.seatRequests || []).length > 0 && (
          <ul className="space-y-1">
            {extras.seatRequests!.map(r => (
              <li key={r.playerId} className="flex items-center justify-between gap-2 bg-white/70 dark:bg-gray-800/70 rounded px-2 py-1">
                <span>{r.playerName} wants seat {r.seatNumber}</span>
                <span className="flex gap-1">
                  <button className={`${button} bg-emerald-600 hover:bg-emerald-700 text-white`} disabled={!!busy} onClick={() => send('approve', { action: 'approve', targetId: r.playerId })}>Approve</button>
                  <button className={`${button} bg-gray-500 hover:bg-gray-600 text-white`} disabled={!!busy} onClick={() => send('deny', { action: 'deny', targetId: r.playerId })}>Deny</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {players.length > 0 && (
        <div className="mt-3 flex items-center gap-1">
          <select
            aria-label="Player to remove"
            value={kickId}
            onChange={e => setKickId(e.target.value)}
            className="flex-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
          >
            <option value="">Remove a player…</option>
            {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            className={`${button} bg-red-600 hover:bg-red-700 text-white`}
            disabled={!!busy || !kickId}
            onClick={() => {
              const name = players.find(p => p.id === kickId)?.name || 'this player';
              if (window.confirm(`Remove ${name} from the table? They are folded out of the current hand and leave with their chips.`)) {
                send('kick', { action: 'kick', targetId: kickId }).then(() => setKickId(''));
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
