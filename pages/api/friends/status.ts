import { getPool } from '../../../src/lib/database/pool';
import { apiHandler, ApiError } from '../../../src/lib/api/handler';
import { FriendService } from '../../../src/lib/services/friend-service';

export default apiHandler(
  { methods: 'GET', auth: true, rateLimit: { windowMs: 60 * 1000, max: 240 } },
  async (req, res, ctx) => {
    const { a, b } = req.query as { a?: string; b?: string };
    if (!a || !b) throw new ApiError(400, 'Missing a or b');
    // Only a party to the relationship may look it up
    if (ctx.userId !== a && ctx.userId !== b) throw new ApiError(403, 'Not a party to this relationship');
    const status = await new FriendService(getPool()).relationshipStatus(a, b);
    return res.status(200).json(status);
  }
);
