import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Socket.IO API endpoint - deprecated
 * Socket.IO transport has been removed. Only Supabase transport is supported.
 * This endpoint returns a message indicating the deprecation.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(410).json({
    status: 'deprecated',
    message: 'Socket.IO transport has been removed. Please use Supabase realtime instead.',
  });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
