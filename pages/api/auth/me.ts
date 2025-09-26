import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user ID from session
    const userId = await requireAuth(req);
    
    return res.status(200).json({ 
      userId,
      authenticated: true 
    });
  } catch (error) {
    return res.status(401).json({ 
      error: 'Not authenticated',
      authenticated: false 
    });
  }
}