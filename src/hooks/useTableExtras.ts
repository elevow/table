import { useCallback, useState } from 'react';
import { usePolling } from './usePolling';
import { authHeaders } from '../utils/auth-headers';

export interface TableExtras {
  hostId: string | null;
  isHost: boolean;
  /** Host controls the viewer may use here: their own table's, or any table's for staff */
  hostPermissions?: string[];
  visibility?: 'public' | 'private';
  /** A private table's invite code, for whoever may change the table's settings */
  inviteCode?: string;
  requireSeatApproval: boolean;
  allowStraddle: boolean;
  allowRunItTwice: boolean;
  showAllAtShowdown: boolean;
  // The host closed the table
  closed: boolean;
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

  // A fallback: changes made at this table call refresh() straight away
  usePolling(refresh, 60_000, { enabled: !!tableId });

  return { extras, refresh };
}
