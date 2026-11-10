import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabaseRealtime } from './useSupabaseRealtime';
import { useHydrated } from './useHydrated';
import { useLatest } from './useLatest';
import { authHeaders } from '../utils/auth-headers';
import {
  isTableReaction,
  REACTION_COOLDOWN_MS,
  REACTION_SHOW_MS,
  REACTIONS_MUTED_KEY,
  type TableReaction,
} from '../lib/shared/reactions';

function readMuted(): boolean {
  try {
    return localStorage.getItem(REACTIONS_MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface ReactionBubble {
  emote: TableReaction;
  /** Changes with every reaction so a repeated emote restarts its bubble. */
  id: number;
}

/**
 * Reactions shown over seats: listens for other players' reactions on the table channel,
 * sends our own, and remembers whether the player has hidden reactions at the table.
 */
export function useTableReactions(tableId: string | undefined, playerId: string) {
  const [bubbles, setBubbles] = useState<Record<string, ReactionBubble>>({});
  // Chosen here, else what this browser remembers (read once hydrated)
  const [mutedChoice, setMutedState] = useState<boolean | null>(null);
  const hydrated = useHydrated();
  const muted = mutedChoice ?? (hydrated && readMuted());
  const [coolingDown, setCoolingDown] = useState(false);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(1);
  const mutedRef = useLatest(muted);
  const playerIdRef = useLatest(playerId);

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
    try { localStorage.setItem(REACTIONS_MUTED_KEY, String(value)); } catch {}
    if (value) {
      // Hiding takes effect at once: clear the bubbles already showing
      Object.values(timersRef.current).forEach(clearTimeout);
      timersRef.current = {};
      setBubbles({});
    }
  }, []);

  const show = useCallback((who: string, emote: TableReaction) => {
    const id = nextIdRef.current++;
    setBubbles(prev => ({ ...prev, [who]: { emote, id } }));
    if (timersRef.current[who]) clearTimeout(timersRef.current[who]);
    timersRef.current[who] = setTimeout(() => {
      delete timersRef.current[who];
      setBubbles(prev => {
        if (prev[who]?.id !== id) return prev;
        const rest = { ...prev };
        delete rest[who];
        return rest;
      });
    }, REACTION_SHOW_MS);
  }, []);

  useSupabaseRealtime(tableId, {
    onTableEvent: (payload) => {
      if (payload?.type !== 'reaction') return;
      const who = typeof payload.playerId === 'string' ? payload.playerId : '';
      if (!who || !isTableReaction(payload.emote)) return;
      // Our own reaction is already showing from when we sent it
      if (who === playerIdRef.current) return;
      if (mutedRef.current) return;
      show(who, payload.emote);
    },
  });

  const send = useCallback(async (emote: TableReaction) => {
    if (!tableId || !playerId || cooldownTimerRef.current) return;
    show(playerId, emote);
    setCoolingDown(true);
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      setCoolingDown(false);
    }, REACTION_COOLDOWN_MS);
    try {
      const resp = await fetch('/api/games/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tableId, playerId, emote }),
      });
      if (!resp.ok) console.warn('Reaction was not sent:', resp.status);
    } catch (err) {
      console.warn('Reaction was not sent:', err);
    }
  }, [tableId, playerId, show]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
  }, []);

  return { bubbles, send, muted, setMuted, coolingDown };
}
