import { getPool } from '../../../src/lib/database/pool';
import { createSafeAudit } from '../../../src/lib/api/audit';
import { ApiError, apiHandler, clientIp } from '../../../src/lib/api/handler';
import { getAuthToken } from '../../../src/lib/auth/auth-utils';
import { hashSessionToken } from '../../../src/lib/auth/session-token';

/** Ends the caller's session by deleting its token. */
export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 30 } }, async (req, res) => {
  const token = getAuthToken(req);
  if (!token || token === 'null') throw new ApiError(400, 'No authentication token provided');

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const meta = { ip: clientIp(req), userAgent: req.headers['user-agent'] || '', endpoint: '/api/auth/logout' };

  try {
    // Signing out with an expired token still removes it; the user is only needed for the audit log
    const deleted = await pool.query(
      `DELETE FROM auth_tokens WHERE token_hash = $1 AND type = 'session' RETURNING user_id`,
      [hashSessionToken(token)]
    );
    await safeLog(deleted.rows[0]?.user_id || 'system', 'auth', 'logout', true, { ...meta, tokenProvided: true });
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('Logout error:', error);
    await safeLog('system', 'auth', 'logout_attempt', false, { ...meta, reason: error?.message || 'unknown_error' });
    return res.status(500).json({ error: 'Logout failed. Please try again.' });
  }
});
