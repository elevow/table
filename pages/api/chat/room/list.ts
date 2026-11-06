import { ChatService } from '../../../../src/lib/services/chat-service';
import { getPool } from '../../../../src/lib/database/pool';
import { guardRoomEntry } from '../../../../src/lib/server/room-privacy';
import { loadRoom } from '../../../../src/lib/server/room-config';
import { tableDirectorId, withSenderNames } from '../../../../src/lib/server/chat-senders';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  try {
    const { roomId, limit, before } = req.query;
    if (!(await guardRoomEntry(req, res, String(roomId || '')))) return;
    const pool = getPool();
    const svc = new ChatService(pool);
    const items = await svc.listRoom({ roomId: String(roomId), limit: limit ? Number(limit) : undefined, before: before ? String(before) : undefined });
    // directorId: the tournament director, whose messages players can't mute
    const directorId = await tableDirectorId(await loadRoom(String(roomId)).catch(() => null));
    return res.status(200).json({ items: await withSenderNames(items), directorId });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
