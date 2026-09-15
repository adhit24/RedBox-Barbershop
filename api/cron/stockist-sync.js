'use strict';

/**
 * Vercel Cron — Stockist Moka sales recovery + daily movement refresh.
 *
 * Goals:
 * - pull paid Moka transactions in small pages (avoid per_page=1000 timeout)
 * - overlap previous successful cursor so transient gaps self-heal
 * - if an outlet is stale, recover from its latest APPROVED stock-opname baseline
 * - let processMokaSale enforce mapping, anomaly handling and idempotency
 * - stamp SALE_MOKA ledger rows with the Moka transaction's business time
 * - rebuild yesterday + today movement reports after each run
 */

const { createClient } = require('@supabase/supabase-js');
const MokaClient = require('../../server/moka/client');
const { processMokaSale } = require('../../server/services/stockistMokaSync');
const { aggregateDailyMovements, getWIBDate, getYesterdayWIBDate } = require('../../server/services/stockistDailyMovements');

const REDBOX_BRANCHES = ['bypass', 'samadikun', 'csb', 'sumber', 'tegal'];
const PAGE_SIZE = Math.max(25, Math.min(200, Number(process.env.STOCKIST_MOKA_PAGE_SIZE || 100)));
const OVERLAP_HOURS = Math.max(6, Number(process.env.STOCKIST_MOKA_OVERLAP_HOURS || 48));
const STALE_HOURS = Math.max(6, Number(process.env.STOCKIST_MOKA_STALE_HOURS || 24));
const MAX_PAGES = Math.max(5, Number(process.env.STOCKIST_MOKA_MAX_PAGES || 100));

