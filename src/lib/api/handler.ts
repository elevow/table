import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from './rate-limit';
import { sharedRateLimit } from './shared-rate-limit';
import { getAuthenticatedUserId } from '../auth/auth-utils';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiHandlerOptions {
  /** Allowed HTTP method(s); anything else gets 405. */
  methods: Method | Method[];
  /**
   * Per-client limit for this route; over it gets 429 (with `message`, if given). With `shared`,
   * the count is kept in Redis so it holds across serverless instances; use it for low-traffic,
   * abuse-prone routes, since each check is a billed Redis command.
   */
  rateLimit?: { windowMs: number; max: number; message?: string; shared?: boolean };
  /** Require a signed-in session; without one the route gets 401. */
  auth?: boolean;
  /** Map a thrown error's `code` (e.g. FriendError codes) to an HTTP status. */
  errorStatus?: Record<string, number>;
  /** Sends the response for any other thrown error, e.g. a domain's own error-to-status mapping. */
  onError?: (res: NextApiResponse, error: unknown) => unknown;
}

export interface ApiContext {
  /** The signed-in user's ID; always set when `auth: true`. */
  userId: string | null;
}

/** Throw from a route to respond with this status and message. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The caller's IP: first hop of x-forwarded-for, else the socket address. */
export function clientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'anon';
}

/**
 * The route's path with dynamic segments named, e.g. /api/avatars/[avatarId] for /api/avatars/abc,
 * so a rate limit covers the route and can't be dodged by varying the ID.
 */
export function routeKey(req: NextApiRequest): string {
  const path = (req.url || '').split('?')[0];
  const params = Object.entries(req.query || {});
  return path
    .split('/')
    .map(segment => {
      let decoded = segment;
      try { decoded = decodeURIComponent(segment); } catch { /* keep as is */ }
      const param = params.find(([, v]) => (Array.isArray(v) ? v.includes(decoded) : v === decoded));
      return segment && param ? `[${param[0]}]` : segment;
    })
    .join('/');
}

/**
 * A claimed user ID from the request must be the caller's own.
 * Returns the caller's ID, so an omitted claim defaults to "me".
 */
export function assertSelf(ctx: ApiContext, claimed: unknown, field: string): string {
  const userId = ctx.userId;
  if (!userId) throw new ApiError(401, 'Authentication required');
  if (claimed != null && claimed !== '' && String(claimed) !== userId) {
    throw new ApiError(403, `${field} does not match the authenticated user`);
  }
  return userId;
}

/**
 * Wrap an API route with the method check, rate limit, session auth and
 * error-to-status mapping every route otherwise repeats.
 */
export function apiHandler(
  options: ApiHandlerOptions,
  fn: (req: NextApiRequest, res: NextApiResponse, ctx: ApiContext) => unknown | Promise<unknown>
) {
  const methods = Array.isArray(options.methods) ? options.methods : [options.methods];

  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!methods.includes(req.method as Method)) {
      res.setHeader?.('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (options.rateLimit) {
      const { message: _message, shared, ...limit } = options.rateLimit;
      const key = `${req.method} ${routeKey(req)}:${clientIp(req)}`;
      const rl = shared ? await sharedRateLimit(key, limit) : rateLimit(key, limit);
      if (!rl.allowed) return res.status(429).json({ error: options.rateLimit.message || 'Too many requests. Please slow down.' });
    }

    const ctx: ApiContext = { userId: null };
    if (options.auth) {
      ctx.userId = await getAuthenticatedUserId(req);
      if (!ctx.userId) return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      return await fn(req, res, ctx);
    } catch (e: any) {
      if (e instanceof ApiError) return res.status(e.status).json({ error: e.message });
      const mapped = e?.code != null ? options.errorStatus?.[e.code] : undefined;
      if (mapped) return res.status(mapped).json({ error: e?.message || 'Request failed' });
      if (options.onError) return options.onError(res, e);
      // Unexpected: log the details here and keep them out of the response
      console.error(`${req.method} ${(req.url || '').split('?')[0]} failed:`, e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
