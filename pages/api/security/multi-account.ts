import { requirePermission } from '../../../src/lib/auth/access-control';
import { MultiAccountAnalyzer } from '../../../src/lib/security/multi-account-analyzer';
import { adminAlertStore } from '../../../src/lib/security/admin-alert-store';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  // Results go into the admin alert queue, so only security staff may run an analysis
  if (!(await requirePermission(req, res, 'admin.security.config'))) return;
  try {
    const { logins } = req.body || {};
    if (!Array.isArray(logins)) return res.status(400).json({ error: 'logins array required' });
    const analyzer = new MultiAccountAnalyzer();
  const report = analyzer.analyze({ logins });
  // Record alert for admin review
  adminAlertStore.addFromMultiAccount(report);
    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
