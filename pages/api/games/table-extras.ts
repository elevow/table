import * as GameSeats from '../../../src/lib/shared/game-seats';
import { getSessionUser } from '../../../src/lib/auth/auth-utils';
import { getUserAccess } from '../../../src/lib/auth/access-control';
import { tableHostPermissions } from '../../../src/lib/auth/table-access';
import { advanceSeatOffer, freeSeatNumbers, loadRoom, updateRoomConfig, type TableExtrasConfig } from '../../../src/lib/server/room-config';
import { publishTableEvent } from '../../../src/lib/realtime/publisher';
import {
  PRIVATE_TABLE_RESPONSE, canEnterRoom, formatInviteCode, isPrivateRoom, type RoomPrivacyConfig,
} from '../../../src/lib/server/room-privacy';
import { apiHandler } from '../../../src/lib/api/handler';

/**
 * GET /api/games/table-extras?tableId=
 *
 * What the table page needs besides the game itself: who the host is, the table settings, the
 * waitlist and any seat held for it, the host controls the caller may use (hostPermissions),
 * whether the table is private (with its invite code for whoever may configure it), and
 * pending seat requests for whoever may approve them. Also moves
 * the waitlist along when an offer has lapsed, since there is no background job to do it.
 */
export default apiHandler({ methods: 'GET' }, async (req, res) => {
  const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : '';
  if (!tableId) return res.status(400).json({ error: 'Missing tableId' });
  const user = await getSessionUser(req);
  const userId = user?.id ?? null;

  try {
    const room = await loadRoom(tableId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const access = user ? await getUserAccess(user) : null;
    if (!canEnterRoom(access, room)) return res.status(403).json(PRIVATE_TABLE_RESPONSE);
    const config = room.configuration as TableExtrasConfig & RoomPrivacyConfig;
    const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.getRoomSeats(tableId);

    const next = advanceSeatOffer(config, freeSeatNumbers(seats, room.maxPlayers), Date.now());
    if (next.changed) {
      await updateRoomConfig(tableId, { waitlist: next.waitlist, seatOffer: next.seatOffer });
      await publishTableEvent(tableId, { type: next.seatOffer ? 'waitlist_offer' : 'waitlist' }).catch(() => {});
    }

    const isHost = !!userId && room.createdBy === userId;
    const hostPermissions = access ? tableHostPermissions(access, room) : [];
    const isPrivate = isPrivateRoom(config);
    return res.status(200).json({
      hostId: room.createdBy,
      isHost,
      hostPermissions,
      visibility: isPrivate ? 'private' : 'public',
      // Whoever may change the table's settings can share and replace its invite link
      inviteCode: isPrivate && config.inviteCode && hostPermissions.includes('room.configure')
        ? formatInviteCode(config.inviteCode)
        : undefined,
      requireSeatApproval: !!config.requireSeatApproval,
      allowStraddle: !!config.allowStraddle,
      allowRunItTwice: !!config.allowRunItTwice,
      showAllAtShowdown: !!config.showAllAtShowdown,
      closed: !!config.closed,
      waitlist: next.waitlist.map(w => ({ playerId: w.playerId, playerName: w.playerName })),
      seatOffer: next.seatOffer,
      seatRequests: hostPermissions.includes('room.approve_seat') ? config.seatRequests || [] : undefined,
      myPendingRequest: !!userId && (config.seatRequests || []).some(r => r.playerId === userId),
    });
  } catch (err) {
    console.error('Error loading table extras:', err);
    return res.status(500).json({ error: 'Unable to load table details' });
  }
});
