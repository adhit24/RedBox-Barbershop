'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require(path.join(__dirname, '../../node_modules/@supabase/supabase-js'));

// Load server/.env
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
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(url, key);

async function applyMemberTierMigration() {
  console.log('--- Applying Member Tier Classification Migration ---');
  
  const targets = [
    { outlet_slug: 'bypass',    moka_item_id: '16902093', moka_variant_id: '207049813', item_name: 'Member Platinum' },
    { outlet_slug: 'csb',       moka_item_id: '18112524', moka_variant_id: '207049935', item_name: 'Member Platinum' },
    { outlet_slug: 'sumber',    moka_item_id: '51851182', moka_variant_id: '82158584',  item_name: 'Member Student' },
    { outlet_slug: 'bypass',    moka_item_id: '16902093', moka_variant_id: '31396264',  item_name: 'Member Student' },
    { outlet_slug: 'samadikun', moka_item_id: '11551867', moka_variant_id: '23002317',  item_name: 'Member Student' },
    { outlet_slug: 'csb',       moka_item_id: '18112524', moka_variant_id: '33139495',  item_name: 'Member Student' },
    { outlet_slug: 'tegal',     moka_item_id: '94819112', moka_variant_id: '144991607', item_name: 'Member Student' },
  ];

  const { data: outlets, error: outletErr } = await supabase.from('outlets').select('id, slug');
  if (outletErr) throw outletErr;
  const outletMap = Object.fromEntries(outlets.map(o => [o.slug, o.id]));

  let updatedCount = 0;
  let insertedCount = 0;
  let untouchedCount = 0;

  for (const t of targets) {
    const outletId = outletMap[t.outlet_slug];
    if (!outletId) {
      console.error(`Outlet not found for slug: ${t.outlet_slug}`);
      continue;
    }

    const { data: existing, error: findErr } = await supabase
      .from('moka_item_mappings')
      .select('*')
      .eq('moka_item_id', t.moka_item_id)
      .eq('moka_variant_id', t.moka_variant_id)
      .eq('outlet_id', outletId);

    if (findErr) throw findErr;

    const reason = `Task 2.1B: membership/payment product ("${t.item_name}"), not a barber-performed service — exact (outlet, moka_item_id, moka_variant_id) match only.`;

    if (existing && existing.length > 0) {
      const row = existing[0];
      if (row.classification !== 'NON_STOCK_MISC') {
        const { error: updErr } = await supabase
          .from('moka_item_mappings')
          .update({
            classification: 'NON_STOCK_MISC',
            classification_reason: reason,
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        if (updErr) throw updErr;
        console.log(`Updated row ${row.id} (${t.outlet_slug} - ${t.item_name}) from ${row.classification} -> NON_STOCK_MISC`);
        updatedCount++;
      } else {
        console.log(`Row ${row.id} (${t.outlet_slug} - ${t.item_name}) is already NON_STOCK_MISC. Untouched.`);
        untouchedCount++;
      }
    } else {
      const { error: insErr } = await supabase
        .from('moka_item_mappings')
        .insert({
          moka_item_id: t.moka_item_id,
          moka_variant_id: t.moka_variant_id,
          product_id: null,
          outlet_id: outletId,
          is_active: false,
          classification: 'NON_STOCK_MISC',
          classification_reason: reason,
        });

      if (insErr) throw insErr;
      console.log(`Inserted missing row for (${t.outlet_slug} - ${t.item_name}) as NON_STOCK_MISC`);
      insertedCount++;
    }
  }

  console.log(`\nResult: ${updatedCount} updated, ${insertedCount} inserted, ${untouchedCount} already correct.`);
}

applyMemberTierMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
