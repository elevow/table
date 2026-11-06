import { getPool } from '../../../../src/lib/database/pool';
import { GameService } from '../../../../src/lib/services/game-service';
import { getSessionUser } from '../../../../src/lib/auth/auth-utils';
import { getUserAccess } from '../../../../src/lib/auth/access-control';
import {
  PRIVATE_TABLE_RESPONSE, canEnterRoom, isPrivateRoom, withoutPrivateFields,
} from '../../../../src/lib/server/room-privacy';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET' }, async (req, res) => {
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

    // Private rooms: only the host, members and staff with table.view_private; only the host sees the invite code
    let isHost = false;
    if (isPrivateRoom(room.configuration)) {
      const user = await getSessionUser(req);
      const access = user ? await getUserAccess(user) : null;
      if (!canEnterRoom(access, room)) return res.status(403).json(PRIVATE_TABLE_RESPONSE);
      isHost = !!user && room.createdBy === user.id;
    }

    // Expose configuration and blind levels so clients can initialize correct variant/betting mode/blinds
    return res.status(200).json({
      id: room.id,
      name: room.name,
      gameType: room.gameType,
      maxPlayers: room.maxPlayers,
      status: room.status,
      createdAt: room.createdAt,
      // The host, who has the table controls
      createdBy: room.createdBy,
      configuration: isHost ? room.configuration || null : withoutPrivateFields(room.configuration || null),
      blindLevels: room.blindLevels || null,
    });
  } catch (error) {
    console.error('Error fetching room info:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});