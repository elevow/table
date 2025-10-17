#!/usr/bin/env node
/*
  Seed a local user into public.users with a bcrypt password hash.
  Usage:
    node scripts/seed-user.js --email alice@example.com --username alice --password secret123 [--verified]
*/
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
require('dotenv').config();

function mask(str) { return String(str || '').replace(/:[^@]*@/, ':****@'); }

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { verified: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--email') out.email = args[++i];
    else if (a === '--username') out.username = args[++i];
    else if (a === '--password') out.password = args[++i];
    else if (a === '--verified') out.verified = true;
  }
  if (!out.email || !out.username || !out.password) {
    console.error('Missing required args. Example: --email a@b.com --username alice --password secret123 [--verified]');
    process.exit(1);
  }
  return out;
}

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
  // force search_path and disable ssl in dev
  const encodedOpt = encodeURIComponent('-c search_path=public');
  if (!/([?&])options=/.test(url)) url += (url.includes('?') ? '&' : '?') + `options=${encodedOpt}`;
  if (!isProd && !forceSsl) {
    url = url.replace(/[?&]?sslmode=(require|prefer|allow|disable)/g, '');
    url += url.includes('?') ? '&sslmode=disable' : '?sslmode=disable';
  }
  return url;
}

(async () => {
  const { email, username, password, verified } = parseArgs();
  const url = buildUrl();
  const isProd = process.env.NODE_ENV === 'production';
  const forceSsl = process.env.DB_FORCE_SSL === 'true';
  const pool = new Pool({ connectionString: url, ssl: (!isProd && !forceSsl) ? false : { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    console.log('[seed-user] Connecting', mask(url));
    const existing = await client.query('SELECT id, email FROM public.users WHERE email = $1', [email]);
    if (existing.rows.length) {
      console.log(`[seed-user] User already exists: ${email} (id=${existing.rows[0].id})`);
      process.exit(0);
    }
    const hash = await bcrypt.hash(password, 12);
    const res = await client.query(
      `INSERT INTO public.users (email, username, password_hash, is_verified)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, username, is_verified, created_at`,
      [email.toLowerCase(), username, hash, verified]
    );
    console.log('[seed-user] Created user:', res.rows[0]);
  } catch (e) {
    console.error('[seed-user] Error:', e.message || e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
