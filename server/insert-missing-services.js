#!/usr/bin/env node
'use strict';
/**
 * Insert missing RedBox services into Supabase `services` table.
 * Authoritative list dari user — 25 services total. Yang belum ada akan
 * di-insert; yang sudah ada (match by slug atau name) akan di-skip.
 *
 * Usage:  node server/insert-missing-services.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Authoritative service list from user (RedBox Barbershop).
// price=0 → harus diisi manual oleh admin nanti via CRM.
// moka_variant_name dipakai untuk lookup duration saat process Open Bill.
const SERVICES = [
  { name: 'Hair Cut',                      slug: 'hair-cut',                      duration_minutes: 45,  moka_variant_name: 'Hair Cut' },
  { name: 'Hair Fade Cut',                 slug: 'hair-fade-cut',                 duration_minutes: 60,  moka_variant_name: 'Hair Fade Cut' },
  { name: 'Hair Tattoo - Single Side',     slug: 'hair-tattoo-single-side',       duration_minutes: 15,  moka_variant_name: 'Hair Tattoo Single Side' },
  { name: 'Hair Tattoo - Double Side',     slug: 'hair-tattoo-double-side',       duration_minutes: 30,  moka_variant_name: 'Hair Tattoo Double Side' },
  { name: 'Hair Color',                    slug: 'hair-color',                    duration_minutes: 45,  moka_variant_name: 'Hair Colouring' },
  { name: 'Hair Bleaching',                slug: 'hair-bleaching',                duration_minutes: 180, moka_variant_name: 'Hair Bleaching' },
  { name: 'Hair Highlighting',             slug: 'hair-highlighting',             duration_minutes: 180, moka_variant_name: 'Hair Highlighting' },
  { name: 'Hair Curly',                    slug: 'hair-curly',                    duration_minutes: 90,  moka_variant_name: 'Hair Curly' },
  { name: 'Hair Smoothing',                slug: 'hair-smoothing',                duration_minutes: 90,  moka_variant_name: 'Hair Smoothing' },
  { name: 'Hair Spa',                      slug: 'hair-spa',                      duration_minutes: 30,  moka_variant_name: 'Hair Spa' },
  { name: 'Down Perm / Root Lift',         slug: 'down-perm-root-lift',           duration_minutes: 60,  moka_variant_name: 'Down Perm' },
  { name: 'Traditional Shaving',           slug: 'traditional-shaving',           duration_minutes: 30,  moka_variant_name: 'Traditional Shaving' },
  { name: 'Premium Head Shave',            slug: 'premium-head-shave',            duration_minutes: 45,  moka_variant_name: 'Premium Head Shave' },
  { name: 'Men Massage Service',           slug: 'men-massage-service',           duration_minutes: 45,  moka_variant_name: 'Men Massage' },
  { name: 'Nose Wax',                      slug: 'nose-wax',                      duration_minutes: 25,  moka_variant_name: 'Nose Wax' },
  { name: 'Ear Wax',                       slug: 'ear-wax',                       duration_minutes: 25,  moka_variant_name: 'Ear Wax' },
  { name: 'Ear Singeing',                  slug: 'ear-singeing',                  duration_minutes: 20,  moka_variant_name: 'Ear Singeing' },
  { name: 'Charcoal Deep Cleansing',       slug: 'charcoal-deep-cleansing',       duration_minutes: 45,  moka_variant_name: 'Charcoal Deep Cleansing' },
  { name: 'Ear Candle',                    slug: 'ear-candle',                    duration_minutes: 25,  moka_variant_name: 'Ear Candle' },
  { name: 'Charcoal Nose Cleansing Strip', slug: 'charcoal-nose-cleansing-strip', duration_minutes: 30,  moka_variant_name: 'Charcoal Nose Cleansing' },
  { name: 'Redbox Royal Grooming',         slug: 'redbox-royal-grooming',         duration_minutes: 90,  moka_variant_name: 'Redbox Royal Grooming' },
  { name: 'Redbox Duxe Grooming',          slug: 'redbox-duxe-grooming',          duration_minutes: 90,  moka_variant_name: 'Redbox Duxe Grooming' },
  { name: 'Redbox Earl Grooming',          slug: 'redbox-earl-grooming',          duration_minutes: 90,  moka_variant_name: 'Redbox Earl Grooming' },
  { name: 'Redbox Baron Grooming',         slug: 'redbox-baron-grooming',         duration_minutes: 90,  moka_variant_name: 'Redbox Baron Grooming' },
  { name: 'Redbox Noble Grooming',         slug: 'redbox-noble-grooming',         duration_minutes: 90,  moka_variant_name: 'Redbox Noble Grooming' },
];

(async () => {
  console.log(`📡  ${process.env.SUPABASE_URL}\n`);

  const { data: existing, error } = await sb
    .from('services')
    .select('id, name, slug, moka_variant_name, duration_minutes, is_active');
  if (error) { console.error('Read failed:', error.message); process.exit(1); }

  const bySlug = new Map(existing.map(r => [r.slug, r]));
  const byName = new Map(existing.map(r => [r.name.toLowerCase().trim(), r]));

  let inserted = 0, patched = 0, skipped = 0;

  for (const svc of SERVICES) {
    // Cek match by slug OR name (case-insensitive)
    const matchSlug = bySlug.get(svc.slug);
    const matchName = byName.get(svc.name.toLowerCase().trim());
    const found = matchSlug || matchName;

    if (found) {
      // Already exists — patch duration_minutes + moka_variant_name jika belum sesuai
      const patch = {};
      if (found.duration_minutes !== svc.duration_minutes) patch.duration_minutes = svc.duration_minutes;
      if (!found.moka_variant_name) patch.moka_variant_name = svc.moka_variant_name;
      if (Object.keys(patch).length > 0) {
        const { error: uErr } = await sb.from('services').update(patch).eq('id', found.id);
        if (uErr) console.warn(`  ⚠️   ${svc.name}: ${uErr.message}`);
        else { console.log(`  🔧  ${svc.name.padEnd(35)} patched: ${JSON.stringify(patch)}`); patched++; }
      } else {
        console.log(`  ⏭   ${svc.name.padEnd(35)} already up-to-date`);
        skipped++;
      }
      continue;
    }

    // Insert new
    const { error: iErr } = await sb.from('services').insert({
      name:              svc.name,
      slug:              svc.slug,
      duration_minutes:  svc.duration_minutes,
      price:             0,
      moka_variant_name: svc.moka_variant_name,
      is_active:         true,
    });
    if (iErr) {
      console.warn(`  ⚠️   ${svc.name}: ${iErr.message}`);
    } else {
      console.log(`  ✅  ${svc.name.padEnd(35)} inserted (${svc.duration_minutes}m, variant=${svc.moka_variant_name})`);
      inserted++;
    }
  }

  console.log(`\n── Done ─────────────────────────────────`);
  console.log(`  ✅  ${inserted} inserted    🔧  ${patched} patched    ⏭   ${skipped} unchanged`);

  // Final state
  const { data: final } = await sb
    .from('services')
    .select('name, moka_variant_name, duration_minutes, price, is_active')
    .eq('is_active', true)
    .order('duration_minutes', { ascending: false });

  console.log(`\n📋  Active services (${final.length}):`);
  for (const r of final) {
    console.log(`  ${String(r.duration_minutes).padStart(4)}m  Rp${String(r.price).padStart(8)}   ${r.name}${r.moka_variant_name ? `  [${r.moka_variant_name}]` : ''}`);
  }
  console.log(`\n💰  Catatan: price masih Rp0 untuk service baru — set via CRM/admin panel.`);
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
