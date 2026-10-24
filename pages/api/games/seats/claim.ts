import type { NextApiRequest, NextApiResponse } from 'next';
import { publishTableEvent } from '../../../../src/lib/realtime/publisher';
import { requirePlayer } from '../../../../src/lib/auth/auth-utils';
import { performSeatClaim } from '../../../../src/lib/server/seat-actions';
import { loadRoom, updateRoomConfig, type TableExtrasConfig } from '../../../../src/lib/server/room-config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const playerId = await requirePlayer(req, res, claimedPlayerId);
    if (!playerId) return;

    if (!tableId || !seatNumber || !playerName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const roomId = String(tableId);
    const room = await loadRoom(roomId).catch(() => null);
    const config = (room?.configuration || {}) as TableExtrasConfig;
    const isHost = !!room?.createdBy && room.createdBy === playerId;

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
}
