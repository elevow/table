import * as GameSeats from '../../../../src/lib/shared/game-seats';
import { guardRoomEntry } from '../../../../src/lib/server/room-privacy';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET' }, async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const tableId = String(req.query.tableId || '');
    if (!tableId) {
      return res.status(400).json({ error: 'Missing tableId' });
    }

    if (!(await guardRoomEntry(req, res, tableId))) return;
    // Ensure seats exist and return current state
    const seats = await GameSeats.loadPersistedRoomSeats(tableId) || GameSeats.initializeRoomSeats(tableId);
    return res.status(200).json({ ok: true, seats });
  } catch (e: any) {
    console.error('seats/state error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
