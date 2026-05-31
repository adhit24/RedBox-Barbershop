'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in server/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HOME_SERVICE_BARBERS = [
  { name: 'Aziz', phone: '08978444575' },
  { name: 'Hamami', phone: '085328993734' },
  { name: 'Sigit setiana', phone: '08987857129' },
  { name: 'OPAN', phone: '0882001003496' },
  { name: 'Prima', phone: '087729002108' },
  { name: 'Aden', phone: '08996388698' },
  { name: 'Bayu', phone: '083144815562' },
  { name: 'yuda', phone: '0881023450051' },
  { name: 'miftah', phone: '083131994954' },
  { name: 'dodi', phone: '085221156910' },
  { name: 'ragil', phone: '085713239794' },
  { name: 'Syarif', phone: '087731505046' },
  { name: 'Ari', phone: '089531956677' },
  { name: 'Didi', phone: '083143216880' },
  { name: 'ubay', phone: '081382282312' },
  { name: 'Ega', phone: '089676696947' },
  { name: 'Abdul', phone: '083120871896' },
  { name: 'Bob', phone: '081224448133' },
  { name: 'Onoy', phone: '089658908869' },
  { name: 'Sofyan', phone: '0895636801169' },
  { name: 'husen', phone: '08981283202' },
  { name: 'yafi', phone: '083812157224' },
  { name: 'Wawan', phone: '081290117050' },
  { name: 'Faiz', phone: '0812 2929 6509' },
  { name: 'Epik', phone: '0882 9491 7134' },
  { name: 'Ahmad', phone: '085540107100' },
  { name: 'shepril', phone: '087881499652' },
];

const ALIAS_TO_BARBER_ID = {
  abdul: 'bypass-abdul-dul',
  'sigit setiana': 'sumber-sigit',
  'kaji dodi': 'bypass-kaji-dodi',
  khamami: 'samadikun-khamami',
  shepril: 'tegal-sephril',
};

const SOURCE_BRANCH_BY_NAME = {
  aziz: 'sumber',
  bayu: 'sumber',
};

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  return `62${digits}`;
}

function buildNameIndex(barbers) {
  const byName = new Map();
  for (const barber of barbers) {
    const key = normalizeName(barber.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(barber);
  }
  return byName;
}

async function main() {
  const { data: outlets, error: outletsError } = await supabase
    .from('outlets')
    .select('id, slug');

  if (outletsError) throw outletsError;

  const outletIdBySlug = Object.fromEntries((outlets || []).map((outlet) => [outlet.slug, outlet.id]));

  const { data: barbers, error } = await supabase
    .from('barbers')
    .select('id, name, phone, is_active, home_service_enabled, outlet_id')
    .order('name');

  if (error) throw error;

  const byName = buildNameIndex(barbers || []);
  const updated = [];
  const ambiguous = [];
  const missing = [];

  for (const entry of HOME_SERVICE_BARBERS) {
    const normalizedEntryName = normalizeName(entry.name);
    let matches = [];

    if (ALIAS_TO_BARBER_ID[normalizedEntryName]) {
      matches = (barbers || []).filter((barber) => barber.id === ALIAS_TO_BARBER_ID[normalizedEntryName]);
    } else {
      matches = byName.get(normalizedEntryName) || [];
    }

    if (matches.length === 0) {
      const sourceBranch = SOURCE_BRANCH_BY_NAME[normalizedEntryName];
      const outletId = sourceBranch ? outletIdBySlug[sourceBranch] : null;

      if (!outletId || !sourceBranch) {
        missing.push(entry);
        continue;
      }

      const newBarber = {
        id: `${sourceBranch}-${normalizedEntryName.replace(/\s+/g, '-')}`,
        name: entry.name.trim(),
        role: 'Barber',
        img: '',
        work_days: null,
        branch: sourceBranch,
        outlet_id: outletId,
        is_active: true,
        home_service_enabled: true,
        phone: normalizePhone(entry.phone),
      };

      const { error: insertError } = await supabase
        .from('barbers')
        .insert(newBarber);

      if (insertError) {
        throw new Error(`Failed creating ${entry.name}: ${insertError.message}`);
      }

      updated.push({
        input_name: entry.name,
        id: newBarber.id,
        db_name: newBarber.name,
        phone: newBarber.phone,
        was_active: true,
        created: true,
      });
      continue;
    }

    const activeMatches = matches.filter((barber) => barber.is_active);
    const targetPool = activeMatches.length === 1 ? activeMatches : matches;

    if (targetPool.length !== 1) {
      ambiguous.push({
        input: entry,
        matches: targetPool.map((barber) => ({
          id: barber.id,
          name: barber.name,
          is_active: barber.is_active,
          phone: barber.phone,
        })),
      });
      continue;
    }

    const barber = targetPool[0];
    const nextPhone = normalizePhone(entry.phone);
    const patch = {
      phone: nextPhone,
      home_service_enabled: true,
    };

    const { error: updateError } = await supabase
      .from('barbers')
      .update(patch)
      .eq('id', barber.id);

    if (updateError) {
      throw new Error(`Failed updating ${barber.name}: ${updateError.message}`);
    }

    updated.push({
      input_name: entry.name,
      id: barber.id,
      db_name: barber.name,
      phone: nextPhone,
      was_active: barber.is_active,
    });
  }

  console.log(JSON.stringify({
    total_input: HOME_SERVICE_BARBERS.length,
    updated_count: updated.length,
    ambiguous_count: ambiguous.length,
    missing_count: missing.length,
    updated,
    ambiguous,
    missing,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