function toEpochSeconds(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parseNextSince(nextUrl) {
  if (typeof nextUrl !== 'string') return null;
  const match = nextUrl.match(/[?&]since=([0-9.]+)/);
  return match ? Number(match[1]) : null;
}

async function loadOutletContext(supabase, outlet, ownerId) {
  const [{ data: location, error: locError }, { data: mappings, error: mapError }, { data: syncState }] = await Promise.all([
    supabase.from('inventory_locations').select('id').eq('outlet_id', outlet.id).maybeSingle(),
    supabase.from('moka_item_mappings')
      .select('moka_item_id,moka_variant_id,product_id,is_active,classification,outlet_id')
      .or(`outlet_id.eq.${outlet.id},outlet_id.is.null`),
    supabase.from('moka_stockist_sync_state').select('*').eq('outlet_id', outlet.id).maybeSingle(),
  ]);
  if (locError) throw new Error(`location lookup failed: ${locError.message}`);
  if (mapError) throw new Error(`mapping lookup failed: ${mapError.message}`);
  if (!location?.id) throw new Error('OUTLET_LOCATION_MAPPING_REQUIRED');

  const { data: baseline } = await supabase
    .from('stock_opnames')
    .select('approved_at')
    .eq('location_id', location.id)
    .eq('status', 'APPROVED')
    .not('approved_at', 'is', null)
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  const lastSuccessMs = syncState?.last_successful_sync_at ? new Date(syncState.last_successful_sync_at).getTime() : NaN;
  const isStale = !Number.isFinite(lastSuccessMs) || (now - lastSuccessMs) > STALE_HOURS * 3600000;

  let sinceMs;
  if (isStale && baseline?.approved_at) {
    // Physical stock-opname is authoritative. Never replay sales from before it
    // into the current balance; recover only movements after the baseline.
    sinceMs = new Date(baseline.approved_at).getTime();
  } else if (Number.isFinite(lastSuccessMs)) {
    sinceMs = lastSuccessMs - OVERLAP_HOURS * 3600000;
  } else {
    sinceMs = now - 72 * 3600000;
  }

  return {
    locationId: location.id,
    mappings: mappings || [],
    ownerId,
    syncState,
    baselineAt: baseline?.approved_at || null,
    sinceEpoch: Math.floor(sinceMs / 1000),
    isStale,
  };
}

async function stampSaleMovementTime(supabase, saleId, occurredAt) {
  if (!saleId || !occurredAt) return;
  const { data: items, error: itemError } = await supabase
    .from('moka_stockist_sale_items')
    .select('id')
    .eq('sale_id', saleId);
  if (itemError) throw new Error(`sale item lookup failed: ${itemError.message}`);
  const ids = (items || []).map(x => x.id);
  if (!ids.length) return;
  const { error } = await supabase
    .from('inventory_ledger')
    .update({ movement_at: occurredAt })
    .eq('reference_type', 'moka_stockist_sale_item')
    .in('reference_id', ids);
  if (error) throw new Error(`movement timestamp update failed: ${error.message}`);
}

async function syncOutlet(supabase, outlet, ownerId) {
  const ctx = await loadOutletContext(supabase, outlet, ownerId);
  const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
  const stats = {
    fetched: 0,
    processed: 0,
    skipped_duplicate: 0,
    ignored_non_stock: 0,
    unmapped: 0,
    anomalies: 0,
    qty_deducted: 0,
    pages: 0,
    page_size: PAGE_SIZE,
    recovery_from_baseline: ctx.isStale,
    baseline_at: ctx.baselineAt,
  };

  await supabase.from('moka_stockist_sync_state').upsert({
    outlet_id: outlet.id,
    last_started_at: new Date().toISOString(),
    last_status: 'RUNNING',
    last_error: null,
  }, { onConflict: 'outlet_id' });

  let sinceEpoch = ctx.sinceEpoch;
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const json = await client.getPaidTransactionsPage({ sinceEpoch, limit: PAGE_SIZE });
      if (!json || typeof json !== 'object' || !json.data || typeof json.data !== 'object') {
        throw new Error('Invalid Moka transaction response envelope');
      }
      const payments = Array.isArray(json.data.payments) ? json.data.payments : [];
      stats.pages += 1;
      if (!payments.length) break;

      for (const payment of payments) {
        if (payment?.is_deleted || payment?.is_refunded) continue;
        stats.fetched += 1;
        const result = await processMokaSale(supabase, {
          payment: { ...payment, status: payment.status || payment.transaction_status || 'PAID' },
          outlet,
          locationId: ctx.locationId,
          mappings: ctx.mappings,
          performedBy: ownerId,
        });

        const occurredAt = result?.transaction?.occurredAt || payment.transaction_date || payment.created_at || null;
        if (result.action === 'PROCESSED') {
          stats.processed += 1;
          stats.qty_deducted += result.quantityDeducted || 0;
          await stampSaleMovementTime(supabase, result.saleId, occurredAt);
        } else if (result.action === 'SKIPPED_DUPLICATE' || result.action === 'SKIPPED_EXISTING' || result.action === 'SKIPPED_CONCURRENT') {
          stats.skipped_duplicate += 1;
          if (result.saleId) await stampSaleMovementTime(supabase, result.saleId, occurredAt);
        } else if (result.action === 'SKIP' && result.reason === 'NO_STOCK_LINES') {
          stats.ignored_non_stock += 1;
        } else if (result.action === 'FAILED_MAPPING') {
          stats.unmapped += result.unmapped?.length || 0;
          stats.anomalies += 1;
        } else if (result.action === 'PARTIAL' || result.action === 'FAILED') {
          stats.anomalies += 1;
        }
      }

      if (json.data.completed === true) break;
      const nextSince = parseNextSince(json.data.next_url);
      if (!Number.isFinite(nextSince) || nextSince <= sinceEpoch) break;
      sinceEpoch = nextSince;
    }

    const finalStatus = stats.anomalies > 0 ? 'PARTIAL' : 'SUCCESS';
    const nowIso = new Date().toISOString();
    await supabase.from('moka_stockist_sync_state').upsert({
      outlet_id: outlet.id,
      last_status: finalStatus,
      last_error: null,
      last_successful_sync_at: nowIso,
      cursor_at: nowIso,
      last_run_stats: stats,
      updated_at: nowIso,
    }, { onConflict: 'outlet_id' });

    return { outlet: outlet.slug, ok: true, status: finalStatus, stats };
  } catch (error) {
    await supabase.from('moka_stockist_sync_state').upsert({
      outlet_id: outlet.id,
      last_status: 'FAILED',
      last_error: error.message,
      last_run_stats: stats,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'outlet_id' });
    return { outlet: outlet.slug, ok: false, status: 'FAILED', error: error.message, stats };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const token = req.query?.token || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (secret && !isVercelCron && token !== secret) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const [{ data: outlets, error: outletError }, { data: owner, error: ownerError }] = await Promise.all([
      supabase.from('outlets').select('id,slug,moka_outlet_id').in('slug', REDBOX_BRANCHES).eq('is_active', true),
      supabase.from('users').select('id').eq('role', 'owner').limit(1).maybeSingle(),
    ]);
    if (outletError) throw new Error(outletError.message);
    if (ownerError) throw new Error(ownerError.message);
    if (!owner?.id) throw new Error('STOCKIST_MOKA_SYNC_ACTOR_ID / owner user required');

    const results = [];
    // Sequential by design: protects Moka from burst traffic and keeps each
    // outlet's token/API traffic isolated.
    for (const outlet of outlets || []) {
      results.push(await syncOutlet(supabase, outlet, owner.id));
    }

    // Late Moka transactions are common; refresh both today and yesterday on
    // every successful polling cycle. Historical dates remain rebuildable via
    // the existing admin/cron endpoint with target_date.
    const movementResults = [];
    for (const date of [getYesterdayWIBDate(), getWIBDate()]) {
      try {
        movementResults.push(await aggregateDailyMovements(supabase, { targetDate: date }));
      } catch (error) {
        movementResults.push({ ok: false, target_date: date, error: error.message });
      }
    }

    const failed = results.filter(r => !r.ok).length;
    return res.status(failed ? 207 : 200).json({
      ok: failed === 0,
      page_size: PAGE_SIZE,
      outlets: results,
      daily_movements: movementResults.map(r => ({
        ok: r.ok,
        target_date: r.target_date,
        movements_processed: r.movements_processed,
        records_upserted: r.records_upserted,
        error: r.error,
      })),
      ts: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[StockistSyncCron] fatal:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
