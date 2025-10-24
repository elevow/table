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

    const { tableId, seatNumber, playerId } = (req.body || {}) as {
      tableId?: string;
      seatNumber?: number;
      playerId?: string;
    };

    if (!tableId || !playerId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const seats = GameSeats.getRoomSeats(String(tableId));
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

    // Verify ownership
    if (seats[sNum!]?.playerId !== playerId) {
      return res.status(403).json({ error: 'Not your seat' });
    }

    // Vacate
    seats[sNum!] = null;
    GameSeats.setRoomSeats(String(tableId), seats);

    // Broadcast seat vacated if Socket.IO server present
    try {
      const io = res.socket?.server?.io;
      if (io) {
        io.to(`table_${tableId}`).emit('seat_vacated', { seatNumber: sNum, playerId });
      }
    } catch {}

    // If a game engine is active, attempt auto-fold and update (best-effort)
    try {
      const io = res.socket?.server?.io;
      if ((global as any).activeGames && (global as any).activeGames.has(String(tableId))) {
        const engine = (global as any).activeGames.get(String(tableId));
        if (engine && typeof engine.removePlayer === 'function') {
          engine.removePlayer(playerId);
          let gameState = engine.getState();
          const activeCount = (gameState.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
          if (activeCount === 1 && gameState.stage !== 'showdown' && typeof engine.ensureWinByFoldIfSingle === 'function') {
            engine.ensureWinByFoldIfSingle();
            gameState = engine.getState();
          }
          if (io) {
            io.to(`table_${tableId}`).emit('game_state_update', {
              gameState,
              lastAction: { playerId, action: 'auto_fold_on_stand_up' },
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } catch {}

    return res.status(200).json({ ok: true, seatNumber: sNum, playerId });
  } catch (e: any) {
    console.error('seats/stand error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
