'use strict';
const fs = require('fs');
const path = require('path');
const { createClient } = require(path.join(__dirname, '../../node_modules/@supabase/supabase-js'));
const { normalizeTransactionPackage } = require('../services/mokaTransactionNormalizer');

const envPath = path.join(__dirname, '../.env');
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
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const supabase = createClient(url, key);

  const { data: mappingsData } = await supabase.from('moka_item_mappings').select('*');
  const mappingsMap = new Map();
  for (const m of mappingsData || []) {
    if (m.outlet_id && m.moka_item_id && m.moka_variant_id) {
      mappingsMap.set(`${m.outlet_id}:${m.moka_item_id}:${m.moka_variant_id}`, m);
    }
    if (m.moka_item_id && m.moka_variant_id) {
      mappingsMap.set(`${m.moka_item_id}:${m.moka_variant_id}`, m);
    }
  }

  const { data: barbers } = await supabase.from('barbers').select('id,name,branch').eq('is_active', true);
  const { data: outlets } = await supabase.from('outlets').select('id,slug,moka_outlet_id');
  const outletByMokaId = new Map(outlets.map(o => [String(o.moka_outlet_id), o]));

  console.log(`Loaded ${mappingsMap.size} mappings, ${barbers.length} barbers, ${outlets.length} outlets`);

  // Fetch transactions from 2026-08-10 to 2026-08-17
  const { data: txs, error } = await supabase
    .from('transactions')
    .select('id,created_at,moka_payload')
    .gte('created_at', '2026-08-10T00:00:00+07:00')
    .lte('created_at', '2026-08-17T23:59:59+07:00');

  if (error) {
    console.error('Error fetching transactions:', error);
    return;
  }

  console.log(`Total transactions fetched for 2026-08-10..17: ${txs.length}`);

  let receiptsWithFullItems = 0;
  let totalRecoverableItems = 0;
  let servicesResolved = 0;
  let stockProducts = 0;
  let nonStockMisc = 0;
  let reviewRequired = 0;
  let unmapped = 0;

  let barberAttributed = 0;
  let barberMissingOrAmbiguous = 0;
  let multiBarberReceipts = 0;
  let multiBarberResolvedPerItem = 0;
  let multiBarberStillAmbiguous = 0;

  const reviewItemsSummary = new Map();

  for (const tx of txs) {
    const payload = tx.moka_payload;
    if (!payload) continue;

    const checkouts = Array.isArray(payload.checkouts) ? payload.checkouts : [];
    if (checkouts.length > 0) receiptsWithFullItems++;

    const outlet = outletByMokaId.get(String(payload.outlet_id)) || { id: null, slug: 'unknown' };

    const norm = normalizeTransactionPackage(payload, {
      outletId: outlet.id,
      outletSlug: outlet.slug,
      mappingsMap,
      barbers,
    });

    if (!norm) {
      continue;
    }

    const items = norm.items || [];
    totalRecoverableItems += items.length;

    // Check barber attribution across items
    const distinctItemBarbers = new Set(items.map(i => i.barber_name_raw).filter(Boolean));
    const isMultiBarber = distinctItemBarbers.size > 1;
    if (isMultiBarber) {
      multiBarberReceipts++;
      const allHaveBarberId = items.filter(i => i.classification === 'NON_STOCK_SERVICE').every(i => i.barber_id);
      if (allHaveBarberId) multiBarberResolvedPerItem++;
      else multiBarberStillAmbiguous++;
    }

    for (const item of items) {
      if (item.classification === 'NON_STOCK_SERVICE') servicesResolved++;
      else if (item.classification === 'STOCK_PRODUCT') stockProducts++;
      else if (item.classification === 'NON_STOCK_MISC') nonStockMisc++;
      else if (item.classification === 'REVIEW_REQUIRED') {
        reviewRequired++;
        const k = `${item.item_name} / ${item.variant_name} (${item.classification_reason})`;
        reviewItemsSummary.set(k, (reviewItemsSummary.get(k) || 0) + 1);
      } else {
        unmapped++;
      }

      if (item.barber_id) barberAttributed++;
      else barberMissingOrAmbiguous++;
    }
  }

  console.log('\n--- HISTORICAL DRY RUN RESULTS (2026-08-10..17) ---');
  console.log(`Total receipts analyzed: ${txs.length}`);
  console.log(`Receipts with full item data (checkouts array): ${receiptsWithFullItems}`);
  console.log(`Recoverable line-item rows: ${totalRecoverableItems}`);
  console.log(`\nClassification Breakdown:`);
  console.log(`- NON_STOCK_SERVICE: ${servicesResolved}`);
  console.log(`- STOCK_PRODUCT: ${stockProducts}`);
  console.log(`- NON_STOCK_MISC: ${nonStockMisc}`);
  console.log(`- REVIEW_REQUIRED: ${reviewRequired}`);
  console.log(`- UNMAPPED: ${unmapped}`);
  console.log(`\nBarber Attribution Breakdown:`);
  console.log(`- Line items with deterministic barber_id: ${barberAttributed}`);
  console.log(`- Line items with NULL barber_id: ${barberMissingOrAmbiguous}`);
  console.log(`- Multi-barber receipts detected: ${multiBarberReceipts}`);
  console.log(`  * Fully resolvable per-item: ${multiBarberResolvedPerItem}`);
  console.log(`  * Ambiguous / review: ${multiBarberStillAmbiguous}`);

  console.log(`\nTop REVIEW_REQUIRED Items:`);
  for (const [k, count] of [...reviewItemsSummary.entries()].sort((a,b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${count}x ${k}`);
  }
}

main().catch(console.error);
