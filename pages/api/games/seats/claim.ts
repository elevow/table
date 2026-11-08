import { publishTableEvent } from '../../../../src/lib/realtime/publisher';
import {
  getLimit, hasPermission, requirePlayerAccess, sendLimitReached, sendPermissionDenied,
} from '../../../../src/lib/auth/access-control';
import { performSeatClaim } from '../../../../src/lib/server/seat-actions';
import { tablesSeatedAt } from '../../../../src/lib/shared/game-seats';
import { TABLE_CLOSED_RESPONSE, isTableClosed, loadRoom, updateRoomConfig, type TableExtrasConfig } from '../../../../src/lib/server/room-config';
import { PRIVATE_TABLE_RESPONSE, canEnterRoom, isPrivateRoom, isRoomMember } from '../../../../src/lib/server/room-privacy';
import { tournamentTableOf } from '../../../../src/lib/tournament/table-rooms';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST' }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { tableId, seatNumber, playerId: claimedPlayerId, playerName } = (req.body || {}) as {
      tableId?: string;
      seatNumber?: number;
      playerId?: string;
      playerName?: string;
    };

    const access = await requirePlayerAccess(req, res, claimedPlayerId);
    if (!access) return;
    if (!hasPermission(access, 'table.join')) return sendPermissionDenied(res, 'table.join', access);
    const playerId = access.userId;

    if (!tableId || !seatNumber || !playerName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const roomId = String(tableId);

    const maxTables = getLimit(access, 'tables.max_seated');
    if (maxTables !== null) {
      const elsewhere = await tablesSeatedAt(playerId, roomId);
      if (elsewhere.length >= maxTables) {
        return sendLimitReached(res, 'tables.max_seated', maxTables, `You're seated at: ${elsewhere.join(', ')}`);
      }
    }
    const room = await loadRoom(roomId).catch(() => null);
    const config = (room?.configuration || {}) as TableExtrasConfig;
    const isHost = !!room?.createdBy && room.createdBy === playerId;

    if (tournamentTableOf(room?.configuration)) {
      return res.status(409).json({ error: 'Seats at a tournament table are assigned by the tournament', code: 'TOURNAMENT_TABLE' });
    }
    if (isTableClosed(config)) return res.status(409).json(TABLE_CLOSED_RESPONSE);

    // Private tables: the host and players who used the invite link may sit. Staff who can see the
    // table without an invite also need table.join_private to sit at it.
    if (room && isPrivateRoom(config)) {
      if (!canEnterRoom(access, room)) return res.status(403).json(PRIVATE_TABLE_RESPONSE);
      if (!isHost && !isRoomMember(config, playerId) && !hasPermission(access, 'table.join_private')) {
        return sendPermissionDenied(res, 'table.join_private', access);
      }
    }

    // A seat offered to the next player on the waitlist is theirs until the offer runs out
    const offer = config.seatOffer;
    if (offer && Date.now() < offer.expiresAt && offer.seatNumber === Number(seatNumber) && offer.playerId !== playerId) {
      return res.status(409).json({ error: 'This seat is being offered to the next player on the waitlist', code: 'SEAT_HELD' });
    }

    // Tables that need the host's approval queue the request instead of seating the player
    if (config.requireSeatApproval && !isHost) {
      const requests = (config.seatRequests || []).filter(r => r.playerId !== playerId);
      requests.push({ playerId, playerName, seatNumber: Number(seatNumber), requestedAt: Date.now() });
      await updateRoomConfig(roomId, { seatRequests: requests });
      await publishTableEvent(roomId, { type: 'seat_request', playerId, playerName }).catch(() => {});
      return res.status(202).json({ ok: true, pending: true, seatNumber: Number(seatNumber) });
    }

    const result = await performSeatClaim(roomId, Number(seatNumber), playerId, playerName);
    return res.status(result.status).json(result.body);
  } catch (e: any) {
    console.error('seats/claim error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
