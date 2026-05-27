'use strict';
// ================================================================
// sync-moka-members.js
// Tarik data member dari semua outlet Moka sejak Mei 2025,
// hitung poin (visits × 10), upsert ke Supabase.
// Filter: skip member tanpa kunjungan sejak 2025-05-01.
//
// Jalankan dari folder server/:
//   node scripts/sync-moka-members.js
// ================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https  = require('https');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MOKA_BASE   = (process.env.MOKA_API_BASE || 'https://api.mokapos.com').replace(/\/$/, '');
const SINCE_DATE  = '2025-05-01';
const SINCE_UNIX  = Math.floor(new Date(SINCE_DATE + 'T00:00:00Z').getTime() / 1000);
const PER_PAGE    = 100;

// ── HTTP helper ─────────────────────────────────────────────────

function mokaGetOnce(path, token) {
  return new Promise((resolve, reject) => {
    const fullUrl = MOKA_BASE + path;
    const url     = new URL(fullUrl);
    const opts    = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
        'User-Agent':  'RedBox-Sync/1.0',
      },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(Object.assign(
              new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json).slice(0, 200)}`),
              { status: res.statusCode, body: json }
            ));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`JSON parse error (HTTP ${res.statusCode}): ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Request timeout')); });
    req.end();
  });
}

