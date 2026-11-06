import { getPool } from '../../../src/lib/database/pool';
import { apiHandler, assertSelf } from '../../../src/lib/api/handler';
import { FriendService } from '../../../src/lib/services/friend-service';

export default apiHandler(
  { methods: 'GET', auth: true, rateLimit: { windowMs: 60 * 1000, max: 240 } },
  async (req, res, ctx) => {
    const { userId: claimed, kind, page, limit } = req.query as { userId?: string; kind?: 'incoming' | 'outgoing'; page?: string; limit?: string };
    const userId = assertSelf(ctx, claimed, 'userId');
    const k = kind === 'outgoing' ? 'outgoing' : 'incoming';
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 20;
    const resp = await new FriendService(getPool()).listInvites(userId, k, p, l);
    return res.status(200).json(resp);
  }
);
