import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../../src/lib/api/admin-auth';
import { getLiveSecurityConfig } from '../../../../src/lib/security/security-config';
import { getSecurityOverrides, updateSecurityOverrides, clearSecurityOverrides } from '../../../../src/lib/security/security-config-runtime';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    const cfg = getLiveSecurityConfig();
    const overrides = getSecurityOverrides();
    return res.status(200).json({ config: cfg, overrides });
  }

  if (req.method === 'PATCH') {
    try {
      const body = req.body || {};
      if (body && body.clear === true) {
        clearSecurityOverrides();
      } else if (body && body.overrides) {
        updateSecurityOverrides(body.overrides);
      } else {
        updateSecurityOverrides(body);
      }
      const cfg = getLiveSecurityConfig();
      const overrides = getSecurityOverrides();
      return res.status(200).json({ ok: true, config: cfg, overrides });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || 'Invalid overrides' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
