import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { isMultipart, parseMultipart } from '../../../src/lib/api/parse-multipart';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`POST /api/avatars/upload:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
  if (!rl.allowed) return res.status(429).json({ error: 'Upload limit exceeded. Try again later.' });

  try {
    // Support both multipart/form-data and JSON
    let userId: string | undefined;
    let originalUrl: string | undefined;
    let variants: Record<string, string> | undefined;

    if (isMultipart(req)) {
      const { fields /*, files*/ } = await parseMultipart(req);
      userId = Array.isArray(fields.userId) ? fields.userId[0] as string : (fields.userId as string | undefined);
      originalUrl = Array.isArray(fields.originalUrl) ? fields.originalUrl[0] as string : (fields.originalUrl as string | undefined);
      // Variants may be sent as JSON string in a field
      const variantsField = Array.isArray(fields.variants) ? fields.variants[0] : fields.variants;
      if (typeof variantsField === 'string') {
        try { variants = JSON.parse(variantsField); } catch { variants = undefined; }
      } else if (variantsField && typeof variantsField === 'object') {
        variants = variantsField as any;
      }
      // If actual files are sent, hooking a storage pipeline would go here
    } else {
      const body = (req.body || {}) as { userId?: string; originalUrl?: string; variants?: Record<string, string> };
      userId = body.userId;
      originalUrl = body.originalUrl;
      variants = body.variants;
    }

    if (!userId || !originalUrl || !variants) return res.status(400).json({ error: 'Missing required fields' });
    const pool = new Pool();
    const service = new AvatarService(pool as any);
    const avatar = await service.uploadAvatar({ userId, originalUrl, variants });
    return res.status(201).json({ id: avatar.id, url: avatar.originalUrl, thumbnails: avatar.variants, status: avatar.status });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
