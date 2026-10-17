import type { NextApiRequest, NextApiResponse } from 'next';
import { getSessionUser } from '../../../src/lib/auth/auth-utils';
import { isAdminEmail } from '../../../src/utils/roleUtils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getSessionUser(req);
  if (user?.email && isAdminEmail(user.email)) {
    return res.status(200).json({ isAdmin: true, email: user.email });
  }

  return res.status(200).json({ isAdmin: false, reason: 'not_admin' });
}
