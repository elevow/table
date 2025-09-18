import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, originalUrl, variants } = req.body;

    if (!userId || !originalUrl || !variants) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Simulate successful avatar upload without database
    const mockAvatar = {
      id: uuidv4(),
      userId,
      originalUrl,
      variants,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    console.log('Mock avatar upload:', mockAvatar);

    return res.status(201).json({
      id: mockAvatar.id,
      url: mockAvatar.originalUrl,
      thumbnails: mockAvatar.variants,
      status: mockAvatar.status
    });
  } catch (error: any) {
    console.error('Mock avatar upload error:', error);
    return res.status(500).json({ error: error?.message || 'Internal error' });
  }
}