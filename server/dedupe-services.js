#!/usr/bin/env node
'use strict';
/**
 * Dedupe `services` rows yang share moka_variant_name yang sama.
 * Strategi: keep row dengan price > 0 (legacy data dengan harga real),
 * delete row baru yang price=0. Pertahankan duration_minutes dari yang baru
 * (authoritative dari user list) dengan patch ke row yang dipertahankan.
 *
 * Special case: rename legacy "Haircut" → "Hair Cut" agar konsisten.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

(async () => {
  const { data: rows, error } = await sb
    .from('services')
    .select('id, name, slug, moka_variant_name, duration_minutes, price, is_active')
    .eq('is_active', true);
  if (error) { console.error(error); process.exit(1); }

  // Group by moka_variant_name (case-insensitive)
  const groups = new Map();
  for (const r of rows) {
    if (!r.moka_variant_name) continue;
    const k = r.moka_variant_name.toLowerCase().trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  // Authoritative durations (must match insert-missing-services.js)
  const AUTH_DUR = {
    'hair cut': 45,
    'hair fade cut': 60,
    'hair colouring': 45,
    'creambath': 30,
    'beard & mustache': 30,
  };

  for (const [variant, list] of groups) {
    if (list.length < 2) continue;
    console.log(`\n🔍  Duplicate variant "${variant}" → ${list.length} rows:`);
    for (const r of list) console.log(`     • ${r.name.padEnd(25)} price=${r.price}  dur=${r.duration_minutes}m  slug=${r.slug}`);

    // Keep row with highest price (legacy data with real price); ties → keep oldest
    list.sort((a, b) => (b.price || 0) - (a.price || 0));
    const keeper = list[0];
    const drops  = list.slice(1);

    // Patch keeper to authoritative duration if available
    const authDur = AUTH_DUR[variant];
    const patch = {};
    if (authDur && keeper.duration_minutes !== authDur) patch.duration_minutes = authDur;
    // Also rename "Haircut" → "Hair Cut" for consistency with user list
    if (keeper.name === 'Haircut' && variant === 'hair cut') patch.name = 'Hair Cut';

    if (Object.keys(patch).length > 0) {
      await sb.from('services').update(patch).eq('id', keeper.id);
      console.log(`  🔧  KEEP ${keeper.name} (id=${keeper.id.slice(0,8)}) — patched ${JSON.stringify(patch)}`);
    } else {
      console.log(`  ✅  KEEP ${keeper.name} (id=${keeper.id.slice(0,8)}) — no patch needed`);
    }

    for (const drop of drops) {
      // Soft-delete: set is_active=false (preserve referential integrity)
      const { error: delErr } = await sb
        .from('services').update({ is_active: false }).eq('id', drop.id);
      if (delErr) console.warn(`  ⚠️   Could not deactivate ${drop.name}: ${delErr.message}`);
      else console.log(`  🗑   DEACTIVATE ${drop.name} (id=${drop.id.slice(0,8)})`);
    }
  }

  // Final state
  const { data: final } = await sb
    .from('services').select('name, moka_variant_name, duration_minutes, price, is_active')
    .eq('is_active', true)
    .order('duration_minutes', { ascending: false });

  console.log(`\n📋  Active services after dedupe (${final.length}):`);
  for (const r of final) {
    console.log(`  ${String(r.duration_minutes).padStart(4)}m  Rp${String(r.price).padStart(8)}   ${r.name.padEnd(35)} [${r.moka_variant_name || '-'}]`);
  }
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
