import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const avatarId = (req.query as any).avatarId as string;
  if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

  if (req.method === 'PUT') {
    const rl = rateLimit(`PUT /api/avatars/:avatarId:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
    if (!rl.allowed) return res.status(429).json({ error: 'Update limit exceeded. Try again later.' });
    try {
      const { action, moderatorId } = (req.body || {}) as { action: 'approve' | 'reject'; moderatorId: string };
      if (!action || !moderatorId) return res.status(400).json({ error: 'Missing action or moderatorId' });
      const pool = new Pool();
      const service = new AvatarService(pool as any);
      const result = action === 'approve' ? await service.approveAvatar(avatarId, moderatorId) : await service.rejectAvatar(avatarId, moderatorId);
      return res.status(200).json({ id: result.id, status: result.status, moderatedAt: result.moderatedAt, moderatorId: result.moderatorId });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'Internal error' });
    }
  }

  if (req.method === 'DELETE') {
    const rl = rateLimit(`DELETE /api/avatars/:avatarId:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
    if (!rl.allowed) return res.status(429).json({ error: 'Delete limit exceeded. Try again later.' });
    // Soft delete (archive) since we didn't add physical delete in manager; set status to archived
    try {
      const pool = new Pool();
      const service = new AvatarService(pool as any);
      const archived = await service['manager'].updateAvatar(avatarId, { status: 'archived', moderatedAt: new Date() });
      return res.status(200).json({ success: true, id: archived.id, status: archived.status });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: e?.message || 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
