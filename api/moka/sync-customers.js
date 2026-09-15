/**
 * Shared Moka maintenance function.
 * - /api/moka/sync-customers: customer CRM sync
 * - /api/cron/stockist-sync (rewrite with mode=stockist_sync): resilient Stockist sales recovery
 */

const { createClient } = require('@supabase/supabase-js');
const MokaClient = require('../../server/moka/client');
const { stockistSalesRecoveryHandler } = require('../../server/services/stockistSalesRecoveryCron');

const BATCH_SIZE = 50;
const PAGE_DELAY_MS = 150;
const MAX_BUDGET_MS = 90_000;

function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;
  if (digits.startsWith('62')) return '+' + digits;
  if (digits.startsWith('0')) return '+62' + digits.slice(1);
  if (digits.length >= 9) return '+62' + digits;
  return null;
}

async function fetchCustomersFromTransactions(client, mokaOutletId, startTime) {
  const customerMap = new Map();
  let sinceEpoch = null;
  let pageCount = 0;

  while (true) {
    if (Date.now() - startTime > MAX_BUDGET_MS) {
      console.warn(`[SyncCustomers] ${mokaOutletId}: time budget hit after ${pageCount} pages`);
      break;
    }

    let json;
    try {
      json = await client.getTransactionPage({ sinceEpoch, limit: 100 });
    } catch (err) {
      if (err.status === 404 || err.status === 403) {
        console.warn(`[SyncCustomers] ${mokaOutletId} page ${pageCount}: HTTP ${err.status} — stopping`);
        break;
      }
      throw err;
    }

    const payments = json?.data?.payments ?? [];
    for (const p of payments) {
      if (p.customer_id) {
        const cid = String(p.customer_id);
        if (!customerMap.has(cid)) {
          customerMap.set(cid, {
            moka_customer_id: cid,
            name: (p.customer_name || 'Unknown').trim(),
            phone: p.customer_phone || null,
            email: p.customer_email || null,
          });
        }
      }
    }

    pageCount++;
    if (json?.data?.completed) break;
    if (!payments.length) break;
    const nextUrl = json?.data?.next_url || '';
    const m = nextUrl.match(/[?&]since=([0-9.]+)/);
    if (!m) break;
    sinceEpoch = parseFloat(m[1]);
    await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }

  console.log(`[SyncCustomers] Outlet ${mokaOutletId}: ${pageCount} pages → ${customerMap.size} unique customers`);
  return Array.from(customerMap.values());
}

module.exports = async function handler(req, res) {
  // Consolidated entry point keeps the Hobby deployment under the 12-function limit.
  if (req.query?.mode === 'stockist_sync') {
    return stockistSalesRecoveryHandler(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  const adminPw = process.env.ADMIN_PASSWORD;
  const authHeader = req.headers['authorization'];
  const xAdminToken = req.headers['x-admin-token'];

  if (cronSecret || adminPw) {
    const bearer = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    const ok = (cronSecret && (bearer === cronSecret || xAdminToken === cronSecret)) ||
      (adminPw && (bearer === adminPw || xAdminToken === adminPw));
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun = req.query.dry_run === '1' || req.body?.dry_run === true;
  const onlySlug = req.query.outlet || req.body?.outlet || null;
  const startTime = Date.now();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
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

    const globalMap = new Map();
    for (const outlet of outlets) {
      const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
      const customers = await fetchCustomersFromTransactions(client, outlet.moka_outlet_id, startTime);
      for (const c of customers) {
        if (!globalMap.has(c.moka_customer_id)) globalMap.set(c.moka_customer_id, c);
      }
      if (Date.now() - startTime > MAX_BUDGET_MS) {
        console.warn('[SyncCustomers] Time budget hit — stopping outlet loop early');
        break;
      }
    }

    const mokaCustomers = Array.from(globalMap.values());
    console.log(`[SyncCustomers] Total unik dari ${outlets.length} outlet: ${mokaCustomers.length} customers`);

    if (dryRun) {
      return res.status(200).json({
        dry_run: true,
        total_from_moka: mokaCustomers.length,
        outlets_scanned: outlets.map(o => o.slug),
        sample: mokaCustomers.slice(0, 5),
      });
    }

    if (!mokaCustomers.length) {
      return res.status(200).json({ synced: 0, total_from_moka: 0, note: 'No customers found in transactions' });
    }

    let totalSynced = 0;
    let totalFailed = 0;

    for (let i = 0; i < mokaCustomers.length; i += BATCH_SIZE) {
      const batch = mokaCustomers.slice(i, i + BATCH_SIZE);
      const rows = batch.map(c => {
        const phone = toE164(c.phone);
        const waRaw = phone ? phone.replace('+', '') : null;
        return {
          name: c.name,
          wa: waRaw,
          phone_e164: phone,
          email: c.email || null,
          source: 'moka',
          moka_customer_id: c.moka_customer_id,
        };
      });

      const { error: upsertErr } = await supabase
        .from('customers')
        .upsert(rows, { onConflict: 'moka_customer_id', ignoreDuplicates: false });

      if (upsertErr) {
        console.error(`[SyncCustomers] Batch ${i}–${i + BATCH_SIZE} error: ${upsertErr.message}`);
        totalFailed += rows.length;
      } else {
        totalSynced += rows.length;
        console.log(`[SyncCustomers] Batch ${i}–${i + rows.length} OK`);
      }

      for (const r of rows) {
        if (r.phone_e164 && r.moka_customer_id) {
          await supabase
            .from('customers')
            .update({ moka_customer_id: r.moka_customer_id, source: 'moka' })
            .eq('phone_e164', r.phone_e164)
            .is('moka_customer_id', null)
            .then(() => {});
        }
      }
    }

    console.log(`[SyncCustomers] Selesai. Synced: ${totalSynced}, Failed: ${totalFailed}`);
    return res.status(200).json({
      synced: totalSynced,
      failed: totalFailed,
      total_from_moka: mokaCustomers.length,
      dry_run: false,
    });
  } catch (err) {
    console.error('[SyncCustomers] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
