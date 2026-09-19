'use strict';

// Dry-run by default. --apply writes ONLY tx_date/outlet_slug on uniquely RECOVERABLE rows.
//   node scripts/recover-moka-legacy-keys.js --from 2026-09-09 --to 2026-09-15 [--apply]

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { shiftDate } = require('../services/mokaDailyTransactionSync');
const { planRecovery, applyRecovery } = require('../services/mokaLegacyKeyRecovery');

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

  const plan = await planRecovery({ supabase, businessDates });
  const nullRows = plan.legacyRows.filter(r => r.tx_date == null || r.outlet_slug == null).length;
  console.log('API outlets:', JSON.stringify(plan.api.outlets));
  console.log(JSON.stringify({
    dates: businessDates, null_rows_before: nullRows, api_receipts_fetched: new Set(plan.api.rows.map(r => r.receipt_number)).size,
    recoverable: plan.recoverable.length, ambiguous: plan.ambiguous.length, not_found: plan.notFound.length,
    already_valid: plan.alreadyValid.length, conflicts_with_existing: plan.conflicts.length,
  }, null, 2));
  const breakdown = {};
  for (const r of plan.recoverable) { const k = `${r.tx_date}|${r.outlet_slug}`; breakdown[k] = (breakdown[k] || 0) + 1; }
  console.table(Object.entries(breakdown).sort().map(([k, n]) => ({ date: k.split('|')[0], branch: k.split('|')[1], recoverable: n })));
  if (plan.conflicts.length) console.log('CONFLICTS', JSON.stringify(plan.conflicts.slice(0, 20)));
  if (plan.ambiguous.length) console.log('AMBIGUOUS', JSON.stringify(plan.ambiguous.slice(0, 20)));

  if (!apply) { console.log('DRY RUN - nothing written'); return; }
  const updated = await applyRecovery({ supabase, recoverable: plan.recoverable });
  console.log('UPDATED rows:', updated);
}

main().catch(error => { console.error(error); process.exit(1); });
