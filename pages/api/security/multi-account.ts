import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { MultiAccountAnalyzer } from '../../../src/lib/security/multi-account-analyzer';
import { adminAlertStore } from '../../../src/lib/security/admin-alert-store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { logins } = req.body || {};
    if (!Array.isArray(logins)) return res.status(400).json({ error: 'logins array required' });
    const analyzer = new MultiAccountAnalyzer();
  const report = analyzer.analyze({ logins });
  // Record alert for admin review
  adminAlertStore.addFromMultiAccount(report);
    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
