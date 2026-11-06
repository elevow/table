import * as GameSeats from '../../../../src/lib/shared/game-seats';
import { requirePlayer } from '../../../../src/lib/auth/auth-utils';
import { leaveTable } from '../../../../src/lib/server/seat-actions';
import { loadRoom } from '../../../../src/lib/server/room-config';
import { tournamentTableOf } from '../../../../src/lib/tournament/table-rooms';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST' }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { tableId, seatNumber, playerId: claimedPlayerId } = (req.body || {}) as {
      tableId?: string;
      seatNumber?: number;
      playerId?: string;
    };

    const playerId = await requirePlayer(req, res, claimedPlayerId);
    if (!playerId) return;

    if (!tableId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Leaving a tournament table would cash out tournament chips; the director removes players instead
    if (tournamentTableOf((await loadRoom(String(tableId)).catch(() => null))?.configuration)) {
      return res.status(409).json({ error: "You can't leave a tournament table. Ask the director if you need to withdraw.", code: 'TOURNAMENT_TABLE' });
    }

    const seats = await GameSeats.loadPersistedRoomSeats(String(tableId)) || GameSeats.getRoomSeats(String(tableId));
    if (!seats || Object.keys(seats).length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Find seat if not provided
    let sNum = seatNumber;
    if (!sNum || !Number.isFinite(sNum)) {
      const entry = Object.entries(seats).find(([, a]) => a?.playerId === playerId);
      if (!entry) {
        return res.status(404).json({ error: 'Player not seated' });
      }
      sNum = Number(entry[0]);
    }

    // At this point sNum is guaranteed to be a valid number
    // Verify ownership or check for idempotency
    if (seats[sNum] === null) {
      // Seat is empty - check if player is seated elsewhere
      const playerSeatedElsewhere = Object.entries(seats).find(
        ([seatNum, assignment]) => seatNum !== String(sNum) && assignment?.playerId === playerId
      );
      
      if (playerSeatedElsewhere) {
        // Player is seated in a different seat - this is not their seat
        return res.status(403).json({ error: 'Not your seat' });
      }
      
      // Player is not seated anywhere and target seat is empty - idempotent success
      return res.status(200).json({ ok: true, seatNumber: sNum, playerId, alreadyVacated: true });
    }

    // Verify ownership
    if (seats[sNum]?.playerId !== playerId) {
      return res.status(403).json({ error: 'Not your seat' });
    }

    // Fold them out of any hand, vacate the seat, record the cash-out and offer the seat to the waitlist
    await leaveTable({ roomId: String(tableId), playerId, reason: 'stand_up', res });

    return res.status(200).json({ ok: true, seatNumber: sNum, playerId });
  } catch (e: any) {
    console.error('seats/stand error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
