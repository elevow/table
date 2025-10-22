import { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { rateLimit } from '../../../src/lib/api/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Rate limiting
  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { roomCode } = req.body;

  if (!roomCode || typeof roomCode !== 'string') {
    return res.status(400).json({ error: 'Room code is required' });
  }

  // Normalize room code (trim and uppercase)
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  
  if (normalizedRoomCode.length === 0) {
    return res.status(400).json({ error: 'Room code cannot be empty' });
  }

  try {
    // Use centralized pool with robust TLS/CA handling and Vercel/Supabase integration vars
    const pool = getPool();
    const client = await pool.connect();

    try {
      // Check if room exists and get basic info
      // We'll try different possible column names since we're not sure of the exact schema
      let result;
      
      // Try with common column name variations
      try {
        result = await client.query(`
          SELECT id, status, max_players, current_players, players_count, created_at 
          FROM game_rooms 
          WHERE UPPER(room_code) = $1 OR UPPER(room_id) = $1 OR UPPER(id) = $1
          LIMIT 1
        `, [normalizedRoomCode]);
      } catch (error) {
        // If that fails, try a simpler query
        result = await client.query(`
          SELECT * 
          FROM game_rooms 
          WHERE UPPER(id) = $1
          LIMIT 1
        `, [normalizedRoomCode]);
      }

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Room not found',
          message: `No room found with code: ${roomCode}`
        });
      }

      const room = result.rows[0];
      
      // Check if room is joinable (not full, active, etc.)
      const maxPlayers = room.max_players || 9; // Default max players
      const currentPlayers = room.current_players || room.players_count || 0;
      
      let joinable = true;
      let reason = '';
      
      if (room.status && room.status.toLowerCase() === 'finished') {
        joinable = false;
        reason = 'Room has finished';
      } else if (currentPlayers >= maxPlayers) {
        joinable = false;
        reason = 'Room is full';
      }

      return res.status(200).json({
        success: true,
        room: {
          id: room.id,
          status: room.status || 'active',
          maxPlayers,
          currentPlayers,
          createdAt: room.created_at
        },
        joinable,
        reason: joinable ? 'Room is available to join' : reason
      });

    } finally {
      client.release();
      // Do not end the shared pool
    }
  } catch (error) {
    console.error('Error validating room code:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to validate room code'
    });
  }
}