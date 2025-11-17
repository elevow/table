import { useEffect, useRef } from 'react';
import { getSupabaseBrowser } from '../lib/realtime/supabaseClient';

type Callbacks = {
  onSeatClaimed?: (p: { seatNumber: number; playerId: string; playerName: string; chips: number }) => void;
  onSeatVacated?: (p: { seatNumber: number; playerId: string }) => void;
  onSeatState?: (p: { seats: Record<number, { playerId: string; playerName: string; chips: number } | null> }) => void;
  onGameStateUpdate?: (p: { gameState: any; lastAction?: any }) => void;
  onAwaitingDealerChoice?: (p: any) => void;
};

export function useSupabaseRealtime(tableId?: string | string[], callbacks?: Callbacks) {
  const tbl = typeof tableId === 'string' ? tableId : Array.isArray(tableId) ? tableId[0] : undefined;
  const cbsRef = useRef<Callbacks | undefined>(callbacks);
  cbsRef.current = callbacks;

  useEffect(() => {
    if (!tbl) return;
    const supa = getSupabaseBrowser();
    if (!supa) return;
    const channel = supa.channel(`table:${tbl}`);

    channel
      .on('broadcast', { event: 'seat_claimed' }, (p) => cbsRef.current?.onSeatClaimed?.(p.payload))
      .on('broadcast', { event: 'seat_vacated' }, (p) => cbsRef.current?.onSeatVacated?.(p.payload))
      .on('broadcast', { event: 'seat_state' }, (p) => cbsRef.current?.onSeatState?.(p.payload))
      .on('broadcast', { event: 'game_state_update' }, (p) => cbsRef.current?.onGameStateUpdate?.(p.payload))
      .on('broadcast', { event: 'awaiting_dealer_choice' }, (p) => cbsRef.current?.onAwaitingDealerChoice?.(p.payload))
      .subscribe();

    return () => {
      try { channel.unsubscribe(); } catch {}
    };
  }, [tbl]);
}
