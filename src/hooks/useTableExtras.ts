import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth-headers';

export interface TableExtras {
  hostId: string | null;
  isHost: boolean;
  requireSeatApproval: boolean;
  allowStraddle: boolean;
  waitlist: Array<{ playerId: string; playerName: string }>;
  seatOffer: { playerId: string; seatNumber: number; expiresAt: number } | null;
  seatRequests?: Array<{ playerId: string; playerName: string; seatNumber: number; requestedAt: number }>;
  myPendingRequest: boolean;
}

/**
 * Table details outside the game state (host, settings, waitlist, seat requests). Call `refresh`
 * when a table_event arrives; it also refreshes every 15s, which moves the waitlist along if an
 * offer lapsed.
 */
export function useTableExtras(tableId: string): { extras: TableExtras | null; refresh: () => void } {
  const [extras, setExtras] = useState<TableExtras | null>(null);

  const refresh = useCallback(() => {
    if (!tableId) return;
    fetch(`/api/games/table-extras?tableId=${encodeURIComponent(tableId)}`, { headers: authHeaders() })
      .then(resp => (resp.ok ? resp.json() : null))
      .then(data => { if (data) setExtras(data); })
      .catch(() => {});
  }, [tableId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { extras, refresh };
}
