import { getPool } from '../../../src/lib/database/pool';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler(
  {
    methods: 'DELETE',
    rateLimit: { windowMs: 60 * 60 * 1000, max: 5, message: 'Delete limit exceeded. Try again later.', shared: true },
    auth: true,
  },
  async (req, res, { userId }) => {
    const avatarId = (req.query as any).avatarId as string;
    if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

    const pool = getPool();
    const service = new AvatarService(pool as any);
    // Only the avatar's owner may remove it; someone else's looks the same as a missing one
    const avatar = await service['manager'].getAvatarById(avatarId);
    if (!avatar || avatar.userId !== userId) return res.status(404).json({ error: 'Not found' });
    const archived = await service['manager'].updateAvatar(avatarId, { status: 'archived' });
    return res.status(200).json({ success: true, id: archived.id, status: archived.status });
  }
);
