import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { ChatService } from '../../../../src/lib/services/chat-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId } = req.query;
    const pool = new Pool();
    const svc = new ChatService(pool);
    const items = await svc.listReactions(String(messageId));
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
