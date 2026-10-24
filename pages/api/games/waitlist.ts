import type { NextApiRequest, NextApiResponse } from 'next';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { loadRoom, updateRoomConfig, type TableExtrasConfig } from '../../../src/lib/server/room-config';
import { syncWaitlist } from '../../../src/lib/server/seat-actions';
import { publishTableEvent } from '../../../src/lib/realtime/publisher';

/**
 * POST /api/games/waitlist { tableId, join, playerName }
 *
 * Join or leave a table's waitlist. When a seat opens it is held for the first player in line
 * for a minute.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { tableId, playerId: claimedPlayerId, join, playerName } = (req.body || {}) as {
    tableId?: string;
    playerId?: string;
    join?: boolean;
    playerName?: string;
  };
  const playerId = await requirePlayer(req, res, claimedPlayerId);
  if (!playerId) return;
  if (!tableId || typeof join !== 'boolean') return res.status(400).json({ error: 'Missing tableId or join' });

  try {
    const room = await loadRoom(tableId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const config = room.configuration as TableExtrasConfig;
    let waitlist = (config.waitlist || []).filter(w => w.playerId !== playerId);

    if (join) {
      const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);
      if (Object.values(seats).some(a => a?.playerId === playerId)) {
        return res.status(409).json({ error: 'You already have a seat' });
      }
      waitlist = [...waitlist, { playerId, playerName: String(playerName || 'Player').slice(0, 40), joinedAt: Date.now() }];
    }
    const patch: Partial<TableExtrasConfig> = { waitlist };
    // Leaving gives up any seat being held for you
    if (!join && config.seatOffer?.playerId === playerId) patch.seatOffer = null;
    await updateRoomConfig(tableId, patch);
    await publishTableEvent(tableId, { type: 'waitlist' }).catch(() => {});
    // A seat may already be free
    await syncWaitlist(tableId);

    const position = waitlist.findIndex(w => w.playerId === playerId);
    return res.status(200).json({ ok: true, position: position >= 0 ? position + 1 : null, waiting: waitlist.length });
  } catch (err) {
    console.error('Error updating waitlist:', err);
    return res.status(500).json({ error: 'Unable to update the waitlist' });
  }
}
