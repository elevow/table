import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { ChatService } from '../../../../src/lib/services/chat-service';
import { getPool } from '../../../../src/lib/database/pool';
import { guardRoomEntry } from '../../../../src/lib/server/room-privacy';
import { loadRoom } from '../../../../src/lib/server/room-config';
import { tableDirectorId, withSenderNames } from '../../../../src/lib/server/chat-senders';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
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
}
