#!/usr/bin/env node
'use strict';
/**
 * Apply service durations to the live RedBox services table.
 * Equivalent of running supabase_service_durations.sql but via supabase-js
 * (since Supabase REST doesn't expose raw SQL without a custom RPC).
 *
 * Usage:  node server/apply-service-durations.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL + SUPABASE_SERVICE_KEY required in server/.env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Authoritative durasi resmi dari list user (RedBox Barbershop).
// Setiap entry: minutes + array of name patterns (ILIKE) yang akan di-match
// terhadap services.name DAN services.moka_variant_name.
const DURATIONS = [
  { min: 45,  names: ['Hair Cut', 'Haircut'] },
  { min: 60,  names: ['Hair Fade Cut', 'Hair Cut with Fade', 'Haircut + Fade', 'Haircut + Shave'] },
  { min: 15,  names: ['Hair Tattoo Single Side', 'Hair Tattoo - Single Side', 'Hair Tattoo – Single Side', 'Hair Tattoo Single'] },
  { min: 30,  names: ['Hair Tattoo Double Side', 'Hair Tattoo - Double Side', 'Hair Tattoo – Double Side', 'Hair Tattoo'] },
  { min: 45,  names: ['Hair Color', 'Hair Colouring', 'Hair Coloring'] },
  { min: 180, names: ['Hair Bleaching'] },
  { min: 180, names: ['Hair Highlighting'] },
  { min: 90,  names: ['Hair Curly'] },
  { min: 90,  names: ['Hair Smoothing'] },
  { min: 30,  names: ['Hair Spa'] },
  { min: 60,  names: ['Down Perm / Root Lift', 'Down Perm', 'Root Lift'] },
  { min: 30,  names: ['Traditional Shaving'] },
  { min: 45,  names: ['Premium Head Shave'] },
  { min: 45,  names: ['Men Massage Service'] },
  { min: 25,  names: ['Nose Wax'] },
  { min: 25,  names: ['Ear Wax'] },
  { min: 20,  names: ['Ear Singeing'] },
  { min: 45,  names: ['Charcoal Deep Cleansing'] },
  { min: 25,  names: ['Ear Candle'] },
  { min: 30,  names: ['Charcoal Nose Cleansing Strip'] },
  { min: 90,  names: ['Redbox Royal Grooming'] },
  { min: 90,  names: ['Redbox Duxe Grooming', 'Redbox Deluxe Grooming'] },
  { min: 90,  names: ['Redbox Earl Grooming'] },
  { min: 90,  names: ['Redbox Baron Grooming'] },
  { min: 90,  names: ['Redbox Noble Grooming'] },
];

(async () => {
  console.log(`📡  ${SUPABASE_URL}\n`);

  // Snapshot before
  const { data: before, error: beforeErr } = await sb
    .from('services')
    .select('id, name, moka_variant_name, duration_minutes')
    .order('name');
  if (beforeErr) { console.error('Read services failed:', beforeErr.message); process.exit(1); }
  console.log(`📋  Found ${before.length} services in DB\n`);

  let touched = 0;
  let unchanged = 0;
  const idsHit = new Set();

  for (const rule of DURATIONS) {
    for (const pattern of rule.names) {
      // Match by services.name
      const { data: matchedByName } = await sb
        .from('services')
        .select('id, name, duration_minutes')
        .ilike('name', pattern);
      // Match by services.moka_variant_name
      const { data: matchedByVariant } = await sb
        .from('services')
        .select('id, name, moka_variant_name, duration_minutes')
        .ilike('moka_variant_name', pattern);

      const matched = [...(matchedByName || []), ...(matchedByVariant || [])];
      const seenInBatch = new Set();
      for (const row of matched) {
        if (seenInBatch.has(row.id)) continue;
        seenInBatch.add(row.id);

        if (row.duration_minutes === rule.min) {
          if (!idsHit.has(row.id)) unchanged++;
          idsHit.add(row.id);
          continue;
        }

        const { error: updErr } = await sb
          .from('services')
          .update({ duration_minutes: rule.min })
          .eq('id', row.id);
        if (updErr) {
          console.warn(`  ⚠️   ${row.name} (${pattern}): ${updErr.message}`);
        } else {
          console.log(`  ✅  ${row.name.padEnd(40)} ${row.duration_minutes ?? '?'}m → ${rule.min}m`);
          touched++;
          idsHit.add(row.id);
        }
      }
    }
  }

  // Show unmatched services (might need manual review)
  const unmatched = before.filter(r => !idsHit.has(r.id));
  if (unmatched.length) {
    console.log('\n⚠️   Unmatched services (NOT updated, review manually):');
    for (const r of unmatched) {
      console.log(`     • ${r.name} (variant=${r.moka_variant_name || '-'}, current=${r.duration_minutes}m)`);
    }
  }

  // Snapshot after
  const { data: after } = await sb
    .from('services')
    .select('name, moka_variant_name, duration_minutes')
    .order('duration_minutes', { ascending: false });

  console.log(`\n── Done ─────────────────────────────────`);
  console.log(`  ✅  ${touched} updated     ⏭   ${unchanged} unchanged     ⚠️   ${unmatched.length} unmatched`);
  console.log(`\n📋  Final state:\n`);
  for (const r of after) {
    console.log(`  ${String(r.duration_minutes).padStart(4)}m   ${r.name}${r.moka_variant_name ? `  [${r.moka_variant_name}]` : ''}`);
  }
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
