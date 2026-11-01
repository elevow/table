import React, { useCallback, useEffect, useState } from 'react';
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
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{title}</h3>
      {tables.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-800 dark:text-gray-200">
            <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-2 pr-3 font-medium">Table</th>
                <th className="py-2 pr-3 font-medium">Game</th>
                <th className="py-2 pr-3 font-medium">Stakes</th>
                <th className="py-2 pr-3 font-medium">Players</th>
                {showHost && <th className="py-2 pr-3 font-medium">Host</th>}
                <th className="py-2 font-medium"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {tables.map(t => {
                const full = t.seated >= t.maxPlayers;
                return (
                  <tr key={t.id}>
                    <td className="py-2 pr-3 font-medium">
                      {t.name}
                      {t.isHost && <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">You host</span>}
                    </td>
                    <td className="py-2 pr-3">{t.game}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{stakes(t)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{t.seated}/{t.maxPlayers}</td>
                    {showHost && <td className="py-2 pr-3">{t.host || '–'}</td>}
                    <td className="py-2 text-right">
                      <button
                        className="px-3 py-1 rounded-md text-white text-xs font-medium bg-indigo-500 hover:bg-indigo-600"
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

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="w-full max-w-4xl space-y-4">
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
