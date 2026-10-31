import type { NextApiRequest, NextApiResponse } from 'next';
import * as GameSeats from '../../../src/lib/shared/game-seats';
import { getSessionUser } from '../../../src/lib/auth/auth-utils';
import { getUserAccess } from '../../../src/lib/auth/access-control';
import { tableHostPermissions } from '../../../src/lib/auth/table-access';
import { advanceSeatOffer, freeSeatNumbers, loadRoom, updateRoomConfig, type TableExtrasConfig } from '../../../src/lib/server/room-config';
import { publishTableEvent } from '../../../src/lib/realtime/publisher';

/**
 * GET /api/games/table-extras?tableId=
 *
 * What the table page needs besides the game itself: who the host is, the table settings, the
 * waitlist and any seat held for it, the host controls the caller may use (hostPermissions), and
 * pending seat requests for whoever may approve them. Also moves
 * the waitlist along when an offer has lapsed, since there is no background job to do it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : '';
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });
  const user = await getSessionUser(req);
  const userId = user?.id ?? null;

  try {
    const room = await loadRoom(tableId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const config = room.configuration as TableExtrasConfig;
    const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);

    const next = advanceSeatOffer(config, freeSeatNumbers(seats, room.maxPlayers), Date.now());
    if (next.changed) {
      await updateRoomConfig(tableId, { waitlist: next.waitlist, seatOffer: next.seatOffer });
      await publishTableEvent(tableId, { type: next.seatOffer ? 'waitlist_offer' : 'waitlist' }).catch(() => {});
    }

    const isHost = !!userId && room.createdBy === userId;
    const hostPermissions = user ? tableHostPermissions(await getUserAccess(user), room) : [];
    return res.status(200).json({
      hostId: room.createdBy,
      isHost,
      hostPermissions,
      requireSeatApproval: !!config.requireSeatApproval,
      allowStraddle: !!config.allowStraddle,
      allowRunItTwice: !!config.allowRunItTwice,
      waitlist: next.waitlist.map(w => ({ playerId: w.playerId, playerName: w.playerName })),
      seatOffer: next.seatOffer,
      seatRequests: hostPermissions.includes('room.approve_seat') ? config.seatRequests || [] : undefined,
      myPendingRequest: !!userId && (config.seatRequests || []).some(r => r.playerId === userId),
    });
  } catch (err) {
    console.error('Error loading table extras:', err);
    return res.status(500).json({ error: 'Unable to load table details' });
  }
}
