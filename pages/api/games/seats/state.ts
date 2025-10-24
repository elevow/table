import type { NextApiRequest, NextApiResponse } from 'next';
import * as GameSeats from '../../../../src/lib/shared/game-seats';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const tableId = String(req.query.tableId || '');
    if (!tableId) {
      return res.status(400).json({ error: 'Missing tableId' });
    }

    // Ensure seats exist and return current state
    const seats = GameSeats.initializeRoomSeats(tableId);
    return res.status(200).json({ ok: true, seats });
  } catch (e: any) {
    console.error('seats/state error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
