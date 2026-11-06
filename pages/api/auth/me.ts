import { requireAuth } from '../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET' }, async (req, res) => {
  try {
    // Get authenticated user ID from session
    const userId = await requireAuth(req);
    
    return res.status(200).json({ 
      userId,
      authenticated: true 
    });
  } catch (error) {
    return res.status(401).json({ 
      error: 'Not authenticated',
      authenticated: false 
    });
  }
});