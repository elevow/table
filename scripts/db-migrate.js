#!/usr/bin/env node
/*
  Simple migration runner for local Postgres (and compatible with Supabase URLs).
  Applies SQL files in order:
    1) Application schema files from src/lib/database/schema/ (with dependency ordering)
    2) migration-manual.sql (if present)
    3) scripts/*.sql (sorted)
*/

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
require('dotenv').config();

function maskConn(str) {
  try { return String(str).replace(/:[^@]*@/, ':****@'); } catch { return String(str || ''); }
}

function buildConnectionString() {
  const modeRaw = (process.env.DB_MODE || 'auto').toLowerCase();
  const mode = ['local', 'supabase'].includes(modeRaw) ? modeRaw : 'auto';
  const local = process.env.LOCAL_DATABASE_URL
    || (process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
      ? `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5432/${process.env.POSTGRES_DB}`
      : undefined);
  const supabase = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
  const isProd = process.env.NODE_ENV === 'production';

  let url;
  if (mode === 'local') url = local || supabase;
  else if (mode === 'supabase') url = supabase || local;
  else url = (!isProd && local) || supabase || local;
  if (!url) throw new Error('No database URL found. Set LOCAL_DATABASE_URL or POOL/DIRECT DATABASE_URL');

  // In dev, force sslmode=disable unless explicitly overridden
  const forceSsl = process.env.DB_FORCE_SSL === 'true';
  if (!isProd && !forceSsl) {
    url = url.replace(/[?&]?sslmode=(require|prefer|allow|disable)/g, '');
    url += url.includes('?') ? '&sslmode=disable' : '?sslmode=disable';
  }
  return url;
}

function collectSqlFiles() {
  const files = [];
  const addFrom = (dir) => {
    try {
      const abs = path.join(process.cwd(), dir);
      if (!fs.existsSync(abs)) return;
      fs.readdirSync(abs)
        .filter(f => f.toLowerCase().endsWith('.sql'))
        .sort()
        .forEach(f => files.push(path.join(abs, f)));
    } catch { /* ignore */ }
  };
  // Include application schema files with dependency-aware ordering
  try {
    const schemaDir = path.join(process.cwd(), 'src/lib/database/schema');
    if (fs.existsSync(schemaDir)) {
      const all = fs.readdirSync(schemaDir).filter(f => f.toLowerCase().endsWith('.sql'));
      const priority = [
        'user-management.sql', // defines users
        'full-schema.sql',     // broad schema including FKs to users
      ];
      const preferred = [];
      const rest = [];
      for (const name of all) {
        if (priority.includes(name)) preferred.push(name); else rest.push(name);
      }
      // Put avatar-management later so users/avatars exist from full-schema
      const restSorted = rest.sort((a, b) => a.localeCompare(b));
      const ordered = [...preferred, ...restSorted];
      ordered.forEach(fn => files.push(path.join(schemaDir, fn)));
    }
  } catch { /* ignore */ }
  const manual = path.join(process.cwd(), 'migration-manual.sql');
  if (fs.existsSync(manual)) files.push(manual);
  addFrom('scripts');
  return files;
}

async function run() {
  const connectionString = buildConnectionString();
  const isProd = process.env.NODE_ENV === 'production';
  const forceSsl = process.env.DB_FORCE_SSL === 'true';
  const pool = new Pool({ connectionString, ssl: (!isProd && !forceSsl) ? false : { rejectUnauthorized: true } });

  console.log(`[migrate] Connecting to ${maskConn(connectionString)}`);
  const client = await pool.connect();
  try {
    const files = collectSqlFiles();
    if (files.length === 0) {
      console.log('[migrate] No SQL files found in src/lib/database/schema/, migration-manual.sql, or scripts/*.sql');
      return;
    }
    console.log(`[migrate] Applying ${files.length} SQL file(s):`);
    files.forEach(f => console.log('  -', path.relative(process.cwd(), f)));

    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      const label = path.relative(process.cwd(), file);
      console.log(`[migrate] Running ${label} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`[migrate] OK ${label}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[migrate] FAILED ${label}:`, e.message);
        throw e;
      }
    }
    console.log('[migrate] All migrations applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error('[migrate] Error:', e?.message || e);
  process.exit(1);
});
