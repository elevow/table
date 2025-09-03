import type { NextApiRequest, NextApiResponse } from 'next';
import { adminAlertStore } from '../../../../src/lib/security/admin-alert-store';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { requireAdmin } from '../../../../src/lib/api/admin-auth';
import { adminAlertRepository } from '../../../../src/lib/security/admin-alert-repository';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  if (!requireAdmin(req, res)) return;
  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'id required' });
  if (req.method === 'GET') {
    try {
      const alert = await adminAlertRepository.get(id);
      return res.status(alert ? 200 : 404).json({ alert });
    } catch {
      return res.status(200).json({ alert: adminAlertStore.get(id) });
    }
  }
  if (req.method === 'PATCH') {
    try {
      const { status } = req.body || {};
      if (!['new', 'acknowledged', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      try {
        const updated = await adminAlertRepository.updateStatus(id, status);
        if (updated) adminAlertStore.updateStatus(id, status);
        return res.status(updated ? 200 : 404).json({ alert: updated });
      } catch {
        const updated = adminAlertStore.updateStatus(id, status);
        return res.status(updated ? 200 : 404).json({ alert: updated });
      }
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || 'Bad request' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
