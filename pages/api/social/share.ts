import type { NextApiRequest, NextApiResponse } from 'next';
import { SocialService } from '../../../src/lib/services/social-service';
import { getDbPool } from '../../../src/lib/database/database-connection';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const pool = getDbPool();
    const svc = new SocialService(pool as any);
    const body = req.body || {};
    const result = await svc.createShare({
      userId: body.userId,
      kind: body.kind,
      refId: body.refId,
      visibility: body.visibility,
      message: body.message,
      platforms: body.platforms,
      payload: body.payload,
      shareSlug: body.shareSlug,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Failed to create share' });
  }
}
