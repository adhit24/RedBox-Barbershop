#!/usr/bin/env node
'use strict';
/**
 * REDBOX × MOKA — One-command schema migration runner
 * Usage:  node server/run-migration.js
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from server/.env
 * then applies moka_integration_schema.sql via Supabase REST API.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in server/.env');
  process.exit(1);
}

const SQL_FILE = path.join(__dirname, 'moka_integration_schema.sql');
const fullSql  = fs.readFileSync(SQL_FILE, 'utf8');

// Split into individual statements so we can report per-statement status.
// Uses a simple splitter on semicolons that are NOT inside $$ blocks.
function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) { buf += line + '\n'; continue; }
    if (trimmed.includes('$$')) inDollar = !inDollar;
    buf += line + '\n';
    if (!inDollar && buf.trim().endsWith(';')) {
      const stmt = buf.trim();
      if (stmt && stmt !== ';') stmts.push(stmt);
      buf = '';
    }
  }
  if (buf.trim()) stmts.push(buf.trim());
  return stmts.filter(s => s.replace(/--.*$/gm, '').trim().length > 0);
}

async function runSql(sql) {
  // Supabase exposes a /rest/v1/rpc/exec_sql but only if the function exists.
  // We use the pg_meta SQL endpoint available on all Supabase projects.
  const url = `${SUPABASE_URL}/rest/v1/rpc/pg_execute`;

  // Try method 1: pg_execute RPC (works if function is pre-created)
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (res.status === 404) {
    // pg_execute doesn't exist — fall back to the SQL editor endpoint
    const sqlUrl = `${SUPABASE_URL.replace('.supabase.co', '.supabase.co')}/rest/v1/sql`;
    res = await fetch(sqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });
  }

  const text = await res.text().catch(() => '');
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log('🔄  Redbox × Moka — Schema Migration\n');
  console.log(`📡  Supabase: ${SUPABASE_URL}`);
  console.log(`📄  SQL file: ${SQL_FILE}\n`);

  // Try a quick connectivity check
  const checkRes = await runSql('SELECT 1 AS ok');
  if (!checkRes.ok) {
    console.error('❌  Cannot reach Supabase SQL endpoint.');
    console.error('    Status:', checkRes.status);
    console.error('    Detail:', JSON.stringify(checkRes.data));
    console.error('\n📋  MANUAL FALLBACK:');
    console.error('    1. Go to https://supabase.com → your project → SQL Editor');
    console.error(`    2. Paste contents of: ${SQL_FILE}`);
    console.error('    3. Click Run\n');
    process.exit(1);
  }

  console.log('✅  Connection OK. Applying statements…\n');

  const stmts = splitStatements(fullSql);
  let ok = 0, skipped = 0, failed = 0;

  for (const stmt of stmts) {
    // Extract a short label from the first non-comment line
    const label = stmt.split('\n')
      .find(l => l.trim() && !l.trim().startsWith('--'))
      ?.slice(0, 70) || '?';

    const result = await runSql(stmt);
    if (result.ok) {
      console.log(`  ✅  ${label}`);
      ok++;
    } else if (result.data?.code === '42P07' || result.data?.code === '42710') {
      // already exists — idempotent
      console.log(`  ⏭   ${label}  (already exists)`);
      skipped++;
    } else {
      console.warn(`  ⚠️   ${label}`);
      console.warn(`       → ${result.data?.message || JSON.stringify(result.data)}`);
      failed++;
    }
  }

  console.log(`\n── Done ─────────────────────────────────`);
  console.log(`  ✅ ${ok} applied    ⏭  ${skipped} skipped    ⚠️  ${failed} warnings`);

  if (failed > 0) {
    console.log('\n📋  For failed statements, paste moka_integration_schema.sql');
    console.log('    into Supabase SQL Editor and run manually.');
  } else {
    console.log('\n🎉  Migration complete! Next step:');
    console.log('    Fill in MOKA_CLIENT_ID, MOKA_CLIENT_SECRET, MOKA_OUTLET_ID in server/.env');
    console.log('    Then visit: GET /api/moka/auth?outletId=bypass\n');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
