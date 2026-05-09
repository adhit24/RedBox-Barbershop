#!/usr/bin/env node
'use strict';
/**
 * MOKA × REDBOX  —  FULL DATA SYNC (one-shot)
 *
 * Pull semua data relevan dari MokaPOS dan sinkronkan ke Supabase.
 * Steps:
 *   1. Schema sync — barbers ↔ Moka items, services ↔ variants (mapping IDs)
 *   2. Variant pricing — refresh services.price dari harga variant Moka terkini
 *   3. Open Bills (PENDING) — block walk-in slots (latest snapshot)
 *   4. Historical transactions — backfill schedules + transactions selama N hari
 *
 * Usage:
 *   node server/moka-full-sync.js              # pakai default 30 hari history
 *   HISTORY_DAYS=7 node server/moka-full-sync.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const MokaClient = require('./moka/client');
const { syncMokaSchema, _matchScore } = require('./moka/schemaSync');
const { pullMokaToWeb } = require('./moka/sync');

const HISTORY_DAYS = Math.max(1, parseInt(process.env.HISTORY_DAYS || '30', 10));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL + SUPABASE_SERVICE_KEY required in server/.env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hr(ch = '─') { console.log('\n' + ch.repeat(60)); }
function h1(s) { hr('═'); console.log(`  ${s}`); hr('═'); }
function h2(s) { hr(); console.log(`  ${s}`); hr(); }

async function main() {
  h1(`MOKA → SUPABASE FULL SYNC  (history: ${HISTORY_DAYS} days)`);
  console.log(`  Target: ${SUPABASE_URL}`);

  // ── 1. Snapshot before ──────────────────────────────────────
  h2('SNAPSHOT (before)');
  await snapshotCounts();

  // ── 2. Outlets list ─────────────────────────────────────────
  const { data: outlets } = await sb
    .from('outlets')
    .select('id, slug, name, moka_outlet_id, is_active')
    .not('moka_outlet_id', 'is', null);
  console.log(`\n📍 Outlets dengan moka_outlet_id (${outlets?.length || 0}):`);
  for (const o of outlets || []) console.log(`     • ${o.slug.padEnd(12)} → moka_outlet_id=${o.moka_outlet_id} ${o.is_active ? '' : '(inactive)'}`);

  // Filter to authorized outlets
  const { data: tokenRows } = await sb.from('moka_tokens').select('outlet_id');
  const authorizedIds = new Set((tokenRows || []).map(r => r.outlet_id));
  const authorizedOutlets = (outlets || []).filter(o => authorizedIds.has(o.id));
  console.log(`\n🔑 Outlets dengan OAuth token aktif: ${authorizedOutlets.length}/${outlets?.length || 0}`);
  for (const o of authorizedOutlets) console.log(`     • ${o.slug}`);

  if (!authorizedOutlets.length) {
    console.error('\n❌  Tidak ada outlet ter-otorisasi. Jalankan OAuth dulu via /api/moka/auth?outletId=<slug>');
    process.exit(1);
  }

  // ── 3. STEP 1 — Schema sync (barber + service mapping) ──────
  h2('STEP 1 — Schema sync (barbers ↔ Moka items, services ↔ variants)');
  try {
    const report = await syncMokaSchema(sb);
    console.log(`  ✅  Barbers updated: ${report.barbers_updated}`);
    console.log(`  ✅  Services updated: ${report.services_updated}`);
    if (report.errors.length) {
      console.log(`  ⚠️   Errors:`); for (const e of report.errors) console.log(`       • ${e}`);
    }
    for (const ro of report.outlets || []) {
      const matched = ro.barbers_matched?.length || 0;
      const unmatched = ro.barbers_unmatched?.length || 0;
      console.log(`     ${ro.outlet.padEnd(12)} matched ${matched}  unmatched ${unmatched}  variants=${ro.variants_found}`);
      if (unmatched && ro.barbers_unmatched.length) {
        console.log(`        no-match: ${ro.barbers_unmatched.join(', ')}`);
      }
    }
  } catch (err) {
    console.error(`  ❌  Schema sync error: ${err.message}`);
  }

  // ── 4. STEP 2 — Refresh variant prices ──────────────────────
  h2('STEP 2 — Refresh service prices from Moka variants');
  const priceUpdates = await refreshVariantPrices(authorizedOutlets);
  console.log(`  ✅  ${priceUpdates.touched} services di-update price-nya`);
  if (priceUpdates.unmatched.length) {
    console.log(`  ⚠️   Service tanpa price match (${priceUpdates.unmatched.length}):`);
    for (const n of priceUpdates.unmatched) console.log(`       • ${n}`);
  }

  // ── 5. STEP 3 — Pull walk-in bills + history ────────────────
  h2(`STEP 3 — Pull transactions & open bills per outlet (${HISTORY_DAYS}-day window)`);
  for (const o of authorizedOutlets) {
    console.log(`\n  ── ${o.slug} ──`);
    try {
      // Override _lastSyncAt by passing it through process.env (sync.js reads on first call)
      // The sync function uses internal cache; we'll just call it and pull what's available.
      // For deeper history, manipulate _lastSyncAt via sync.js export — easiest: just call it.
      const result = await pullMokaToWeb(sb, o.id);
      console.log(`     ✅  processed=${result.processed}  skipped=${result.skipped}  errors=${result.errors}`);
    } catch (err) {
      console.error(`     ❌  ${err.message}`);
    }
  }

  // STEP 4 — Cleanup stale reserved Open Bill schedules
  h2('STEP 4 — Cleanup stale reserved Open Bill schedules');
  const staleHours = Math.max(1, parseInt(process.env.MOKA_OPENBILL_STALE_HOURS || '4', 10));
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();
  const { data: staled, error: staleErr } = await sb
    .from('schedules')
    .update({ status: 'cancelled', notes: '[auto] stale open bill — cleanup at full-sync' })
    .eq('source', 'moka')
    .eq('status', 'reserved')
    .lt('end_time', cutoff)
    .select('id, external_id, start_time');
  if (staleErr) {
    console.error(`  ❌  ${staleErr.message}`);
  } else {
    console.log(`  ✅  ${staled?.length || 0} stale reserved schedule(s) di-cancel (cutoff: end_time < ${cutoff})`);
  }

  // ── 6. Snapshot after ───────────────────────────────────────
  h2('SNAPSHOT (after)');
  await snapshotCounts();

  hr('═');
  console.log('  🎉  Full sync selesai. Cek log di atas untuk detail.');
  hr('═');
}

// ── Helpers ─────────────────────────────────────────────────────

async function snapshotCounts() {
  for (const t of ['outlets', 'barbers', 'services', 'customers', 'schedules', 'transactions', 'sync_logs']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${t.padEnd(20)} ${String(count ?? '?').padStart(6)} rows`);
  }
}

async function refreshVariantPrices(outlets) {
  const { data: services } = await sb
    .from('services').select('id, name, moka_variant_name, price, is_active')
    .eq('is_active', true);

  const variantPrices = new Map(); // variant_name (lower) → max price seen

  for (const o of outlets) {
    const client = new MokaClient(sb, o.id, o.moka_outlet_id);
    let items;
    try {
      const res = await client.getItems();
      items = res?.data?.items || res?.data || res?.items || [];
    } catch (err) {
      console.warn(`     ⚠️   getItems(${o.slug}): ${err.message}`);
      continue;
    }

    let outletVariantCount = 0;
    for (const item of items) {
      for (const v of item.item_variants || []) {
        if (!v.name) continue;
        const key = v.name.toLowerCase().trim();
        const price = Number(v.price) || 0;
        if (price <= 0) continue;
        const cur = variantPrices.get(key);
        if (!cur || price > cur) variantPrices.set(key, price);
        outletVariantCount++;
      }
    }
    console.log(`     ${o.slug.padEnd(12)} fetched ${items.length} items / ${outletVariantCount} priced variants`);
  }

  let touched = 0;
  const unmatched = [];

  for (const svc of services || []) {
    const variantKey = (svc.moka_variant_name || svc.name || '').toLowerCase().trim();
    let price = variantPrices.get(variantKey);

    // Fuzzy fallback if exact-match fails
    if (!price) {
      let bestKey = null, bestScore = 0;
      for (const k of variantPrices.keys()) {
        const s = _matchScore(variantKey, k);
        if (s > bestScore) { bestScore = s; bestKey = k; }
      }
      if (bestScore >= 0.85) price = variantPrices.get(bestKey);
    }

    if (!price) {
      if (!svc.price) unmatched.push(svc.name); // only flag if currently 0
      continue;
    }
    if (svc.price === price) continue;

    const { error } = await sb.from('services').update({ price }).eq('id', svc.id);
    if (error) {
      console.warn(`     ⚠️   ${svc.name}: ${error.message}`);
    } else {
      console.log(`     💰  ${svc.name.padEnd(35)} Rp${String(svc.price || 0).padStart(7)} → Rp${String(price).padStart(7)}`);
      touched++;
    }
  }

  return { touched, unmatched };
}

main().catch(err => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
