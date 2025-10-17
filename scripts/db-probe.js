#!/usr/bin/env node
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
require('dotenv').config();

function mask(str) { return String(str || '').replace(/:[^@]*@/, ':****@'); }

function buildUrl() {
  const isProd = process.env.NODE_ENV === 'production';
  const forceSsl = process.env.DB_FORCE_SSL === 'true';
  const local = process.env.LOCAL_DATABASE_URL
    || (process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
      ? `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5432/${process.env.POSTGRES_DB}`
      : undefined);
  const supabase = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
  let url = (process.env.DB_MODE === 'supabase') ? (supabase || local) : (local || supabase);
  if (!url) throw new Error('No DB URL');
  if (!isProd && !forceSsl) {
    url = url.replace(/[?&]?sslmode=(require|prefer|allow|disable)/g, '');
    url += url.includes('?') ? '&sslmode=disable' : '?sslmode=disable';
  }
  return url;
}

(async () => {
  const url = buildUrl();
  const isProd = process.env.NODE_ENV === 'production';
  const forceSsl = process.env.DB_FORCE_SSL === 'true';
  const pool = new Pool({ connectionString: url, ssl: (!isProd && !forceSsl) ? false : { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    const sp = await client.query("SELECT current_database() as db, current_user as usr, current_setting('search_path') as search_path");
    console.log('[probe] Using', mask(url));
    console.log('[probe] Session', sp.rows[0]);
    const t = await client.query("select table_schema, table_name from information_schema.tables where table_schema='public' and table_name in ('users','auth_tokens') order by table_name");
    console.log('[probe] Tables', t.rows);
    const u = await client.query('select * from public.users limit 1').catch(e => ({ error: e.message, code: e.code }));
    console.log('[probe] Sample query', u.rows ? 'OK' : u);
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error('[probe] Error', e.message || e); process.exit(1); });
