/**
 * POST /api/moka/sync-member-points
 *
 * Tarik histori transaksi dari semua outlet Moka, hitung visits per customer,
 * lalu update total_points + total_visits di member_profiles yang sudah ACTIVE.
 *
 * Match: normalisasi phone → strip non-digit, hilangkan prefix 0/62 → bandingkan digit akhir 9-11 karakter.
 *
 * Formula poin: visits × 50  (sama dengan tier sistem member)
 * Tier:  0–499=bronze, 500–999=silver, 1000–2999=gold, 3000+=platinum
 *
 * Auth: x-admin-token header (ADMIN_PASSWORD env)
 * Query: dry_run=1 untuk preview tanpa update DB
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const MokaClient = require('../../server/moka/client');

const PAGE_DELAY_MS  = 150;
const MAX_BUDGET_MS  = 100_000;
const POINTS_PER_VISIT = 50;

const TIER_THRESHOLDS = [
  { name: 'platinum', min: 3000 },
  { name: 'gold',     min: 1000 },
  { name: 'silver',   min: 500  },
  { name: 'bronze',   min: 0    },
];

function getTier(points) {
  for (const t of TIER_THRESHOLDS) {
    if (points >= t.min) return t.name;
  }
  return 'bronze';
}

/** Normalisasi nomor → digit saja, tanpa leading 62/0, ambil 9-11 digit terakhir */
function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('62')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(-11); // ambil max 11 digit terakhir untuk keseragaman
}

