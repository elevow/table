import { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { GameService } from '../../../../src/lib/services/game-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  try {
    const pool = getPool();
    const gameService = new GameService(pool);
    const room = await gameService.getRoomById(id);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    return res.status(200).json({
      id: room.id,
      name: room.name,
      gameType: room.gameType,
      maxPlayers: room.maxPlayers,
      status: room.status,
      createdAt: room.createdAt
    });
  } catch (error) {
    console.error('Error fetching room info:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}