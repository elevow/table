import React, { useCallback, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useRouter } from 'next/router';
import { authHeaders } from '../utils/auth-headers';
import type { LobbyTable } from '../../pages/api/games/rooms/lobby';

const REFRESH_MS = 15_000;

function stakes(t: LobbyTable): string {
  return t.smallBlind && t.bigBlind ? `$${t.smallBlind}/$${t.bigBlind}` : '–';
}

function TablesList({ title, empty, tables, showHost }: { title: string; empty: string; tables: LobbyTable[]; showHost: boolean }) {
  const router = useRouter();
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <h3 className="section-title">{title}</h3>
        {tables.length > 0 && <span className="badge">{tables.length} {tables.length === 1 ? 'table' : 'tables'}</span>}
      </div>
      {tables.length === 0 ? (
        <div className="px-6 pb-8 pt-4 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="6" /></svg>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
        </div>
      ) : (
        <>
        {/* Phones: one card-like row per table */}
        <ul className="sm:hidden divide-y divide-gray-100 dark:divide-white/5 border-t border-gray-100 dark:border-white/5">
          {tables.map(t => {
            const full = t.seated >= t.maxPlayers;
            return (
              <li key={t.id} className="flex items-center gap-3 px-6 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{t.name}</span>
                    {t.isHost && <span className="badge badge-amber">Host</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    <div className="truncate">{t.game} · {stakes(t)}</div>
                    <div>{t.seated}/{t.maxPlayers} seated</div>
                  </div>
                </div>
                <button
                  className={`btn btn-sm ${full ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => router.push(`/game/${t.id}`)}
                >
                  {full ? 'Watch' : 'Join'}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="hidden sm:block overflow-x-auto">
          <table className="data-table text-gray-800 dark:text-gray-200">
            <thead>
              <tr>
                <th>Table</th>
                <th>Game</th>
                <th>Stakes</th>
                <th>Seats</th>
                {showHost && <th>Host</th>}
                <th><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {tables.map(t => {
                const full = t.seated >= t.maxPlayers;
                return (
                  <tr key={t.id}>
                    <td className="font-medium text-gray-900 dark:text-white">
                      <span className="inline-flex items-center gap-2">
                        {t.name}
                        {t.isHost && <span className="badge badge-amber">Host</span>}
                      </span>
                    </td>
                    <td className="text-gray-600 dark:text-gray-300">{t.game}</td>
                    <td className="whitespace-nowrap tabular-nums">{stakes(t)}</td>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 tabular-nums">
                        <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10" aria-hidden="true">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (t.seated / Math.max(1, t.maxPlayers)) * 100)}%` }} />
                        </span>
                        {t.seated}/{t.maxPlayers}
                      </span>
                    </td>
                    {showHost && <td className="text-gray-600 dark:text-gray-300">{t.host || '–'}</td>}
                    <td className="text-right">
                      <button
                        className={`btn btn-sm ${full ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => router.push(`/game/${t.id}`)}
                      >
                        {full ? 'Watch' : 'Join'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

/**
 * The dashboard's tables: public tables anyone can open, and the private tables the user hosts
 * or joined through an invite link. Refreshes every 15 seconds.
 */
export default function LobbyTables() {
  const [open, setOpen] = useState<LobbyTable[] | null>(null);
  const [mine, setMine] = useState<LobbyTable[]>([]);
  const [canView, setCanView] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetch('/api/games/rooms/lobby', { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        setOpen(Array.isArray(data.open) ? data.open : []);
        setMine(Array.isArray(data.mine) ? data.mine : []);
        setCanView(data.canView !== false);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  usePolling(load, REFRESH_MS);

  return (
    <div className="w-full space-y-6">
      {mine.length > 0 && (
        <TablesList title="My private tables" empty="" tables={mine} showHost />
      )}
      {canView && (
        <TablesList
          title="Open tables"
          empty={error ? 'Couldn\'t load tables. Retrying…' : open === null ? 'Loading tables…' : 'No open tables right now. Create one to get a game going.'}
          tables={open || []}
          showHost
        />
      )}
    </div>
  );
}
