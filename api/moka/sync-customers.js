/**
 * POST /api/moka/sync-customers  — pull semua customer dari Moka → Supabase
 * Bisa dipanggil manual dari admin panel atau via cron harian.
 *
 * Query params:
 *   outlet   (optional) — slug outlet, default semua outlet aktif
 *   dry_run  (optional) — '1' hanya hitung, tidak upsert
 */

const { createClient } = require('@supabase/supabase-js');
const MokaClient = require('../../server/moka/client');
const { getAccessToken } = require('../../server/moka/oauth');

const BATCH_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────

function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;
  if (digits.startsWith('62')) return '+' + digits;
  if (digits.startsWith('0'))  return '+62' + digits.slice(1);
  if (digits.length >= 9)      return '+62' + digits;
  return null;
}

// Moka birthday comes as "YYYY-MM-DD" or null — convert to MM-DD for our birthday cron
function toMMDD(birthday) {
  if (!birthday) return null;
  const m = String(birthday).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  const m2 = String(birthday).match(/^(\d{2})-(\d{2})$/);
  if (m2) return birthday;
  return null;
}

// Paginate through all Moka customers for a given outlet
async function fetchAllMokaCustomers(client) {
  const customers = [];
  let page = 1;
  let totalPages = 1;

  do {
    let json;
    try {
      json = await client.getCustomers({ page, perPage: 100 });
    } catch (err) {
      // 404 / 403 — business ID mismatch or no access; stop gracefully
      if (err.status === 404 || err.status === 403) {
        console.warn(`[SyncCustomers] getCustomers page ${page}: HTTP ${err.status} — stopping pagination`);
        break;
      }
      throw err;
    }

    // Moka can return: { data: { customers: [...], meta: {...} } }
    //               or: { data: [...], meta: {...} }
    const rows = json?.data?.customers ?? json?.data ?? [];
    const meta = json?.data?.meta     ?? json?.meta  ?? {};

    if (Array.isArray(rows)) customers.push(...rows);

    totalPages = Number(meta.total_pages ?? meta.last_page ?? 1) || 1;

    if (page < totalPages) await new Promise(r => setTimeout(r, 250)); // gentle rate limit
    page++;
  } while (page <= totalPages);

  return customers;
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun  = req.query.dry_run === '1' || req.body?.dry_run === true;
  const onlySlug = req.query.outlet || req.body?.outlet || null;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    // 1. Load outlets
    let outletQuery = supabase
      .from('outlets')
      .select('id, slug, name, moka_outlet_id')
      .not('moka_outlet_id', 'is', null)
      .eq('is_active', true);

    if (onlySlug) outletQuery = outletQuery.eq('slug', onlySlug);

    const { data: outlets, error: outletErr } = await outletQuery;
    if (outletErr) throw new Error('DB outlets: ' + outletErr.message);
    if (!outlets?.length) {
      return res.status(200).json({ synced: 0, note: 'No active outlets with moka_outlet_id' });
    }

    console.log(`[SyncCustomers] Outlets: ${outlets.map(o => o.slug).join(', ')}`);

    // 2. Fetch semua customer dari Moka
    // Customer endpoint adalah business-level — cukup panggil sekali via outlet pertama
    const primary = outlets[0];
    const client  = new MokaClient(supabase, primary.id, primary.moka_outlet_id);

    console.log(`[SyncCustomers] Fetching from Moka (businessId=${process.env.MOKA_BUSINESS_ID || primary.moka_outlet_id})...`);
    const mokaCustomers = await fetchAllMokaCustomers(client);
    console.log(`[SyncCustomers] Total dari Moka: ${mokaCustomers.length} customers`);

    if (dryRun) {
      return res.status(200).json({
        dry_run: true,
        total_from_moka: mokaCustomers.length,
        sample: mokaCustomers.slice(0, 3),
      });
    }

    if (!mokaCustomers.length) {
      return res.status(200).json({ synced: 0, total_from_moka: 0, note: 'Moka returned 0 customers' });
    }

    // 3. Upsert ke Supabase dalam batch
    let totalSynced = 0;
    let totalFailed = 0;

    for (let i = 0; i < mokaCustomers.length; i += BATCH_SIZE) {
      const batch = mokaCustomers.slice(i, i + BATCH_SIZE);

      const rows = batch
        .filter(c => c?.id)
        .map(c => {
          const phone = toE164(c.phone_number || c.phone);
          const waRaw = phone ? phone.replace('+', '') : null;
          return {
            name:             (c.name || c.customer_name || 'Unknown').trim(),
            wa:               waRaw,
            phone_e164:       phone,
            email:            c.email || null,
            birthday:         toMMDD(c.birthday || c.birth_date),
            source:           'moka',
            moka_customer_id: String(c.id),
          };
        });

      if (!rows.length) continue;

      const { error: upsertErr } = await supabase
        .from('customers')
        .upsert(rows, { onConflict: 'moka_customer_id', ignoreDuplicates: false });

      if (upsertErr) {
        console.error(`[SyncCustomers] Batch ${i}–${i + BATCH_SIZE} error: ${upsertErr.message}`);
        totalFailed += rows.length;
      } else {
        totalSynced += rows.length;
        console.log(`[SyncCustomers] Batch ${i}–${i + rows.length} OK (${rows.length} rows)`);
      }

      // Lanjut link customer Moka ke customer web yang sudah ada lewat phone_e164
      // agar data tidak duplikat (web customer yang belum punya moka_customer_id)
      const phoneBatch = rows
        .filter(r => r.phone_e164 && r.moka_customer_id)
        .map(r => ({ phone_e164: r.phone_e164, moka_customer_id: r.moka_customer_id }));

      for (const { phone_e164, moka_customer_id } of phoneBatch) {
        await supabase
          .from('customers')
          .update({ moka_customer_id, source: 'moka' })
          .eq('phone_e164', phone_e164)
          .is('moka_customer_id', null)
          .then(() => {});  // fire-and-forget, ignore errors
      }
    }

    console.log(`[SyncCustomers] Selesai. Synced: ${totalSynced}, Failed: ${totalFailed}`);
    return res.status(200).json({
      synced:          totalSynced,
      failed:          totalFailed,
      total_from_moka: mokaCustomers.length,
      dry_run:         false,
    });

  } catch (err) {
    console.error('[SyncCustomers] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
