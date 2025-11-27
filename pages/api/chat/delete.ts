import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatDeleted } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import { isAdminEmail } from '../../../src/utils/roleUtils';

// Check if user is admin based on session
async function isUserAdmin(req: NextApiRequest): Promise<boolean> {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.replace('Bearer ', '') || req.cookies.session_token || req.cookies.auth_token;
    
    if (!sessionToken || sessionToken === 'null') {
      return false;
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      const result = await client.query(
        `SELECT u.email FROM users u 
         JOIN auth_tokens at ON u.id = at.user_id 
         WHERE at.token_hash = $1 AND at.expires_at > NOW()`,
        [sessionToken]
      );
      
      if (result.rows.length === 0) {
        return false;
      }
      
      const userEmail = result.rows[0].email;
      return isAdminEmail(userEmail);
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  
  try {
    const { messageId, userId } = req.body || {};
    
    if (!messageId) {
      return res.status(400).json({ error: 'messageId required' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const pool = getPool();
    const svc = new ChatService(pool);
    
    // Check if user is admin
    const isAdmin = await isUserAdmin(req);
    
    // Get the message before deletion to get roomId for broadcast
    const message = await svc.getMessage(String(messageId));
    if (!message) {
      return res.status(404).json({ error: 'message not found' });
    }
    
    // Check authorization: user must be sender or admin
    if (message.senderId !== String(userId) && !isAdmin) {
      return res.status(403).json({ error: 'not authorized to delete this message' });
    }
    
    const roomId = message.roomId;
    
    // Delete the message
    const result = await svc.deleteMessage(String(messageId), String(userId), isAdmin);
    
    // Broadcast via Supabase Realtime
    if (roomId) {
      try {
        await publishChatDeleted(roomId, { messageId: String(messageId), deletedBy: String(userId) });
      } catch {
        // Continue if Supabase broadcast fails
      }
    }
    
    return res.status(200).json(result);
  } catch (err: unknown) {
    const error = err as Error;
    const message = error?.message || 'Bad request';
    
    if (message === 'not authorized to delete this message') {
      return res.status(403).json({ error: message });
    }
    if (message === 'message not found') {
      return res.status(404).json({ error: message });
    }
    
    return res.status(400).json({ error: message });
  }
}
