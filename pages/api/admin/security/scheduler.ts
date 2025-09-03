import type { NextApiRequest, NextApiResponse } from 'next';
import { SecurityScheduler } from '../../../../src/lib/security/security-scheduler';
import { initSecuritySchedulerDb } from '../../../../src/lib/security/security-scheduler-db';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { requireAdmin } from '../../../../src/lib/api/admin-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Ensure the scheduler uses DB-backed fetcher in this runtime
  initSecuritySchedulerDb();
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  if (!requireAdmin(req, res)) return;
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action === 'start') { SecurityScheduler.start(); return res.status(200).json({ started: true }); }
    if (action === 'stop') { SecurityScheduler.stop(); return res.status(200).json({ stopped: true }); }
    if (action === 'runOnce') { await SecurityScheduler.runOnce(); return res.status(200).json({ ran: true, lastRun: SecurityScheduler.getLastRun() }); }
    return res.status(400).json({ error: 'Invalid action' });
  }
  if (req.method === 'GET') {
    return res.status(200).json({ lastRun: SecurityScheduler.getLastRun() });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
