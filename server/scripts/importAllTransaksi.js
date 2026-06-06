/**
 * Bulk import all Moka CSV files from the Transaksi/ folder directly to Supabase.
 * Run once from the project root:
 *   node server/scripts/importAllTransaksi.js
 *
 * Requires server/.env with SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TRANSAKSI_DIR = path.join(__dirname, '../../Transaksi');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── shared with adminCrm.js ────────────────────────────────────────────────
const OUTLET_SLUG_MAP = {
  'redbox barbershop bypass':    'bypass',
  'redbox barbershop samadikun': 'samadikun',
  'redbox barbershop csb':       'csb',
  'redbox barbershop sumber':    'sumber',
  'redbox barbershop tegal':     'tegal',
};

function parseCSVRow(line) {
  const fields = [];
  let field = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim()); field = '';
    } else { field += ch; }
  }
  fields.push(field.trim());
  return fields;
}

function parseMokaDate(raw) {
  const [d, m, y] = raw.split('-');
  return `${y}-${m}-${d}`;
}

function extractBarberItems(itemsRaw) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of itemsRaw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  const items = [];
  for (const part of parts) {
    const parenIdx = part.indexOf('(');
    if (parenIdx < 0) continue;
    const name    = part.slice(0, parenIdx).trim();
    const service = part.slice(parenIdx + 1, part.lastIndexOf(')')).trim();
    if (name && service) items.push({ name, service });
  }
  return items;
}

function editDist(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i + j));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function matchBarberName(csvName, barbers) {
  const lower = csvName.toLowerCase().trim();
  for (const b of barbers) {
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  for (const b of barbers) {
    const fw = b.name.split(' ')[0].toLowerCase();
    if (editDist(lower, fw) <= 2) return b;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────

async function importCSV(filePath, barbers) {
  const name    = path.basename(filePath);
  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines   = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) { console.log(`  skip ${name}: empty`); return; }

  const headers = parseCSVRow(lines[0]).map(h =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'));
  const ci = (hint) => headers.findIndex(h => h.includes(hint));

  const iOutlet    = ci('outlet');
  const iDate      = ci('date');
  const iTime      = ci('time');
  const iGross     = ci('gross');
  const iNet       = ci('net_sale');
  const iCollected = ci('total_collected');
  const iReceipt   = ci('receipt');
  const iCollBy    = ci('collected_by');
  const iItems     = ci('items');
  const iPayment   = ci('payment');
  const iEvent     = ci('event_type');

  const txRows = [], svcRows = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length < 5) continue;

    const outletSlug = OUTLET_SLUG_MAP[(row[iOutlet] || '').trim().toLowerCase()];
    if (!outletSlug) { skipped++; continue; }
    if ((row[iEvent] || '').trim().toLowerCase() !== 'payment') { skipped++; continue; }

    const receiptNumber = (row[iReceipt] || '').trim();
    if (!receiptNumber) continue;

    const rawDate = (row[iDate] || '').trim();
    const txDate  = rawDate.length === 10 && rawDate[2] === '-' ? parseMokaDate(rawDate) : rawDate;
    const netSales   = parseFloat(row[iNet]       || '0') || 0;
    const grossSales = parseFloat(row[iGross]     || '0') || 0;
    const totalColl  = parseFloat(row[iCollected] || '0') || 0;
    const itemsRaw   = (row[iItems] || '').trim();

    txRows.push({
      receipt_number: receiptNumber, outlet_slug: outletSlug,
      tx_date: txDate, tx_time: (row[iTime] || '').trim(),
      net_sales: netSales, gross_sales: grossSales, total_collected: totalColl,
      payment_method: (row[iPayment] || '').trim(),
      collected_by: (row[iCollBy] || '').trim(), items_raw: itemsRaw,
    });

    const seen = new Map();
    for (const item of extractBarberItems(itemsRaw)) {
      const matched = matchBarberName(item.name, barbers);
      if (!matched) continue;
      if (!seen.has(matched.id)) seen.set(matched.id, { csvName: item.name, services: [] });
      seen.get(matched.id).services.push(item.service);
    }

    const revenueShare = seen.size > 0 ? Math.round(netSales / seen.size) : 0;
    for (const [barberId, { csvName, services }] of seen) {
      svcRows.push({
        receipt_number: receiptNumber,
        barber_name_raw: csvName, barber_id: barberId,
        service_name: services.join(', '),
        outlet_slug: outletSlug, tx_date: txDate,
        revenue_share: revenueShare,
      });
    }
  }

  // Upsert transactions
  if (txRows.length) {
    const { error } = await supabase.from('moka_transactions')
      .upsert(txRows, { onConflict: 'receipt_number' });
    if (error) { console.error(`  ✗ ${name} TX: ${error.message}`); return; }
  }

  // Delete + re-insert barber services for these receipts
  if (svcRows.length) {
    const receiptNums = [...new Set(svcRows.map(s => s.receipt_number))];
    await supabase.from('moka_barber_services').delete().in('receipt_number', receiptNums);
    const { error } = await supabase.from('moka_barber_services').insert(svcRows);
    if (error) { console.error(`  ✗ ${name} SVC: ${error.message}`); return; }
  }

  console.log(`  ✓ ${name}: ${txRows.length} tx, ${svcRows.length} kapster rows (${skipped} skipped)`);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in server/.env');
    process.exit(1);
  }

  const { data: barbers, error: bErr } = await supabase
    .from('barbers').select('id, name, branch').eq('is_active', true);
  if (bErr) { console.error('Failed to load barbers:', bErr.message); process.exit(1); }
  console.log(`Loaded ${barbers.length} active barbers.\n`);

  const files = fs.readdirSync(TRANSAKSI_DIR)
    .filter(f => f.endsWith('.csv'))
    .sort()
    .map(f => path.join(TRANSAKSI_DIR, f));

  if (!files.length) { console.log('No CSV files found in', TRANSAKSI_DIR); return; }
  console.log(`Found ${files.length} CSV file(s):\n`);

  for (const f of files) await importCSV(f, barbers);
  console.log('\nDone.');
}

main().catch(console.error);
