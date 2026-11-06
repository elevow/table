import { getPool } from '../../../src/lib/database/pool';
import { requirePermission } from '../../../src/lib/auth/access-control';
import { apiHandler } from '../../../src/lib/api/handler';

interface AdminRoomsResponse {
  success: boolean;
  rooms: any[];
  total: number;
  page: number;
  limit: number;
}

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  // Check admin privileges
  if (!(await requirePermission(req, res, 'admin.rooms.view'))) return;

  try {
    const pool = getPool();
    const client = await pool.connect();

    try {
      // Pagination
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;

      // Get total count
      const countResult = await client.query('SELECT COUNT(*) as total FROM game_rooms');
      const total = parseInt(countResult.rows[0].total);

      // First, let's check what columns exist in the game_rooms table
      const schemaResult = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'game_rooms'
        ORDER BY ordinal_position
      `);
      
      // console.log('Available columns in game_rooms table:', schemaResult.rows.map(row => row.column_name));

      // Get all rooms from database
      const roomsResult = await client.query(`
        SELECT *
        FROM game_rooms
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      // Count seated players from the seats saved with each room. The in-memory seat map belongs
      // to whichever server instance answers, and misses players who stood up on another one.
      const { countSeatedInConfig } = await import('../../../src/lib/shared/game-seats');

      const enhancedRooms = roomsResult.rows.map(room => {
        const currentPlayers = countSeatedInConfig(room.configuration, Number(room.max_players) || 9);

        return {
          ...room,
          current_players: currentPlayers
        };
      });

      return res.status(200).json({
        success: true,
        rooms: enhancedRooms,
        total,
        page,
        limit
      });

    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error fetching admin rooms:', error);
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});
