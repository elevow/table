import { Pool } from 'pg';
import { config } from 'dotenv';
import { join } from 'path';
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

function resolveConnectionString(): { connectionString: string; mode: 'local' | 'supabase' } {
  const modeRaw = (process.env.DB_MODE || 'auto').toLowerCase();
  const mode: 'auto' | 'local' | 'supabase' = (['local', 'supabase'].includes(modeRaw) ? modeRaw : 'auto') as any;

  const localUrl = process.env.LOCAL_DATABASE_URL
    || (process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
      ? `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5432/${process.env.POSTGRES_DB}`
      : undefined);
  const supabasePooled = process.env.POOL_DATABASE_URL;
  const supabaseDirect = process.env.DIRECT_DATABASE_URL;

  const isProd = process.env.NODE_ENV === 'production';

  if (mode === 'local') {
    if (localUrl) return { connectionString: localUrl, mode: 'local' };
    // Fall back to direct if local not set
    if (supabasePooled || supabaseDirect) {
      return { connectionString: supabasePooled || supabaseDirect!, mode: 'supabase' };
    }
  } else if (mode === 'supabase') {
    if (supabasePooled || supabaseDirect) {
      return { connectionString: supabasePooled || supabaseDirect!, mode: 'supabase' };
    }
    if (localUrl) {
      return { connectionString: localUrl, mode: 'local' };
    }
  } else {
    // auto
    if (!isProd && localUrl) {
      return { connectionString: localUrl, mode: 'local' };
    }
    if (supabasePooled || supabaseDirect) {
      return { connectionString: supabasePooled || supabaseDirect!, mode: 'supabase' };
    }
    if (localUrl) {
      return { connectionString: localUrl, mode: 'local' };
    }
  }

  // As a last resort, use whatever is set in POOL/DIRECT or throw
  const fallback = supabasePooled || supabaseDirect;
  if (fallback) return { connectionString: fallback, mode: 'supabase' };
  throw new Error('No database URL found. Set LOCAL_DATABASE_URL for local or POOL_DATABASE_URL/DIRECT_DATABASE_URL for Supabase.');
}

function buildPool(): Pool {
  const { connectionString: raw, mode } = resolveConnectionString();
  const isProd = process.env.NODE_ENV === 'production';
  let connectionString = raw;

  // console.log('[db] NODE_ENV:', process.env.NODE_ENV || 'undefined');
  // console.log('[db] DB_MODE:', (process.env.DB_MODE || 'auto').toLowerCase(), '→', mode);
  // console.log('[db] Original connection string:', connectionString.replace(/:[^@]*@/, ':****@'));

  const forceSsl = process.env.DB_FORCE_SSL === 'true';

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
  let suppliedCa = (process.env.DB_SSL_CA || '').trim();
  const suppliedCaFile = (process.env.DB_SSL_CA_FILE || '').trim();
  if (!suppliedCa && suppliedCaFile) {
    try {
      suppliedCa = readFileSync(suppliedCaFile, 'utf8');
    } catch (e) {
      console.warn('[db] Failed to read DB_SSL_CA_FILE:', suppliedCaFile);
    }
  }

  if (!isProd && !forceSsl) {
    cfg.ssl = false;
    // console.log('[db] Development mode: SSL client configuration disabled');
  } else {
    const sslCfg: any = { rejectUnauthorized: !allowSelfSigned };
    if (suppliedCa) {
      // Support multi-line CA provided via env with escaped newlines
      sslCfg.ca = suppliedCa.replace(/\\n/g, '\n');
    }
    cfg.ssl = sslCfg;
    if (allowSelfSigned) {
      console.warn('[db] ALLOW_SELF_SIGNED_DB enabled: TLS certificate verification is relaxed. Avoid in long-term production.');
    }
  }

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