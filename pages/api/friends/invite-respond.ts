import { getPool } from '../../../src/lib/database/pool';
import { apiHandler, ApiError } from '../../../src/lib/api/handler';
import { FriendService } from '../../../src/lib/services/friend-service';

export default apiHandler(
  { methods: 'POST', auth: true, rateLimit: { windowMs: 60 * 60 * 1000, max: 120 }, errorStatus: { NOT_FOUND: 404 } },
  async (req, res, ctx) => {
    const { id, action } = (req.body || {}) as { id?: string; action?: 'accept' | 'decline' };
    if (!id || (action !== 'accept' && action !== 'decline')) throw new ApiError(400, 'Missing id or invalid action');
    // Scoped to the caller as invitee, so someone else's invite reads as not found
    const invite = await new FriendService(getPool()).respondToInvite(id, action, ctx.userId!);
    return res.status(200).json(invite);
  }
);
