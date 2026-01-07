import type { NextApiRequest, NextApiResponse } from 'next';
import * as GameSeats from '../../../../src/lib/shared/game-seats';
import { publishSeatState, publishSeatVacated, publishGameStateUpdate } from '../../../../src/lib/realtime/publisher';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    // At this point sNum is guaranteed to be a valid number
    // Check if seat is already empty (idempotent operation)
    if (seats[sNum] === null) {
      // Player is already not seated, return success
      return res.status(200).json({ ok: true, seatNumber: sNum, playerId, alreadyVacated: true });
    }

    // Verify ownership
    if (seats[sNum]?.playerId !== playerId) {
      return res.status(403).json({ error: 'Not your seat' });
    }

    // Vacate
    seats[sNum] = null;
    GameSeats.setRoomSeats(String(tableId), seats);

    const seatPayload = { seatNumber: sNum, playerId };

    // Broadcast via Supabase for realtime clients
    try {
      await Promise.all([
        publishSeatVacated(String(tableId), seatPayload),
        publishSeatState(String(tableId), { seats })
      ]);
    } catch (pubErr) {
      console.warn('Seat vacate Supabase publish failed:', pubErr);
    }

    // If a game engine is active, attempt auto-fold and update (best-effort)
    try {
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
          // Broadcast game state update via Supabase
          try {
            await publishGameStateUpdate(String(tableId), {
              gameState,
              lastAction: { playerId, action: 'auto_fold_on_stand_up' },
              timestamp: new Date().toISOString(),
            });
          } catch {}
        }
      }
    } catch {}

    return res.status(200).json({ ok: true, seatNumber: sNum, playerId });
  } catch (e: any) {
    console.error('seats/stand error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
