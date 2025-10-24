import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HttpServer } from 'http';
import * as GameSeats from '../../../../src/lib/shared/game-seats';

interface NextApiResponseServerIO extends NextApiResponse {
  socket: any & {
    server: HttpServer & { io?: any };
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
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

    // Claim seat
    seats[seatNumber] = { playerId, playerName, chips: Number(chips) || 20 };
    GameSeats.setRoomSeats(String(tableId), seats);

    // Broadcast via Socket.IO if server is present (hybrid support)
    try {
      const io = res.socket?.server?.io;
      if (io) {
        io.to(`table_${tableId}`).emit('seat_claimed', {
          seatNumber,
          playerId,
          playerName,
          chips: Number(chips) || 20,
        });
      }
    } catch {}

    return res.status(200).json({ ok: true, seatNumber, playerId, playerName, chips: Number(chips) || 20, seats });
  } catch (e: any) {
    console.error('seats/claim error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
