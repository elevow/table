import { getPool } from '../../../src/lib/database/pool';
import { UserManager } from '../../../src/lib/database/user-manager';
import { createUserService } from '../../../src/lib/services/user-service';
import { createSafeAudit } from '../../../src/lib/api/audit';
import { ApiError, apiHandler, clientIp } from '../../../src/lib/api/handler';

interface ChangePasswordRequest {
  currentPassword?: string;
  newPassword?: string;
}

/** Changes the signed-in user's password; the current one must be given. */
export default apiHandler(
  // Strict: each attempt is a password guess
  { methods: 'POST', rateLimit: { windowMs: 60_000, max: 5, shared: true }, auth: true },
  async (req, res, ctx) => {
    const userId = ctx.userId!;
    const { currentPassword, newPassword }: ChangePasswordRequest = req.body || {};

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, 'Current password and new password are required');
    }
    if (newPassword.length < 8) {
      throw new ApiError(400, 'New password must be at least 8 characters long');
    }
    if (currentPassword === newPassword) {
      throw new ApiError(400, 'New password must be different from current password');
    }

    const pool = getPool();
    const safeLog = createSafeAudit(pool);
    const meta = { ip: clientIp(req), userAgent: req.headers['user-agent'] || '', endpoint: '/api/auth/change-password' };

    try {
      await createUserService(new UserManager(pool)).changePassword({ userId, currentPassword, newPassword });
      await safeLog(userId, 'auth', 'password_change', true, meta);
      return res.status(200).json({ success: true, message: 'Password changed successfully' });
    } catch (error: any) {
      console.error('Password change error:', error);
      await safeLog(userId, 'auth', 'password_change_attempt', false, { ...meta, reason: error?.message || 'unknown_error' });

      if (error?.message === 'Current password is incorrect') {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      if (error?.message === 'User not found or no password set') {
        return res.status(404).json({ error: 'User account not found' });
      }
      return res.status(500).json({ error: 'Password change failed. Please try again.' });
    }
  }
);
