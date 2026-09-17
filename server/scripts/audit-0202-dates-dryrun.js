'use strict';

const fs = require('fs');
const { createClient } = require('d:/Digital Market/Website RedBox/node_modules/@supabase/supabase-js');

// Load server/.env
const envPath = 'd:/Digital Market/Website RedBox/server/.env';
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

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(url, key);

async function runDryRun() {
  console.log('--- DRY RUN: MALFORMED 0202 DATE AUDIT & REPAIR ANALYSIS ---');
  
  // Fetch all 637 rows
  const { data: rows, error } = await supabase
    .from('moka_transactions')
    .select('receipt_number, outlet_slug, tx_date, imported_at, items_raw')
    .in('tx_date', ['0202-09-01', '0202-09-02', '0202-09-04', '0202-09-05']);

  if (error) {
    console.error('Error fetching moka_transactions:', error);
    return;
  }

  console.log(`Total affected rows in moka_transactions: ${rows.length}`);

  const countsByCurrentDate = {};
  for (const r of rows) {
    countsByCurrentDate[r.tx_date] = (countsByCurrentDate[r.tx_date] || 0) + 1;
  }
  console.log('Distribution by current tx_date:', countsByCurrentDate);

  // Group receipts to query transactions table in batches
  const receipts = rows.map(r => r.receipt_number);
  const batchSize = 100;
  const txMap = new Map();

  for (let i = 0; i < receipts.length; i += batchSize) {
    const batch = receipts.slice(i, i + batchSize);
    const { data: txBatch, error: batchErr } = await supabase
      .from('transactions')
      .select('external_id, created_at, moka_payload')
      .in('external_id', batch);

    if (batchErr) {
      console.error('Batch error:', batchErr);
    } else if (txBatch) {
      for (const t of txBatch) {
        txMap.set(t.external_id, t);
      }
    }
  }

  console.log(`Found ${txMap.size} matching receipts in transactions table.`);

  let authoritativeMatched = 0;
  let missingRawInTransactions = 0;
  let mismatchCount = 0;

  const repairPlan = [];

  for (const r of rows) {
    const tx = txMap.get(r.receipt_number);
    let authoritativeDate = null;
    let sourceMethod = null;

    if (tx) {
      const payload = tx.moka_payload;
      if (payload?.created_at) {
        // e.g. "2026-09-01T10:38:20.093000+07:00"
        authoritativeDate = payload.created_at.slice(0, 10);
        sourceMethod = 'moka_payload.created_at';
      } else if (tx.created_at) {
        // e.g. "2026-09-01T03:40:32.433716+00:00" -> in UTC+7 it is 2026-09-01
        const dt = new Date(tx.created_at);
        authoritativeDate = dt.toISOString().slice(0, 10); // approximate UTC
        sourceMethod = 'transactions.created_at';
      }
    }

    const expectedDate = '2026' + r.tx_date.slice(4);

    if (authoritativeDate) {
      authoritativeMatched++;
      if (authoritativeDate !== expectedDate) {
        mismatchCount++;
        console.warn(`MISMATCH: receipt ${r.receipt_number}: current=${r.tx_date}, authoritative=${authoritativeDate}, mechanical=${expectedDate}`);
      }
    } else {
      missingRawInTransactions++;
    }

    repairPlan.push({
      receipt_number: r.receipt_number,
      outlet_slug: r.outlet_slug,
      current_tx_date: r.tx_date,
      expected_tx_date: expectedDate,
      authoritative_date: authoritativeDate,
      source_method: sourceMethod,
    });
  }

  console.log('\n--- DRY RUN SUMMARY ---');
  console.log(`Total rows examined: ${repairPlan.length}`);
  console.log(`Rows with authoritative moka_payload timestamp in transactions: ${authoritativeMatched}`);
  console.log(`Rows without raw payload in transactions (sync only existed in moka_transactions): ${missingRawInTransactions}`);
  console.log(`Mismatches between authoritative and mechanical '2026' derivation: ${mismatchCount}`);
  
  // Show sample 5 entries
  console.log('\nSample 5 plan entries:');
  console.table(repairPlan.slice(0, 5));
}

runDryRun().catch(console.error);
