import { getSessionUser } from '../../../src/lib/auth/auth-utils';
import { getUserAccess } from '../../../src/lib/auth/access-control';
import { apiHandler } from '../../../src/lib/api/handler';

// The signed-in user's roles and permissions, for showing or hiding admin UI.
// The server still checks each permission on every admin route.
export default apiHandler({ methods: 'GET' }, async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(200).json({ isAdmin: false, reason: 'not_signed_in', roles: [], permissions: [] });
  }

  const access = await getUserAccess(user);
  const permissions = [...access.permissions].sort();
  const isAdmin = access.permissions.has('admin.access');
  return res.status(200).json({
    isAdmin,
    email: user.email,
    roles: access.roles,
    permissions,
    limits: access.limits,
    sanction: access.sanction,
    ...(isAdmin ? {} : { reason: 'not_admin' }),
  });
});
