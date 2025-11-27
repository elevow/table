import type { NextApiRequest, NextApiResponse } from 'next';
import * as GameSeats from '../../../../src/lib/shared/game-seats';
import { publishSeatClaimed, publishSeatState } from '../../../../src/lib/realtime/publisher';
import { fetchRoomRebuyLimit } from '../../../../src/lib/shared/rebuy-limit';
import { getPlayerRebuyInfo, recordBuyin } from '../../../../src/lib/shared/rebuy-tracker';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { tableId, seatNumber, playerId, playerName, chips } = (req.body || {}) as {
      tableId?: string;
      seatNumber?: number;
      playerId?: string;
      playerName?: string;
      chips?: number;
    };

    if (!tableId || !seatNumber || !playerId || !playerName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const roomId = String(tableId);

    const seats = GameSeats.initializeRoomSeats(String(tableId));

    // Validate seat availability
    if (seats[seatNumber] !== null) {
      return res.status(409).json({ error: 'Seat already occupied', seatNumber });
    }

    // Ensure player is not already seated elsewhere
    const existing = Object.entries(seats).find(([, a]) => a?.playerId === playerId);
    if (existing) {
      return res.status(409).json({ error: 'Player already has a seat', seatNumber: Number(existing[0]) });
    }

    const rebuyLimit = await fetchRoomRebuyLimit(roomId);
    const previous = getPlayerRebuyInfo(roomId, playerId);
    const isInitial = !previous;
    const rebuysUsed = previous?.rebuys ?? 0;
    const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;

    if (!isInitial && rebuysUsed >= numericLimit) {
      const message = rebuyLimit === 'unlimited'
        ? 'Rebuys are currently unavailable.'
        : `Rebuy limit (${rebuyLimit}) reached for this room.`;
      return res.status(403).json({ error: message, rebuyLimit, rebuysUsed });
    }

    // Claim seat
    seats[seatNumber] = { playerId, playerName, chips: Number(chips) || 20 };
    GameSeats.setRoomSeats(String(tableId), seats);

    const seatPayload = { seatNumber, playerId, playerName, chips: Number(chips) || 20 };

    // Fan out to Supabase realtime
    try {
      await Promise.all([
        publishSeatClaimed(String(tableId), seatPayload),
        publishSeatState(String(tableId), { seats })
      ]);
    } catch (pubErr) {
      console.warn('Seat claim Supabase publish failed:', pubErr);
    }

    const rebuyRecord = recordBuyin(roomId, playerId);

    return res.status(200).json({ ok: true, ...seatPayload, seats, rebuyCount: rebuyRecord.rebuys });
  } catch (e: any) {
    console.error('seats/claim error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
