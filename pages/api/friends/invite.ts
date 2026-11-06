import { getPool } from '../../../src/lib/database/pool';
import { apiHandler, ApiError, assertSelf } from '../../../src/lib/api/handler';
import { FriendService } from '../../../src/lib/services/friend-service';

export default apiHandler(
  { methods: 'POST', auth: true, rateLimit: { windowMs: 60 * 60 * 1000, max: 120 }, errorStatus: { BLOCKED: 400 } },
  async (req, res, ctx) => {
    const { inviterId: claimed, inviteeId, roomId } = (req.body || {}) as { inviterId?: string; inviteeId?: string; roomId?: string };
    const inviterId = assertSelf(ctx, claimed, 'inviterId');
    if (!inviteeId || !roomId) throw new ApiError(400, 'Missing inviteeId or roomId');
    const invite = await new FriendService(getPool()).inviteToGame(inviterId, inviteeId, roomId);
    return res.status(201).json(invite);
  }
);
