'use strict';

const fs = require('fs');
const path = require('path');

// Load server/.env manually
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function checkTxStatuses() {
  console.log('Inspecting transaction statuses in production...');

  let page = 0;
  const pageSize = 1000;
  const statusCounts = new Map();
  let totalTx = 0;

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, status, total_amount')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      console.error('Error fetching transactions:', error);
      break;
    }
    if (!data || data.length === 0) break;
    totalTx += data.length;
    for (const t of data) {
      const st = t.status === null ? 'NULL' : String(t.status);
      statusCounts.set(st, (statusCounts.get(st) || 0) + 1);
    }
    page++;
    if (data.length < pageSize) break;
  }

  console.log('Total transactions in database:', totalTx);
  console.log('Transaction status breakdown:', Object.fromEntries(statusCounts));
}

checkTxStatuses().catch(err => console.error(err));
