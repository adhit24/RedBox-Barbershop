'use strict';
/**
 * One-shot script: sync Airtable Bio Kapster → Supabase barbers
 * Run: node server/sync-airtable-barbers.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');
const { fetchBarbersFromAirtable } = require('./airtable');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
                  || process.env.SUPABASE_SERVICE_ROLE_KEY
                  || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// slug → outlet UUID (fetched from DB)
const outletUuidBySlug = {};

async function loadOutlets() {
  const { data, error } = await supabase.from('outlets').select('id, slug, name');
  if (error) throw new Error('Failed to load outlets: ' + error.message);
  for (const o of data) outletUuidBySlug[o.slug] = o.id;
  console.log('Outlets loaded:', outletUuidBySlug);
}

async function main() {
  await loadOutlets();

  const { ok, data: airtableBarbers } = await fetchBarbersFromAirtable();
  if (!ok || !airtableBarbers.length) {
    console.error('Failed to fetch from Airtable or empty result');
    process.exit(1);
  }
  console.log(`Fetched ${airtableBarbers.length} barbers from Airtable`);

  // Load current Supabase barbers to preserve moka_employee_id
  const { data: currentBarbers, error: fetchErr } = await supabase
    .from('barbers')
    .select('id, name, outlet_id, moka_employee_id, is_active');
  if (fetchErr) throw new Error('Failed to fetch current barbers: ' + fetchErr.message);

  const mokaIdByBarberId = {};
  for (const b of (currentBarbers || [])) {
    if (b.moka_employee_id) mokaIdByBarberId[b.id] = b.moka_employee_id;
  }
  console.log(`Loaded ${currentBarbers.length} existing Supabase barbers`);

  // Build upsert records
  const upsertRows = [];
  for (const at of airtableBarbers) {
    const outletId = outletUuidBySlug[at.branch];
    if (!outletId) {
      console.warn(`  SKIP ${at.id}: unknown branch "${at.branch}"`);
      continue;
    }
    const row = {
      id:               at.id,
      name:             at.name,
      outlet_id:        outletId,
      role:             at.role || 'Barber',
      img:              at.img || '',
      work_days:        at.work_days,
      is_active:        at.is_active,
    };
    // Preserve existing moka_employee_id
    if (mokaIdByBarberId[at.id]) {
      row.moka_employee_id = mokaIdByBarberId[at.id];
    }
    upsertRows.push(row);
  }

  console.log(`Upserting ${upsertRows.length} barbers...`);
  for (const row of upsertRows) {
    const { error } = await supabase
      .from('barbers')
      .upsert(row, { onConflict: 'id' });
    if (error) {
      console.error(`  ERROR upserting ${row.id}: ${error.message}`);
    } else {
      console.log(`  OK  ${row.id} — ${row.name} (${row.is_active ? 'active' : 'inactive'})`);
    }
  }

  // Find Supabase barbers NOT in Airtable → mark inactive
  const airtableIds = new Set(airtableBarbers.map(b => b.id));
  const toDeactivate = (currentBarbers || []).filter(b => b.is_active && !airtableIds.has(b.id));
  if (toDeactivate.length) {
    console.log(`\nDeactivating ${toDeactivate.length} barbers not found in Airtable:`);
    for (const b of toDeactivate) {
      const { error } = await supabase
        .from('barbers')
        .update({ is_active: false })
        .eq('id', b.id);
      if (error) {
        console.error(`  ERROR deactivating ${b.id}: ${error.message}`);
      } else {
        console.log(`  DEACTIVATED ${b.id} — ${b.name}`);
      }
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
