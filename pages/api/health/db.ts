import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { Pool as PgPool } from 'pg';

type Resp = {
  ok: boolean;
  result?: any;
  error?: string;
  diagnostics?: {
    nodeEnv?: string;
    dbMode?: string | undefined;
    poolUrlPresent: boolean;
    directUrlPresent: boolean;
    vercelPooledPresent?: boolean;
    vercelDirectPresent?: boolean;
    sslConfigured?: boolean;
    allowSelfSigned?: boolean;
    hasCa?: boolean;
    selectedUrlPresent?: boolean;
    insecureOk?: boolean;
    insecureError?: string;
    caHeaderValid?: boolean;
    caBlockCount?: number;
    selectedHost?: string;
    selectedPort?: number | null;
    urlHostType?: 'pooler' | 'direct' | 'other';
    sslmodeParam?: string;
    nodeVersion?: string;
    opensslVersion?: string;
    nodeExtraCACerts?: string | undefined;
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  const diagnostics: any = {
    nodeEnv: process.env.NODE_ENV,
    dbMode: process.env.DB_MODE,
    poolUrlPresent: !!process.env.POOL_DATABASE_URL,
    directUrlPresent: !!process.env.DIRECT_DATABASE_URL,
    vercelPooledPresent: !!(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL),
    vercelDirectPresent: !!process.env.POSTGRES_URL_NON_POOLING,
    sslConfigured: process.env.NODE_ENV === 'production' ? true : false,
    allowSelfSigned: process.env.ALLOW_SELF_SIGNED_DB === '1' || process.env.DB_REJECT_UNAUTHORIZED === 'false',
    hasCa: !!(process.env.DB_SSL_CA || process.env.DB_SSL_CA_FILE),
    nodeVersion: process.version,
    opensslVersion: (process as any).versions?.openssl,
    nodeExtraCACerts: process.env.NODE_EXTRA_CA_CERTS,
  };

  // Clarify effective behavior of CA based on disable flag
  try {
    const customCaDisabled = (process.env.DB_DISABLE_CUSTOM_CA === '1') || (process.env.DB_USE_DEFAULT_CA === '1');
    diagnostics.customCaDisabled = customCaDisabled;
    diagnostics.effectiveHasCa = diagnostics.hasCa && !customCaDisabled;
  } catch {}

  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      // Execute a trivial query and also fetch server version for visibility
      const ping = await client.query('SELECT 1 AS one');
      const version = await client.query('SHOW server_version');
      return res.status(200).json({
        ok: true,
        result: {
          one: ping.rows?.[0]?.one ?? null,
          serverVersion: version.rows?.[0]?.server_version ?? null,
        },
        diagnostics,
      });
    } finally {
      client.release();
    }
  } catch (e: any) {
    const primaryError = e?.message || 'unknown error';

    // Attempt an insecure diagnostic connection to help pinpoint CA issues (does not affect app config)
    let insecureOk = false;
    let insecureError: string | undefined;
    let selectedUrl = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    if (selectedUrl) {

    // Additional diagnostics for CA formatting and URL details
    try {
      const caRaw = (process.env.DB_SSL_CA || '').trim();
      if (caRaw) {
        const caNormalized = caRaw.replace(/\\n/g, '\n');
        const good = (caNormalized.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
        const bad = (caNormalized.match(/----BEGIN CERTIFICATE----/g) || []).length;
        diagnostics.caHeaderValid = good > 0 && bad === 0;
        diagnostics.caBlockCount = good;
      }
    } catch {}

    try {
      if (selectedUrl) {
        const sslmodeMatch = selectedUrl.match(/(?:[?&])sslmode=([^&]+)/i);
        diagnostics.sslmodeParam = sslmodeMatch ? decodeURIComponent(sslmodeMatch[1]) : undefined;
        try {
          const u = new URL(selectedUrl);
          diagnostics.selectedHost = u.hostname;
          diagnostics.selectedPort = u.port ? Number(u.port) : null;
          if (/pooler\.supabase\.com$/i.test(u.hostname)) diagnostics.urlHostType = 'pooler';
          else if (/^db\..*\.supabase\.co$/i.test(u.hostname)) diagnostics.urlHostType = 'direct';
          else diagnostics.urlHostType = 'other';
        } catch {}
      }
    } catch {}
      try {
        // Append options for search_path=public like main pool does and strip sslmode
        const encodedOpt = encodeURIComponent('-c search_path=public');
        if (!/([?&])options=/.test(selectedUrl)) {
          selectedUrl += selectedUrl.includes('?') ? `&options=${encodedOpt}` : `?options=${encodedOpt}`;
        }
        selectedUrl = selectedUrl.replace(/([?&])sslmode=([^&]+)/gi, (m, sep) => sep === '?' ? '?' : '');
        selectedUrl = selectedUrl.replace(/\?&/, '?').replace(/\?$/, '');
        const tmp = new PgPool({ connectionString: selectedUrl, ssl: { rejectUnauthorized: false } });
        const c = await tmp.connect();
        try {
          await c.query('SELECT 1');
          insecureOk = true;
        } finally {
          c.release();
          await tmp.end();
        }
      } catch (ie: any) {
        insecureError = ie?.message || String(ie);
      }
    }

    return res.status(500).json({
      ok: false,
      error: primaryError,
      diagnostics: { ...diagnostics, selectedUrlPresent: !!selectedUrl, insecureOk, insecureError },
    });
  }
}
