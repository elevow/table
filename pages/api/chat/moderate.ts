import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { ChatService } from '../../../src/lib/services/chat-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId, moderatorId, hide } = req.body || {};
    const pool = new Pool();
    const svc = new ChatService(pool);
    const updated = await svc.moderate(String(messageId), String(moderatorId), hide !== false);
    // Real-time updates handled via HTTP polling or Supabase realtime
    return res.status(200).json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