async function mokaGet(path, token, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await mokaGetOnce(path, token);
    } catch (err) {
      if (attempt === retries || err.status >= 400) throw err;
      // Tunggu sebelum retry (2s, 5s)
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ── Normalisasi nomor WA ─────────────────────────────────────────

function normalizeWa(raw) {
  let wa = String(raw || '').replace(/\D/g, '');
  if (!wa) return '';
  if (wa.startsWith('0'))            wa = '62' + wa.slice(1);
  else if (!wa.startsWith('62'))     wa = '62' + wa;
  return wa;
}

// ── Pull semua transaksi outlet sejak SINCE_DATE ─────────────────

async function pullOutletTransactions(mokaOutletId, token) {
  const customerMap = new Map();
  // Mulai tanpa since — Moka API di-paginate dari terbaru mundur ke lama
  // Stop jika halaman berisi transaksi yang lebih lama dari SINCE_DATE
  let path    = `/v3/outlets/${mokaOutletId}/reports/get_latest_transactions?per_page=${PER_PAGE}`;
  let page    = 0;
  let totalTx = 0;
  let reachedCutoff = false;

  while (true) {
    page++;
    let resp;
    try {
      resp = await mokaGet(path, token);
    } catch (err) {
      console.error(`    ✗ Halaman ${page}: ${err.message}`);
      break;
    }

    const payments  = Array.isArray(resp?.data?.payments) ? resp.data.payments : [];
    const nextUrl   = resp?.data?.next_url || null;
    const completed = resp?.data?.completed;

    if (payments.length === 0) break;
    totalTx += payments.length;

    for (const p of payments) {
      if (p.is_deleted || p.is_refunded) continue;

      // Tanggal: created_at (ISO), bukan transaction_time (hanya jam)
      const txDate  = (p.created_at || p.updated_at || '').slice(0, 10);

      // Skip transaksi yang lebih lama dari cutoff (tapi tetap cek sisa halaman)
      if (txDate && txDate < SINCE_DATE) { reachedCutoff = true; continue; }

      const rawPhone = String(
        p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || ''
      ).trim();
      const cName  = String(p.customer_name  || p.name  || p.full_name || '').trim();
      const cEmail = String(p.customer_email || p.email || '').trim();
      const cId    = String(p.customer_id    || p.id    || '').trim();
      const amount = Number(p.total_collected || p.total_transaction || 0);

      const wa  = normalizeWa(rawPhone);
      const key = wa || cId;
      if (!key) continue;

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          name: cName, email: cEmail || null, mokaId: cId || null,
          wa, phone_e164: wa ? `+${wa}` : null,
          visits: 0, total_spent: 0, last_visit: null,
        });
      }
      const c = customerMap.get(key);
      if (cName && !c.name)   c.name   = cName;
      if (cEmail && !c.email) c.email  = cEmail;
      if (cId && !c.mokaId)   c.mokaId = cId;
      c.visits++;
      c.total_spent += amount;
      if (txDate && (!c.last_visit || txDate > c.last_visit)) c.last_visit = txDate;
    }

    process.stdout.write(
      `    hal.${page} — ${totalTx} tx, ${customerMap.size} member...\r`
    );

    // Berhenti jika sudah melewati cutoff atau tidak ada halaman berikutnya
    if (reachedCutoff || !nextUrl || completed === true) break;
    path = nextUrl.replace(/^https?:\/\/[^/]+/, '');
  }

  console.log(
    `    Selesai: ${page} hal, ${totalTx} transaksi, ${customerMap.size} member unik`
  );
  return customerMap;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY tidak ada di .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: outlets, error: outletErr } = await supabase
    .from('outlets').select('id, name, moka_outlet_id');
  if (outletErr) { console.error('Gagal ambil outlets:', outletErr.message); process.exit(1); }

  const { data: tokens, error: tokenErr } = await supabase
    .from('moka_tokens').select('outlet_id, access_token, expires_at')
    .order('expires_at', { ascending: false });
  if (tokenErr) { console.error('Gagal ambil tokens:', tokenErr.message); process.exit(1); }

  // Kumpulkan semua access_token yang belum expired (unik)
  const now = new Date();
  const allTokens = [...new Set(
    tokens.filter(t => t.access_token && new Date(t.expires_at) > now).map(t => t.access_token)
  )];

  console.log(`\n=== MOKA MEMBER SYNC ===`);
  console.log(`Since  : ${SINCE_DATE}  (Unix ${SINCE_UNIX})`);
  console.log(`Base   : ${MOKA_BASE}`);
  console.log(`Outlets: ${outlets.length}`);
  console.log(`Tokens : ${allTokens.length} unik\n`);

  // Temukan token terbaik: coba setiap token terhadap outlet pertama yang valid
  // Token yang berhasil akan digunakan untuk semua outlet (client-credentials behavior)
  let bestToken = null;
  for (const tk of allTokens) {
    const testOutlet = outlets.find(o => o.moka_outlet_id);
    if (!testOutlet) break;
    try {
      const resp = await mokaGet(
        `/v3/outlets/${testOutlet.moka_outlet_id}/reports/get_latest_transactions?per_page=1`,
        tk
      );
      if (Array.isArray(resp?.data?.payments)) { bestToken = tk; break; }
    } catch { /* try next */ }
  }
  if (!bestToken && allTokens.length > 0) bestToken = allTokens[0];
  console.log(bestToken
    ? `  Token aktif: ${bestToken.slice(0, 20)}...\n`
    : `  ⚠  Tidak ada token valid — sync mungkin gagal\n`
  );

  const globalMap = new Map();
  const skippedOutlets = [];

  for (const outlet of outlets) {
    if (!outlet.moka_outlet_id) {
      console.log(`  ⚠  ${outlet.name}: tidak ada moka_outlet_id, skip`);
      skippedOutlets.push(`${outlet.name} (no moka_id)`);
      continue;
    }

    if (!bestToken) {
      console.log(`  ⚠  ${outlet.name}: tidak ada token, skip`);
      skippedOutlets.push(`${outlet.name} (no token)`);
      continue;
    }

    console.log(`  → ${outlet.name}  (moka_id: ${outlet.moka_outlet_id})`);
    let outletMap;
    try {
      outletMap = await pullOutletTransactions(
        outlet.moka_outlet_id, bestToken
      );
    } catch (err) {
      console.error(`    ✗ Fatal error ${outlet.name}: ${err.message}`);
      skippedOutlets.push(`${outlet.name} (error: ${err.message.slice(0, 80)})`);
      continue;
    }

    // Merge ke globalMap (akumulasi visits lintas outlet, dedup by WA)
    for (const [key, c] of outletMap) {
      if (!globalMap.has(key)) {
        globalMap.set(key, { ...c });
      } else {
        const g = globalMap.get(key);
        g.visits      += c.visits;
        g.total_spent += c.total_spent;
        if (c.name  && !g.name)    g.name   = c.name;
        if (c.email && !g.email)   g.email  = c.email;
        if (c.mokaId && !g.mokaId) g.mokaId = c.mokaId;
        if (c.last_visit && (!g.last_visit || c.last_visit > g.last_visit))
          g.last_visit = c.last_visit;
      }
    }
    console.log('');
  }

  const totalFound = globalMap.size;

  // Filter: hanya member dengan last_visit >= 2025-05-01
  const valid = Array.from(globalMap.values()).filter(c =>
    c.last_visit && c.last_visit >= SINCE_DATE
  );
  const filtered = totalFound - valid.length;

  console.log(`\n──────────────────────────────────────`);
  console.log(`Total customer dari Moka : ${totalFound}`);
  console.log(`Diskip (last_visit lama) : ${filtered}`);
  console.log(`Akan di-upsert           : ${valid.length}`);
  if (skippedOutlets.length) {
    console.log(`Outlet skip              : ${skippedOutlets.join(', ')}`);
  }
  console.log(`──────────────────────────────────────\n`);

  if (valid.length === 0) {
    console.log('Tidak ada data untuk di-upsert.');
    return;
  }

  // Dedup by wa — jika ada dua entry dengan wa sama, ambil yang visits lebih banyak
  const dedupMap = new Map();
  for (const c of valid) {
    const key = c.wa || c.mokaId || c.name;
    if (!key) continue;
    if (!dedupMap.has(key) || c.visits > dedupMap.get(key).visits) {
      dedupMap.set(key, c);
    }
  }
  const dedupedValid = Array.from(dedupMap.values());
  if (dedupedValid.length < valid.length) {
    console.log(`Dedup wa: ${valid.length} → ${dedupedValid.length} (${valid.length - dedupedValid.length} duplikat dihapus)\n`);
  }

  // Upsert ke Supabase dalam batch 200
  const BATCH_SIZE = 200;
  let upserted = 0;
  let errCount = 0;

  for (let i = 0; i < dedupedValid.length; i += BATCH_SIZE) {
    const batch = dedupedValid.slice(i, i + BATCH_SIZE);

    // Dedup rows by wa dalam batch — hindari "ON CONFLICT affect row a second time"
    // Skip juga entry tanpa wa (tidak bisa di-upsert secara unik)
    const seenWa = new Set();
    const rows = [];
    for (const c of batch) {
      const wa = c.wa || '';
      if (!wa) continue;          // skip tanpa nomor WA
      if (seenWa.has(wa)) continue; // skip duplikat dalam batch ini
      seenWa.add(wa);
      rows.push({
        name:             c.name        || 'Moka Customer',
        wa,
        phone_e164:       c.phone_e164  || null,
        email:            c.email       || null,
        source:           'moka',
        moka_customer_id: c.mokaId      || null,
        visits:           c.visits,
        total_spent:      c.total_spent,
        last_visit:       c.last_visit  || null,
        points:           c.visits * 10,
        updated_at:       new Date().toISOString(),
      });
    }
    if (rows.length === 0) { upserted += batch.length; continue; }

    let { error } = await supabase
      .from('customers')
      .upsert(rows, { onConflict: 'wa', ignoreDuplicates: false });

    // Fallback jika kolom points belum ada di schema lama
    if (error?.message?.includes('points')) {
      const r2 = rows.map(({ points: _, ...rest }) => rest);
      ({ error } = await supabase
        .from('customers')
        .upsert(r2, { onConflict: 'wa', ignoreDuplicates: false }));
    }

    if (error) {
      console.error(`  ✗ Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
      errCount += batch.length;
    } else {
      upserted += batch.length;
    }
    process.stdout.write(`  Upsert ${upserted + errCount}/${dedupedValid.length}...\r`);
  }

  // ── Laporan akhir ──────────────────────────────────────────────
  const maxPoints = Math.max(...dedupedValid.map(c => c.visits * 10), 0);
  const avgVisits = (dedupedValid.reduce((s, c) => s + c.visits, 0) / dedupedValid.length).toFixed(1);

  console.log(`\n=== HASIL ===`);
  console.log(`  Berhasil upsert : ${upserted} member`);
  if (errCount) console.log(`  Error           : ${errCount} member`);
  console.log(`  Poin formula    : visits × 10`);
  console.log(`  Poin tertinggi  : ${maxPoints}`);
  console.log(`  Rata-rata visit : ${avgVisits}`);

  console.log(`\nTop 15 member by visits:`);
  console.log(
    '  ' + 'Nama'.padEnd(28) + ' ' + 'WA'.padEnd(15) + ' Visit   Poin   Last Visit'
  );
  console.log('  ' + '-'.repeat(72));
  dedupedValid
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15)
    .forEach((c, i) => {
      const name = (c.name || '-').slice(0, 27).padEnd(28);
      const wa   = (c.wa   || '-').slice(0, 14).padEnd(15);
      console.log(
        `  ${(i + 1).toString().padStart(2)}. ${name} ${wa} ${c.visits.toString().padStart(5)} ${(c.visits * 10).toString().padStart(6)}  ${c.last_visit || '-'}`
      );
    });
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
