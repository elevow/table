import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from './rate-limit';
import { getAuthenticatedUserId } from '../auth/auth-utils';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiHandlerOptions {
  /** Allowed HTTP method(s); anything else gets 405. */
  methods: Method | Method[];
  /** Per-client limit for this route; over it gets 429. */
  rateLimit?: { windowMs: number; max: number };
  /** Require a signed-in session; without one the route gets 401. */
  auth?: boolean;
  /** Map a thrown error's `code` (e.g. FriendError codes) to an HTTP status. */
  errorStatus?: Record<string, number>;
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
      const path = (req.url || '').split('?')[0];
      const rl = rateLimit(`${req.method} ${path}:${clientIp(req)}`, options.rateLimit);
      if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
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
      return res.status(mapped ?? 500).json({ error: e?.message || 'Internal error' });
    }
  };
}
