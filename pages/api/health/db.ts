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
    sslConfigured?: boolean;
    allowSelfSigned?: boolean;
    hasCa?: boolean;
    selectedUrlPresent?: boolean;
    insecureOk?: boolean;
    insecureError?: string;
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  const diagnostics = {
    nodeEnv: process.env.NODE_ENV,
    dbMode: process.env.DB_MODE,
    poolUrlPresent: !!process.env.POOL_DATABASE_URL,
    directUrlPresent: !!process.env.DIRECT_DATABASE_URL,
    sslConfigured: process.env.NODE_ENV === 'production' ? true : false,
    allowSelfSigned: process.env.ALLOW_SELF_SIGNED_DB === '1' || process.env.DB_REJECT_UNAUTHORIZED === 'false',
    hasCa: !!(process.env.DB_SSL_CA || process.env.DB_SSL_CA_FILE),
  };

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
      try {
        // Append options for search_path=public like main pool does
        const encodedOpt = encodeURIComponent('-c search_path=public');
        if (!/([?&])options=/.test(selectedUrl)) {
          selectedUrl += selectedUrl.includes('?') ? `&options=${encodedOpt}` : `?options=${encodedOpt}`;
        }
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
