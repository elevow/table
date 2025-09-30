import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminEmail } from '../../../src/utils/roleUtils';
import * as GameSeats from '../../../src/lib/shared/game-seats';

interface RoomStats {
  roomId: string;
  currentPlayers: number;
  playerList: Array<{
    seatNumber: number;
    playerId: string;
    playerName: string;
    chips: number;
  }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check admin authorization
    const userEmail = req.headers['x-user-email'] as string;
    
    if (!userEmail || !isAdminEmail(userEmail)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { roomId } = req.query;

    if (roomId && typeof roomId === 'string') {
      // Get stats for a specific room
  const roomStats = GameSeats.getRoomStats(roomId);
      return res.status(200).json(roomStats);
    } else {
      // Get stats for all active rooms
      const allStats: RoomStats[] = [];
      
      for (const tableId of GameSeats.getActiveRooms()) {
        const stats = GameSeats.getRoomStats(tableId);
        if (stats.currentPlayers > 0) {
          allStats.push(stats);
        }
      }

      return res.status(200).json(allStats);
    }
  } catch (error) {
    console.error('Error fetching room stats:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch room statistics'
    });
  }
}

// Keeping RoomStats type alignment via shared module methods