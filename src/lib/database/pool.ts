import { Pool } from 'pg';
import { config } from 'dotenv';
import { join, isAbsolute } from 'path';
import { readFileSync } from 'fs';

// Load environment variables
try {
  // In development, also load from .env.local and allow overriding
  if (process.env.NODE_ENV !== 'production') {
    config({ path: join(process.cwd(), '.env.local'), override: true });
  }
  // Always load from default .env without overriding already-set envs
  config({ override: false });
} catch (e) {
  console.error('Failed to load environment variables:', e);
}

let pool: Pool | null = null;
type PoolDiagnostics = {
  mode: 'local' | 'supabase';
  preferDirect: boolean;
  forcePooled?: boolean;
  usedIntegration: { pooled: boolean; direct: boolean };
  selectedUrlHost?: string;
  selectedUrlPort?: number | null;
  urlHostType?: 'pooler' | 'direct' | 'other';
  sslRejectUnauthorized?: boolean;
  sslCaProvided?: boolean;
  customCaDisabled?: boolean;
};
let lastDiag: PoolDiagnostics | null = null;
let lastSelectedConnString: string | null = null;

function classifyUrlType(url: string): 'pooler' | 'direct' | 'other' {
  try {
    const u = new URL(url);
    if (/pooler\.supabase\.com$/i.test(u.hostname)) return 'pooler';
    if (/^db\..*\.supabase\.co$/i.test(u.hostname)) return 'direct';
    return 'other';
  } catch {
    return 'other';
  }
}

