'use strict';

// Rebuild public.business_performance_daily for explicit dates from the canonical
// public.moka_transaction_items (Task 2.1C authority). No Moka API calls.
// Dry-run by default; pass --apply to write. Never touches moka_csv rows.
//   node scripts/rebuild-business-performance.js --from 2026-09-16 --to 2026-09-18 [--apply]

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  REDBOX_OUTLET_SLUGS, aggregateItems, readCanonicalItems, zeroOverwriteBlocker, sameMetrics, shiftDate,
} = require('../services/mokaDailyTransactionSync');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const trimmed = line.trim();
  const eq = trimmed.indexOf('=');
  if (!trimmed || trimmed.startsWith('#') || eq < 1) continue;
  const key = trimmed.slice(0, eq).trim();
  if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const from = arg('from');
  const to = arg('to') || from;
  const apply = process.argv.includes('--apply');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('--from/--to YYYY-MM-DD required');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const dates = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d);

  const report = [];
  for (const date of dates) {
    for (const slug of REDBOX_OUTLET_SLUGS) {
      const { items, error } = await readCanonicalItems(supabase, slug, date);
      if (error) throw error;
      const next = aggregateItems(items, date, slug);
      const { data: current, error: currentError } = await supabase.from('business_performance_daily')
        .select('*').eq('business_date', date).eq('branch_slug', slug).maybeSingle();
      if (currentError) throw currentError;
      let action = 'write';
      if (current?.source === 'moka_csv') action = 'skip_csv_protected';
      else if (zeroOverwriteBlocker(next, { canonicalReceipts: next.transaction_count, existing: current })) action = 'skip_zero_guard';
      else if (current && sameMetrics(current, next)) action = 'unchanged';
      if (apply && action === 'write') {
        const { error: upsertError } = await supabase.from('business_performance_daily')
          .upsert(next, { onConflict: 'business_date,branch_slug', ignoreDuplicates: false });
        if (upsertError) throw upsertError;
      }
      report.push({
        date, branch: slug, receipts: next.transaction_count, gross: next.gross_sales, discounts: next.discounts,
        refunds: next.refunds, net: next.net_sales, current_net: current ? Number(current.net_sales) : null,
        current_tx: current ? Number(current.transaction_count) : null, action: apply ? action : `dry:${action}`,
      });
    }
  }
  console.table(report);
  const sum = key => report.reduce((total, row) => total + row[key], 0);
  console.log(`TOTAL receipts=${sum('receipts')} gross=${sum('gross')} discounts=${sum('discounts')} net=${sum('net')} apply=${apply}`);
}

main().catch(error => { console.error(error); process.exit(1); });
