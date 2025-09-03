import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { CollusionAnalyzer } from '../../../src/lib/security/collusion-analyzer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { hands } = req.body || {};
    if (!Array.isArray(hands)) return res.status(400).json({ error: 'hands array required' });
    const analyzer = new CollusionAnalyzer();
    const report = analyzer.analyze({ hands });
    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