function resolveConnectionString(): { connectionString: string; mode: 'local' | 'supabase'; preferDirect: boolean; usedIntegration: { pooled: boolean; direct: boolean }, forcePooled: boolean } {
  const modeRaw = (process.env.DB_MODE || 'auto').toLowerCase();
  const mode: 'auto' | 'local' | 'supabase' = (['local', 'supabase'].includes(modeRaw) ? modeRaw : 'auto') as any;
  const preferDirect = process.env.DB_PREFER_DIRECT === '1' || process.env.DB_PREFER_DIRECT === 'true';
  const forcePooled = process.env.DB_FORCE_POOLED === '1' || process.env.DB_FORCE_POOLED === 'true';

  const localUrl = process.env.LOCAL_DATABASE_URL
    || (process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
      ? `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5432/${process.env.POSTGRES_DB}`
      : undefined);
  // Supabase/Vercel integration variables
  const vercelPooled = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || undefined;
  const vercelDirect = process.env.POSTGRES_URL_NON_POOLING || undefined;
  const useDirectOverride = process.env.DB_USE_DIRECT_URL_OVERRIDE === '1' || process.env.DB_USE_DIRECT_URL_OVERRIDE === 'true';
  // If override is enabled, prefer DIRECT_DATABASE_URL over Vercel integration var for "direct"
  const directOverride = useDirectOverride && process.env.DIRECT_DATABASE_URL ? process.env.DIRECT_DATABASE_URL : undefined;
  // Prefer integration vars over legacy ones if both exist
  const supabasePooled = vercelPooled || process.env.POOL_DATABASE_URL;
  let supabaseDirect = (directOverride || vercelDirect || process.env.DIRECT_DATABASE_URL);
  const requireDirectHost = process.env.DB_REQUIRE_DIRECT_HOST === '1' || process.env.DB_REQUIRE_DIRECT_HOST === 'true';
  if (supabaseDirect && (process.env.DB_PREFER_DIRECT === '1' || process.env.DB_PREFER_DIRECT === 'true') && requireDirectHost) {
    const t = classifyUrlType(supabaseDirect);
    if (t !== 'direct') {
      const alt = process.env.DIRECT_DATABASE_URL;
      if (alt && classifyUrlType(alt) === 'direct') {
        supabaseDirect = alt;
      }
    }
  }

  const isProd = process.env.NODE_ENV === 'production';

  if (mode === 'local') {
    if (localUrl) return { connectionString: localUrl, mode: 'local', preferDirect, usedIntegration: { pooled: false, direct: false }, forcePooled };
    // Fall back to direct if local not set
    if (supabasePooled || supabaseDirect) {
      if (!forcePooled && preferDirect && supabaseDirect) return { connectionString: supabaseDirect, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
      return { connectionString: supabasePooled || supabaseDirect!, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
    }
  } else if (mode === 'supabase') {
    if (supabasePooled || supabaseDirect) {
      if (!forcePooled && preferDirect && supabaseDirect) return { connectionString: supabaseDirect, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
      return { connectionString: supabasePooled || supabaseDirect!, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
    }
    if (localUrl) {
      return { connectionString: localUrl, mode: 'local', preferDirect, usedIntegration: { pooled: false, direct: false }, forcePooled };
    }
  } else {
    // auto
    if (!isProd && localUrl) {
      return { connectionString: localUrl, mode: 'local', preferDirect, usedIntegration: { pooled: false, direct: false }, forcePooled };
    }
    if (supabasePooled || supabaseDirect) {
      if (!forcePooled && preferDirect && supabaseDirect) return { connectionString: supabaseDirect, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
      return { connectionString: supabasePooled || supabaseDirect!, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
    }
    if (localUrl) {
      return { connectionString: localUrl, mode: 'local', preferDirect, usedIntegration: { pooled: false, direct: false }, forcePooled };
    }
  }

  // As a last resort, use whatever is set in POOL/DIRECT or throw
  const fallback = supabasePooled || supabaseDirect;
  if (fallback) return { connectionString: fallback, mode: 'supabase', preferDirect, usedIntegration: { pooled: !!supabasePooled, direct: !!supabaseDirect }, forcePooled };
  throw new Error('No database URL found. Set LOCAL_DATABASE_URL for local or POOL_DATABASE_URL/DIRECT_DATABASE_URL for Supabase.');
}

function buildPool(): Pool {
  const { connectionString: raw, mode, preferDirect, usedIntegration, forcePooled } = resolveConnectionString();
  const isProd = process.env.NODE_ENV === 'production';
  let connectionString = raw;

  // console.log('[db] NODE_ENV:', process.env.NODE_ENV || 'undefined');
  // console.log('[db] DB_MODE:', (process.env.DB_MODE || 'auto').toLowerCase(), '→', mode);
  // console.log('[db] Original connection string:', connectionString.replace(/:[^@]*@/, ':****@'));

  const forceSsl = process.env.DB_FORCE_SSL === 'true';

  // Remove any sslmode parameter; we'll control TLS via cfg.ssl explicitly
  connectionString = connectionString.replace(/([?&])sslmode=([^&]+)/gi, (m, sep) => sep === '?' ? '?' : '');
  // Clean up possible leftover ?& or trailing ?
  connectionString = connectionString.replace(/\?&/, '?').replace(/\?$/, '');

  // For local mode or any non-production env without DB_FORCE_SSL, disable SSL
  if (!isProd && !forceSsl) {
    connectionString = connectionString.replace(/[?&]?sslmode=(require|prefer|allow|disable)/g, '');
    connectionString += connectionString.includes('?') ? '&sslmode=disable' : '?sslmode=disable';
    // console.log('[db] Development mode: SSL disabled via connection string');
    // console.log('[db] Modified connection string:', connectionString.replace(/:[^@]*@/, ':****@'));
  }

  // Ensure search_path includes public, using connection options to avoid per-connection commands
  const encodedOpt = encodeURIComponent('-c search_path=public');
  if (!/([?&])options=/.test(connectionString)) {
    connectionString += connectionString.includes('?') ? `&options=${encodedOpt}` : `?options=${encodedOpt}`;
  }

  // console.log('[db] Final connection string being used:', connectionString.replace(/:[^@]*@/, ':****@'));

  const cfg: any = { connectionString };

  // Optional overrides for SSL behavior in production
  const allowSelfSigned = (process.env.ALLOW_SELF_SIGNED_DB === '1') || (process.env.DB_REJECT_UNAUTHORIZED === 'false');
  const disableCustomCa = (process.env.DB_DISABLE_CUSTOM_CA === '1') || (process.env.DB_USE_DEFAULT_CA === '1');
  // Prefer file over inline when both are provided to avoid malformed env content overriding good file
  const suppliedCaFile = (process.env.DB_SSL_CA_FILE || '').trim();
  let suppliedCa = '';
  if (suppliedCaFile) {
    try {
      const tryPaths = isAbsolute(suppliedCaFile)
        ? [suppliedCaFile]
        : [suppliedCaFile, join(process.cwd(), suppliedCaFile)];
      for (const p of tryPaths) {
        try {
          suppliedCa = readFileSync(p, 'utf8');
          break;
        } catch {}
      }
    } catch (e) {
      console.warn('[db] Failed to read DB_SSL_CA_FILE:', suppliedCaFile);
    }
  }
  // If file not provided or unreadable, fall back to inline env
  if (!suppliedCa) {
    suppliedCa = (process.env.DB_SSL_CA || '').trim();
  }

  if (!isProd && !forceSsl) {
    cfg.ssl = false;
    // console.log('[db] Development mode: SSL client configuration disabled');
  } else {
    const sslCfg: any = { rejectUnauthorized: !allowSelfSigned };
    if (suppliedCa && !disableCustomCa) {
      // Support multi-line CA provided via env with escaped newlines
      const normalized = suppliedCa.replace(/\\n/g, '\n');
      const hasGoodBegin = /-----BEGIN CERTIFICATE-----/.test(normalized);
      const hasGoodEnd = /-----END CERTIFICATE-----/.test(normalized);
      if (!(hasGoodBegin && hasGoodEnd)) {
        console.warn('[db] DB_SSL_CA appears to have malformed PEM header/footer (needs 5 dashes).');
      }
      sslCfg.ca = normalized;
    } else if (suppliedCa && disableCustomCa) {
      console.warn('[db] DB_DISABLE_CUSTOM_CA=1: Ignoring provided DB SSL CA and using Node default trust store.');
    }
    cfg.ssl = sslCfg;
    if (allowSelfSigned) {
      console.warn('[db] ALLOW_SELF_SIGNED_DB enabled: TLS certificate verification is relaxed. Avoid in long-term production.');
    }
  }

  // Capture diagnostics
  try {
    lastSelectedConnString = connectionString;
    const d: PoolDiagnostics = {
      mode,
      preferDirect,
      forcePooled,
      usedIntegration,
      sslRejectUnauthorized: (cfg.ssl && typeof cfg.ssl === 'object') ? !!(cfg.ssl as any).rejectUnauthorized : undefined,
      sslCaProvided: (cfg.ssl && typeof cfg.ssl === 'object') ? !!(cfg.ssl as any).ca : false,
      customCaDisabled: disableCustomCa,
    };
    try {
      const u = new URL(connectionString);
      d.selectedUrlHost = u.hostname;
      d.selectedUrlPort = u.port ? Number(u.port) : null;
      if (/pooler\.supabase\.com$/i.test(u.hostname)) d.urlHostType = 'pooler';
      else if (/^db\..*\.supabase\.co$/i.test(u.hostname)) d.urlHostType = 'direct';
      else d.urlHostType = 'other';
    } catch {}
    lastDiag = d;
  } catch {}

  return new Pool(cfg);
}

export function getPool(): Pool {
  // Force rebuild pool in development to pick up configuration changes
  if (process.env.NODE_ENV !== 'production') {
    pool = null;
  }
  if (!pool) pool = buildPool();
  return pool;
}

export function getPoolDiagnostics(): any {
  return lastDiag ? { ...lastDiag } : null;
}

export function __internal_getSelectedConnectionString(): string | null {
  return lastSelectedConnString;
}