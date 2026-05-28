#!/usr/bin/env node
/**
 * Seed customers + member_profiles dari Moka CSV export.
 *
 * Filter: hanya customer dengan Last Visit dalam 1 tahun terakhir.
 * Target:
 *   - PRIMARY DB:  customers (upsert by phone_e164)
 *   - MEMBER DB:   member_profiles (upsert by user_key, status=ACTIVE)
 *
 * Usage:
 *   node server/seed-from-moka-csv.js <csv-path> [--dry-run] [--customers-only|--members-only]
 *
 * CSV columns: Name,Email,Phone,Birthday,Sex,Address,City,State,Zip Code,
 *              Customer Since,Last Visit,Total # of orders,Amount This Month,
 *              Amount This Year,Amount Lifetime,Amount Average,Member Since,
 *              Current Point Balance,Reward Redeemed,Member Spending
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// ── CLI args ───────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const csvPath  = args.find(a => !a.startsWith('--'));
const dryRun   = args.includes('--dry-run');
const onlyCustomers = args.includes('--customers-only');
const onlyMembers   = args.includes('--members-only');

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Usage: node seed-from-moka-csv.js <csv-path> [--dry-run] [--customers-only|--members-only]');
  process.exit(1);
}

// ── Clients ────────────────────────────────────────────────────────────────
const PRIMARY_URL = process.env.SUPABASE_URL;
const PRIMARY_KEY = process.env.SUPABASE_SERVICE_KEY;
// Member tables sekarang di PRIMARY DB (post-consolidation 2026-05-28).
// Pakai service key untuk member juga (lebih sederhana, single client).
if (!dryRun && (!PRIMARY_URL || !PRIMARY_KEY)) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars.');
  console.error('Set inline: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node ' + path.basename(__filename) + ' ' + csvPath);
  process.exit(1);
}

const primary = !dryRun ? createClient(PRIMARY_URL, PRIMARY_KEY) : null;
const member  = primary; // single client now

// ── Constants ──────────────────────────────────────────────────────────────
const ONE_YEAR_CUTOFF_ISO = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
const POINTS_PER_VISIT = 50;
const CUSTOMERS_BATCH_SIZE = 500;
const MEMBERS_BATCH_SIZE   = 200; // smaller for member DB (anon key may rate-limit)
const TIER_THRESHOLDS = [
  { name: 'platinum', min: 3000 },
  { name: 'gold',     min: 1000 },
  { name: 'silver',   min: 500  },
  { name: 'bronze',   min: 0    },
];
const getTier = (pts) => { for (const t of TIER_THRESHOLDS) if (pts >= t.min) return t.name; return 'bronze'; };

// ── Helpers ────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  // Naive CSV parser — handles quoted fields with commas but not embedded newlines.
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// DD-MM-YYYY → YYYY-MM-DD (or null)
function ddmmyyyyToISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
}

// +6281xxx → 6281xxx (digits only)
function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('62')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(-11);
}

function toE164(phone) {
  const d = normalizePhone(phone);
  if (!d || d.length < 8) return null;
  return '+62' + d;
}

function toWaNoPlus(phone) {
  const d = normalizePhone(phone);
  if (!d || d.length < 8) return null;
  return '62' + d;
}

function genReferralCode(seed) {
  // Deterministic dari phone — phone sudah dedup di Set, jadi prefix length-aware
  // referral code 1-to-1 dengan phone. Format: RB<2-digit-length><phone>
  // Length prefix mencegah collision antar phone yg punya tail digit identik
  // tapi panjang beda (mis. 1234567890 vs 234567890).
  const digits = String(seed || '').replace(/\D/g, '');
  const len = String(digits.length).padStart(2, '0');
  return `RB${len}${digits}`;
}

// ── Parse CSV ──────────────────────────────────────────────────────────────
console.log(`Reading: ${csvPath}`);
const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.split(/\r?\n/);
const header = parseCSVLine(lines[0]);
console.log(`Header (${header.length} cols):`, header.slice(0, 5).join(' | '), '...');

const COL = {
  name:        header.indexOf('Name'),
  email:       header.indexOf('Email'),
  phone:       header.indexOf('Phone'),
  birthday:    header.indexOf('Birthday'),
  sex:         header.indexOf('Sex'),
  address:     header.indexOf('Address'),
  customerSince: header.indexOf('Customer Since'),
  lastVisit:   header.indexOf('Last Visit'),
  totalOrders: header.indexOf('Total # of orders'),
  amtLifetime: header.indexOf('Amount Lifetime'),
};
for (const [k, idx] of Object.entries(COL)) {
  if (idx < 0) { console.error(`Column "${k}" not found in CSV header`); process.exit(1); }
}

const rows = [];
const phoneSeen = new Set();
let skippedNoPhone = 0, skippedStale = 0, skippedDup = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const f = parseCSVLine(line);
  if (f.length < header.length - 2) continue; // malformed

  const lastVisitISO = ddmmyyyyToISO(f[COL.lastVisit]);
  if (!lastVisitISO || lastVisitISO < ONE_YEAR_CUTOFF_ISO) { skippedStale++; continue; }

  const phoneNorm = normalizePhone(f[COL.phone]);
  if (!phoneNorm || phoneNorm.length < 8) { skippedNoPhone++; continue; }
  if (phoneSeen.has(phoneNorm)) { skippedDup++; continue; }
  phoneSeen.add(phoneNorm);

  const visits = parseInt(f[COL.totalOrders] || '0', 10) || 0;
  const points = visits * POINTS_PER_VISIT;
  const amtLifetime = Math.round(parseFloat(f[COL.amtLifetime] || '0')) || 0;
  const email = (f[COL.email] || '').trim().toLowerCase() || null;
  const phone_e164 = toE164(f[COL.phone]);
  const wa = toWaNoPlus(f[COL.phone]);
  const birthdayISO = ddmmyyyyToISO(f[COL.birthday]);
  const sex = (f[COL.sex] || '').trim().toLowerCase() || null;
  const address = (f[COL.address] || '').trim() || null;
  const name = (f[COL.name] || '').trim() || 'Unknown';

  rows.push({
    name,
    email,
    phone_e164,
    wa,
    phoneNorm,
    visits,
    points,
    tier: getTier(points),
    lastVisit: lastVisitISO,
    amtLifetime,
    birthdayISO,
    sex: sex === 'male' || sex === 'female' ? sex : null,
    address,
  });
}

console.log('\n── Parse summary ──');
console.log(`Total CSV rows:               ${lines.length - 1}`);
console.log(`Skipped (stale > 1yr):        ${skippedStale}`);
console.log(`Skipped (no/short phone):     ${skippedNoPhone}`);
console.log(`Skipped (duplicate phone):    ${skippedDup}`);
console.log(`Eligible to import:           ${rows.length}`);

const tierDist = rows.reduce((acc, r) => { acc[r.tier] = (acc[r.tier]||0) + 1; return acc; }, {});
console.log(`Tier distribution:            ${JSON.stringify(tierDist)}`);
console.log(`With email:                   ${rows.filter(r => r.email).length}`);

if (dryRun) {
  console.log('\n[DRY RUN] Sample first 3 rows:');
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));
  process.exit(0);
}

// ── Upsert to customers (primary DB) ───────────────────────────────────────
async function upsertCustomers() {
  console.log(`\n── Upserting ${rows.length} rows to customers (batch ${CUSTOMERS_BATCH_SIZE}) ──`);
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += CUSTOMERS_BATCH_SIZE) {
    const batch = rows.slice(i, i + CUSTOMERS_BATCH_SIZE).map(r => ({
      name:          r.name,
      wa:            r.wa,
      phone_e164:    r.phone_e164,
      email:         r.email,
      visits:        r.visits,
      total_spent:   r.amtLifetime,
      last_visit:    r.lastVisit,
      birth_date:    r.birthdayISO,
      gender:        r.sex,
      address:       r.address,
      source:        'moka',
      points:        r.points,
    }));
    const { error } = await primary
      .from('customers')
      .upsert(batch, { onConflict: 'wa', ignoreDuplicates: false });
    if (error) {
      fail += batch.length;
      console.error(`  batch ${i}: ERROR — ${error.message}`);
    } else {
      ok += batch.length;
      process.stdout.write(`  batch ${i}–${i + batch.length} OK\r`);
    }
  }
  console.log(`\n  customers: ok=${ok} fail=${fail}`);
  return { ok, fail };
}

// ── Upsert to member_profiles (member DB) ───────────────────────────────────
async function upsertMembers() {
  console.log(`\n── Upserting ${rows.length} rows to member_profiles (batch ${MEMBERS_BATCH_SIZE}) ──`);
  const nowISO = new Date().toISOString();
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i += MEMBERS_BATCH_SIZE) {
    const batch = rows.slice(i, i + MEMBERS_BATCH_SIZE).map(r => {
      const userKey = r.email || `moka_${r.phoneNorm}`;
      const email   = r.email || `moka_${r.phoneNorm}@redbox.internal`;
      return {
        user_key:               userKey,
        email,
        full_name:              r.name,
        phone:                  r.phone_e164,
        birthdate:              r.birthdayISO || '',
        gender:                 r.sex || 'male',
        address:                r.address || '',
        membership_status:      'ACTIVE',
        membership_activated_at: nowISO,
        total_points:           r.points,
        total_visits:           r.visits,
        current_tier:           r.tier,
        referral_code:          genReferralCode(r.phoneNorm),
      };
    });
    const { error } = await member
      .from('member_profiles')
      .upsert(batch, { onConflict: 'user_key', ignoreDuplicates: false });
    if (error) {
      fail += batch.length;
      console.error(`  batch ${i}: ERROR — ${error.message}`);
    } else {
      ok += batch.length;
      process.stdout.write(`  batch ${i}–${i + batch.length} OK\r`);
    }
    // small delay to avoid rate limit
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`\n  member_profiles: ok=${ok} fail=${fail}`);
  return { ok, fail };
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const startT = Date.now();
  if (!onlyMembers)  await upsertCustomers();
  if (!onlyCustomers) await upsertMembers();
  console.log(`\nElapsed: ${((Date.now() - startT) / 1000).toFixed(1)}s`);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
