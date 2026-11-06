import { requirePermission } from '../../../src/lib/auth/access-control';
import { CollusionAnalyzer } from '../../../src/lib/security/collusion-analyzer';
import { adminAlertStore } from '../../../src/lib/security/admin-alert-store';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  // Results go into the admin alert queue, so only security staff may run an analysis
  if (!(await requirePermission(req, res, 'admin.security.config'))) return;
  try {
    const { hands } = req.body || {};
    if (!Array.isArray(hands)) return res.status(400).json({ error: 'hands array required' });
    const analyzer = new CollusionAnalyzer();
  const report = analyzer.analyze({ hands });
  // Record alerts for admin review
  adminAlertStore.addFromCollusion(report);
    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
