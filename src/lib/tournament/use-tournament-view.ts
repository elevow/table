import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../../utils/auth-headers';
import { usePolling } from '../../hooks/usePolling';
import { getSupabaseBrowser } from '../realtime/supabaseClient';
import type { TournamentEvent } from './tournament-events';
import type { TournamentView } from './tournament-view';

// Live updates reload the view as soon as anything changes; polling is the fallback
const POLL_MS = 30_000;

/**
 * A tournament's view, reloaded whenever the tournament changes (and every few seconds as a
 * fallback), with the level and break time left counted down locally between reloads (a paused
 * clock stands still). `onEvents` hears what happened in each change.
 */
export function useTournamentView(id: string | null, onEvents?: (events: TournamentEvent[]) => void) {
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  const [view, setView] = useState<TournamentView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The server's reason code with the error, e.g. PRIVATE_TOURNAMENT
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/tournaments/view?tournamentId=${encodeURIComponent(id)}`, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCode(typeof body?.code === 'string' ? body.code : null);
        throw new Error(body?.error || `Could not load the tournament (${res.status})`);
      }
      setErrorCode(null);
      const at = Date.now();
      setView(body);
      setFetchedAt(at);
      setNow(at);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the tournament');
    }
  }, [id]);

  usePolling(reload, POLL_MS, { enabled: !!id });
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!id) return;
    const supa = getSupabaseBrowser();
    if (!supa) return;
    const channel = supa.channel(`tournament:${id}`)
      .on('broadcast', { event: 'tournament_update' }, message => {
        reload();
        const events = (message.payload as { events?: TournamentEvent[] })?.events;
        if (Array.isArray(events) && events.length > 0) onEventsRef.current?.(events);
      })
      .subscribe();
    return () => { try { channel.unsubscribe(); } catch { /* already gone */ } };
  }, [id, reload]);

  const elapsed = view && view.status !== 'paused' ? Math.max(0, now - fetchedAt) : 0;
  const levelLeft = view?.levelRemainingMs != null ? view.levelRemainingMs - (view.status === 'running' ? elapsed : 0) : null;
  const breakLeft = view?.breakRemainingMs != null ? view.breakRemainingMs - (view.status === 'on-break' ? elapsed : 0) : null;
  return { view, error, errorCode, reload, levelLeft, breakLeft };
}
