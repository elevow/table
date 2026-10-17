import { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { requireAdminSession } from '../../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Rate limiting
  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Check admin privileges
  if (!(await requireAdminSession(req, res))) return;

  const { id } = req.query;
  
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  if (req.method === 'DELETE') {
    try {
      const pool = getPool();
      const client = await pool.connect();

      try {
        // First check if the room exists
        const checkResult = await client.query('SELECT id FROM game_rooms WHERE id = $1', [id]);
        
        if (checkResult.rows.length === 0) {
          return res.status(404).json({ error: 'Room not found' });
        }

        // Delete the room (this might cascade to related records depending on your schema)
        await client.query('DELETE FROM game_rooms WHERE id = $1', [id]);

        console.log(`Admin deleted room ${id}`);

        return res.status(200).json({
          success: true,
          message: 'Room deleted successfully'
        });

      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error deleting room:', error);
      return res.status(500).json({ 
        error: 'Failed to delete room',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  if (req.method === 'GET') {
    try {
      const pool = getPool();
      const client = await pool.connect();

      try {
        // Get specific room details
        const roomResult = await client.query('SELECT * FROM game_rooms WHERE id = $1', [id]);
        
        if (roomResult.rows.length === 0) {
          return res.status(404).json({ error: 'Room not found' });
        }

        return res.status(200).json({
          success: true,
          room: roomResult.rows[0]
        });

      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error fetching room:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch room details'
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}