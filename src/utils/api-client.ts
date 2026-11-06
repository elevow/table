import { authHeaders } from './auth-headers';

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Appended to the path, URL-encoded; null/undefined values are dropped. */
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * The outcome of an API call. Failed responses resolve rather than throw, because
 * many callers still read the error body (e.g. `data.code`, `data.gameState`).
 * Network failures and aborts still reject, as with plain fetch.
 */
export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or {} when the body is empty or not JSON. */
  data: T;
  /** The server's `error` message on failure, else `HTTP <status>`. */
  error?: string;
}

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly data: any) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null) params.append(key, String(value));
  }
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

/**
 * Call one of this app's API routes with the signed-in user's session token.
 */
export async function apiRequest<T = any>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', query, body, headers, signal } = options;
  const init: RequestInit = {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(withQuery(path, query), init);
  const data = (await response.json().catch(() => ({}))) ?? {};
  if (response.ok) return { ok: true, status: response.status, data };
  const error = (data && typeof data.error === 'string' && data.error) || `HTTP ${response.status}`;
  return { ok: false, status: response.status, data, error };
}

export const api = {
  get: <T = any>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T = any>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
};

/** The response data, or throw an ApiRequestError for a failed response. */
export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ApiRequestError(result.status, result.error || `HTTP ${result.status}`, result.data);
  return result.data;
}
