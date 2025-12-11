import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { isUserAdminBySession } from '../../../../src/lib/api/admin-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pool = getPool();
    
    // Verify the user is an admin
    const isAdmin = await isUserAdminBySession(req, () => pool);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admin users can update room configuration' });
    }

    const { roomId, timeBetweenRounds } = req.body;

    if (!roomId || typeof roomId !== 'string') {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    // Validate timeBetweenRounds if provided
    if (timeBetweenRounds !== undefined) {
      const time = Number(timeBetweenRounds);
      if (!Number.isFinite(time) || time < 1 || time > 60) {
        return res.status(400).json({ error: 'timeBetweenRounds must be between 1 and 60 seconds' });
      }
    }

    // Fetch current room to get existing configuration
    const roomResult = await pool.query(
      'SELECT configuration FROM game_rooms WHERE id = $1',
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Merge new settings with existing configuration
    const existingConfig = roomResult.rows[0].configuration || {};
    const updatedConfig = {
      ...existingConfig,
      ...(timeBetweenRounds !== undefined && { timeBetweenRounds: Number(timeBetweenRounds) }),
    };

    // Update the room configuration
    await pool.query(
      'UPDATE game_rooms SET configuration = $1 WHERE id = $2',
      [JSON.stringify(updatedConfig), roomId]
    );

    // Also update the in-memory room config if it exists (for active games)
    const g: any = global as any;
    const roomConfig = g?.roomConfigs?.get(roomId);
    if (roomConfig) {
      if (timeBetweenRounds !== undefined) {
        roomConfig.timeBetweenRounds = Number(timeBetweenRounds);
      }
      g.roomConfigs.set(roomId, roomConfig);
    }

    return res.status(200).json({ 
      success: true, 
      configuration: updatedConfig 
    });
  } catch (error) {
    console.error('Error updating room configuration:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
