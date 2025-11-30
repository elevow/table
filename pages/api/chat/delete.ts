import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatDeleted } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import { isUserAdminBySession } from '../../../src/lib/api/admin-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  
  try {
    const { messageId: rawMessageId, userId: rawUserId } = req.body || {};
    
    // eslint-disable-next-line no-console
    console.log('[API/chat/delete] Request received:', { rawMessageId, rawUserId });
    
    if (!rawMessageId) {
      return res.status(400).json({ error: 'messageId required' });
    }
    if (!rawUserId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    // Convert to strings once for consistency
    const messageId = String(rawMessageId);
    const userId = String(rawUserId);
    
    const pool = getPool();
    const svc = new ChatService(pool);
    
    // Check if user is admin
    const isAdmin = await isUserAdminBySession(req, getPool);
    // eslint-disable-next-line no-console
    console.log('[API/chat/delete] Admin check result:', { isAdmin, hasAuthHeader: !!req.headers.authorization });
    
    // Get the message before deletion to get roomId for broadcast
    const message = await svc.getMessage(messageId);
    if (!message) {
      // eslint-disable-next-line no-console
      console.log('[API/chat/delete] Message not found:', messageId);
      return res.status(404).json({ error: 'message not found' });
    }
    
    // eslint-disable-next-line no-console
    console.log('[API/chat/delete] Authorization check:', { 
      messageSenderId: message.senderId, 
      userId, 
      isAdmin, 
      senderMatch: message.senderId === userId 
    });
    
    // Check authorization: user must be sender or admin
    if (message.senderId !== userId && !isAdmin) {
      // eslint-disable-next-line no-console
      console.log('[API/chat/delete] Authorization denied');
      return res.status(403).json({ error: 'not authorized to delete this message' });
    }
    
    const roomId = message.roomId;
    
    // Delete the message
    const result = await svc.deleteMessage(messageId, userId, isAdmin);
    
    // Broadcast via Supabase Realtime
    if (roomId) {
      try {
        await publishChatDeleted(roomId, { messageId, deletedBy: userId });
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