/** Tarik semua transaksi satu outlet, akumulasi visits per phone */
async function fetchVisitsFromOutlet(client, mokaOutletId, startTime) {
  const visitMap = new Map(); // normalizedPhone → { visits, total_spent, last_visit, name }
  let sinceEpoch = null;
  let pageCount  = 0;

  while (true) {
    if (Date.now() - startTime > MAX_BUDGET_MS) {
      console.warn(`[SyncMemberPoints] ${mokaOutletId}: budget waktu habis setelah ${pageCount} halaman`);
      break;
    }

    let json;
    try {
      json = await client.getTransactionPage({ sinceEpoch, limit: 100 });
    } catch (err) {
      if (err.status === 404 || err.status === 403) break;
      throw err;
    }

    const payments = json?.data?.payments ?? [];
    for (const p of payments) {
      if (p.is_deleted || p.is_refunded) continue;
      const rawPhone = p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '';
      const norm = normalizePhone(rawPhone);
      if (!norm || norm.length < 8) continue;

      const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
      const amount = Number(p.total_collected || p.total_transaction || 0);

      if (!visitMap.has(norm)) {
        visitMap.set(norm, {
          visits: 0, total_spent: 0, last_visit: null,
          name: (p.customer_name || '').trim(),
        });
      }
      const entry = visitMap.get(norm);
      entry.visits++;
      entry.total_spent += amount;
      if (txDate && (!entry.last_visit || txDate > entry.last_visit)) entry.last_visit = txDate;
    }

    pageCount++;
    if (json?.data?.completed || !payments.length) break;

    const nextUrl = json?.data?.next_url || '';
    const m = nextUrl.match(/[?&]since=([0-9.]+)/);
    if (!m) break;
    sinceEpoch = parseFloat(m[1]);

    await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }

  console.log(`[SyncMemberPoints] Outlet ${mokaOutletId}: ${pageCount} hal → ${visitMap.size} phone unik`);
  return visitMap;
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  // Auth
  const adminPw    = process.env.ADMIN_PASSWORD;
  const cronSecret = process.env.CRON_SECRET;
  const token      = (req.headers['x-admin-token'] || '').trim();
  const bearer     = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (adminPw || cronSecret) {
    const ok = (adminPw   && (token === adminPw   || bearer === adminPw)) ||
               (cronSecret && (token === cronSecret || bearer === cronSecret));
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun    = req.query.dry_run === '1' || req.body?.dry_run === true;
  const startTime = Date.now();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
  );

  try {
    // 1. Load outlets
    const { data: outlets, error: outletErr } = await supabase
      .from('outlets')
      .select('id, slug, name, moka_outlet_id')
      .not('moka_outlet_id', 'is', null)
      .eq('is_active', true);

    if (outletErr) throw new Error('DB outlets: ' + outletErr.message);
    if (!outlets?.length) return res.status(200).json({ updated: 0, note: 'No active outlets with moka_outlet_id' });

    // 2. Load semua member_profiles ACTIVE
    const { data: members, error: memErr } = await supabase
      .from('member_profiles')
      .select('id, user_key, phone, full_name, total_points, total_visits, current_tier')
      .eq('membership_status', 'ACTIVE');

    if (memErr) throw new Error('DB member_profiles: ' + memErr.message);
    if (!members?.length) return res.status(200).json({ updated: 0, note: 'No active members' });

    // Buat lookup: normalizedPhone → member
    const memberLookup = new Map();
    for (const m of members) {
      const norm = normalizePhone(m.phone);
      if (norm && norm.length >= 8) memberLookup.set(norm, m);
    }

    // 3. Tarik semua transaksi dari setiap outlet, akumulasi ke globalVisitMap
    const globalVisitMap = new Map(); // normalizedPhone → { visits, total_spent, last_visit }
    for (const outlet of outlets) {
      if (Date.now() - startTime > MAX_BUDGET_MS) break;
      const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
      let outletMap;
      try {
        outletMap = await fetchVisitsFromOutlet(client, outlet.moka_outlet_id, startTime);
      } catch (err) {
        console.error(`[SyncMemberPoints] Outlet ${outlet.slug} error: ${err.message}`);
        continue;
      }
      for (const [norm, data] of outletMap) {
        if (!globalVisitMap.has(norm)) {
          globalVisitMap.set(norm, { visits: 0, total_spent: 0, last_visit: null });
        }
        const g = globalVisitMap.get(norm);
        g.visits      += data.visits;
        g.total_spent += data.total_spent;
        if (data.last_visit && (!g.last_visit || data.last_visit > g.last_visit)) g.last_visit = data.last_visit;
      }
    }

    // 4. Match member ke Moka visits → hitung poin baru
    const updates   = [];
    const unmatched = [];
    for (const [norm, member] of memberLookup) {
      const mokaData = globalVisitMap.get(norm);
      if (!mokaData) {
        unmatched.push({ name: member.full_name, phone: member.phone });
        continue;
      }
      const newVisits = mokaData.visits;
      const newPoints = newVisits * POINTS_PER_VISIT;
      const newTier   = getTier(newPoints);
      updates.push({
        id:           member.id,
        full_name:    member.full_name,
        phone:        member.phone,
        old_points:   member.total_points,
        old_visits:   member.total_visits,
        old_tier:     member.current_tier,
        new_points:   newPoints,
        new_visits:   newVisits,
        new_tier:     newTier,
        last_visit:   mokaData.last_visit,
      });
    }

    if (dryRun) {
      return res.status(200).json({
        dry_run:        true,
        members_active: members.length,
        outlets_scanned: outlets.map(o => o.slug),
        matched:        updates.length,
        unmatched:      unmatched.length,
        preview:        updates.slice(0, 20),
        unmatched_list: unmatched,
      });
    }

    // 5. Batch update member_profiles
    let successCount = 0;
    let errorCount   = 0;
    const now = new Date().toISOString();

    for (const u of updates) {
      const { error } = await supabase
        .from('member_profiles')
        .update({
          total_points:  u.new_points,
          total_visits:  u.new_visits,
          current_tier:  u.new_tier,
          updated_at:    now,
        })
        .eq('id', u.id);

      if (error) {
        console.error(`[SyncMemberPoints] Update ${u.full_name}: ${error.message}`);
        errorCount++;
      } else {
        successCount++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[SyncMemberPoints] Selesai. Updated: ${successCount}, Error: ${errorCount}, Waktu: ${elapsed}s`);

    return res.status(200).json({
      success:         true,
      updated:         successCount,
      errors:          errorCount,
      unmatched:       unmatched.length,
      unmatched_list:  unmatched,
      outlets_scanned: outlets.map(o => o.slug),
      elapsed_s:       parseFloat(elapsed),
      summary: updates.map(u => ({
        name:       u.full_name,
        phone:      u.phone,
        visits:     u.new_visits,
        points:     u.new_points,
        tier:       u.new_tier,
        tier_changed: u.old_tier !== u.new_tier,
      })),
    });

  } catch (err) {
    console.error('[SyncMemberPoints] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
