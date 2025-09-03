import type { NextApiRequest, NextApiResponse } from 'next';
import { adminAlertStore } from '../../../../src/lib/security/admin-alert-store';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { requireAdmin } from '../../../../src/lib/api/admin-auth';
import { adminAlertRepository } from '../../../../src/lib/security/admin-alert-repository';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  if (!requireAdmin(req, res)) return;
  if (req.method === 'GET') {
    // Prefer DB list to include cross-instance alerts, fallback to in-memory
    try {
      const alerts = await adminAlertRepository.list();
      return res.status(200).json({ alerts });
    } catch {
      return res.status(200).json({ alerts: adminAlertStore.list() });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
