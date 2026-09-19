'use strict';

// Dry-run by default. --apply fills tx_date/outlet_slug (RECOVERABLE rows) and fill-only
// tx_time/collected_by/total_collected. Never writes items_raw.
//   node scripts/recover-moka-legacy-keys.js --from 2026-09-09 --to 2026-09-15 [--apply]

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { shiftDate } = require('../services/mokaDailyTransactionSync');
const { planRecovery, applyRecovery, applyExtras } = require('../services/mokaLegacyKeyRecovery');

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
  const businessDates = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) businessDates.push(d);

  let plan;
  for (let attempt = 1; ; attempt += 1) {
    try { plan = await planRecovery({ supabase, businessDates }); break; } catch (error) {
      if (attempt >= 3 || !/timeout/i.test(error.message)) throw error;
      console.warn(`fetch attempt ${attempt} failed (${error.message}); retrying`);
    }
  }
  const nullRows = plan.legacyRows.filter(r => r.tx_date == null || r.outlet_slug == null).length;
  console.log('API outlets:', JSON.stringify(plan.api.outlets));
  console.log(JSON.stringify({
    dates: businessDates, null_rows_before: nullRows, api_receipts_fetched: new Set(plan.api.rows.map(r => r.receipt_number)).size,
    recoverable: plan.recoverable.length, ambiguous: plan.ambiguous.length, not_found: plan.notFound.length,
    already_valid: plan.alreadyValid.length, conflicts_with_existing: plan.conflicts.length,
    extra_fills: { tx_time: plan.extras.filter(e => e.tx_time !== undefined).length, collected_by: plan.extras.filter(e => e.collected_by !== undefined).length, total_collected: plan.extras.filter(e => e.total_collected !== undefined).length },
  }, null, 2));
  const breakdown = {};
  for (const r of plan.recoverable) { const k = `${r.tx_date}|${r.outlet_slug}`; breakdown[k] = (breakdown[k] || 0) + 1; }
  console.table(Object.entries(breakdown).sort().map(([k, n]) => ({ date: k.split('|')[0], branch: k.split('|')[1], recoverable: n })));
  if (plan.conflicts.length) console.log('CONFLICTS', JSON.stringify(plan.conflicts.slice(0, 20)));
  if (plan.ambiguous.length) console.log('AMBIGUOUS', JSON.stringify(plan.ambiguous.slice(0, 20)));

  if (!apply) { console.log('DRY RUN - nothing written'); return; }
  const updated = await applyRecovery({ supabase, recoverable: plan.recoverable });
  console.log('UPDATED primary rows:', updated);
  console.log('UPDATED extras:', JSON.stringify(await applyExtras({ supabase, extras: plan.extras })));
}

main().catch(error => { console.error(error); process.exit(1); });
