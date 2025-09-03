import type { NextApiRequest, NextApiResponse } from 'next';

// Simple admin auth guard using a shared token header.
// In production, replace with session-based RBAC.
export function isAdminAuthorized(req: NextApiRequest): boolean {
  const headerToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token' as any];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return typeof token === 'string' && token === expected;
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse): boolean {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
