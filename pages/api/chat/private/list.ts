import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { ChatService } from '../../../../src/lib/services/chat-service';
import { getPool } from '../../../../src/lib/database/pool';
import { requirePlayer } from '../../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const userId = await requirePlayer(req, res);
  if (!userId) return;
  const { userAId, userBId, limit, before } = req.query;
  // Only the two people in a private conversation may read it
  if (String(userAId) !== userId && String(userBId) !== userId) {
    return res.status(403).json({ error: 'Not a participant in this conversation' });
  }
  try {
    const pool = getPool();
    const svc = new ChatService(pool);
    const items = await svc.listPrivate({ userAId: String(userAId), userBId: String(userBId), limit: limit ? Number(limit) : undefined, before: before ? String(before) : undefined });
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
