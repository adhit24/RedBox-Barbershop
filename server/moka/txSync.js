'use strict';
const MokaClient = require('./client');
const { processMokaSale } = require('../services/stockistMokaSync');

// ── helpers (copied from server/scripts/importAllTransaksi.js) ─────────────
function extractBarberItems(itemsRaw) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of (itemsRaw || '')) {
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

// Guards against the exact failure mode that caused the 2026-09 production
// incident: a broken/wrong endpoint returning something that isn't the
// documented `{ data: { payments: [...] } }` envelope (empty object,
// `{ data: null }`, a non-JSON body surfaced as `{ raw: '...' }` by
// MokaClient._req, etc.) must never be silently treated as "zero
// transactions" — it must fail loudly so a real outage is visible instead
// of looking like a clean, empty, successful sync.
function validateMokaTransactionPage(json, context) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw Object.assign(new Error(`Invalid Moka response for ${context}: not a JSON object`), { code: 'INVALID_MOKA_RESPONSE' });
  }
  if (json.raw !== undefined && json.data === undefined) {
    throw Object.assign(new Error(`Invalid Moka response for ${context}: non-JSON response body`), { code: 'INVALID_MOKA_RESPONSE' });
  }
  const data = json.data;
  if (data === undefined || data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error(`Invalid Moka response for ${context}: missing/invalid data envelope`), { code: 'INVALID_MOKA_RESPONSE' });
  }
  if (data.payments !== undefined && !Array.isArray(data.payments)) {
    throw Object.assign(new Error(`Invalid Moka response for ${context}: data.payments is not an array`), { code: 'INVALID_MOKA_RESPONSE' });
  }
  return data;
}

function matchBarberName(rawName, barbers, preferBranch) {
  const lower = (rawName || '').toLowerCase().trim();
  for (const b of barbers) {
    if (preferBranch && b.branch !== preferBranch) continue;
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  for (const b of barbers) {
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  const fuzzyCandidates = preferBranch
    ? barbers.filter(b => b.branch === preferBranch)
    : barbers;
  let best = null, bestDist = 3;
  for (const b of fuzzyCandidates) {
    const fw = b.name.split(' ')[0].toLowerCase();
    const d  = editDist(lower, fw);
    if (d < bestDist || (d === bestDist && preferBranch && b.branch === preferBranch)) {
      bestDist = d; best = b;
    }
  }
  return best;
}

// ── main ───────────────────────────────────────────────────────────────────

/**
 * Sync all Moka transactions for the current calendar month to moka_transactions.
 * Safe to call multiple times — upserts on receipt_number.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ id: string, slug: string, moka_outlet_id: string }} outlet
 * @param {{ sinceEpoch?: number }} [options] - Optional lower bound for near-live syncs
 */
async function syncCurrentMonthTx(supabase, outlet, options = {}) {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  // WIB is UTC+7 — subtract 7h to get UTC midnight of first day WIB
  const monthStartEpoch = Math.floor((first.getTime() - 7 * 3600 * 1000) / 1000);
  const sinceEpochStart = Number.isFinite(options.sinceEpoch)
    ? options.sinceEpoch
    : monthStartEpoch;

  // Load active barbers once for fuzzy matching
  const { data: barbers } = await supabase
    .from('barbers').select('id, name, branch').eq('is_active', true);
  const activeBarbers = barbers || [];

  // Enabled by default — every live entry point (external cron, manual sync
  // buttons) should decrement Stockist stock, not just the in-process
  // node-cron worker. In a serverless deployment that worker's timer is not
  // guaranteed to stay alive, so opt-in-per-caller left the bridge dead in
  // production even after it was wired into startCronJobs(). Opt out
  // explicitly (options.stockistSalesSync === false, or the env var) during
  // rollback/maintenance. The bridge itself is fail-closed on missing actor,
  // location, or mapping — enabling it here cannot silently mutate stock.
  const stockistSalesSync = options.stockistSalesSync !== false
    && process.env.STOCKIST_MOKA_SALES_SYNC_ENABLED !== 'false';
  let stockistPerformedBy = options.stockistPerformedBy || process.env.STOCKIST_MOKA_SYNC_ACTOR_ID || null;
  let stockistLocationId = null;
  let stockistMappings = [];
  if (stockistSalesSync && !stockistPerformedBy) {
    const { data: actor } = await supabase.from('users').select('id').eq('role', 'owner').limit(1).maybeSingle();
    stockistPerformedBy = actor?.id || null;
  }
  if (stockistSalesSync && stockistPerformedBy) {
    const [{ data: location }, { data: mappings, error: mappingError }] = await Promise.all([
      supabase.from('inventory_locations').select('id').eq('outlet_id', outlet.id).maybeSingle(),
      supabase.from('moka_item_mappings').select('moka_item_id, moka_variant_id, product_id')
        .eq('is_active', true).or(`outlet_id.eq.${outlet.id},outlet_id.is.null`),
    ]);
    if (mappingError) throw new Error(`Stockist Moka mapping lookup failed: ${mappingError.message}`);
    stockistLocationId = location?.id || null;
    stockistMappings = mappings || [];
  }

  // Per-run tallies for the Owner Dashboard "Moka Sync Status" card and for
  // reconciliation — moka_stockist_sync_state previously existed but nothing
  // ever wrote to it, so Last Sync/Status/Processed/Unmapped/Errors had no
  // source to render from.
  const stockistStats = {
    fetched: 0, processed: 0, skipped_duplicate: 0, unmapped: 0, anomalies: 0, qty_deducted: 0,
  };
  if (stockistSalesSync && stockistPerformedBy) {
    await supabase.from('moka_stockist_sync_state').upsert({
      outlet_id: outlet.id, last_started_at: new Date().toISOString(), last_status: 'RUNNING',
    }, { onConflict: 'outlet_id' });
  }

  const client     = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
  let   sinceEpoch = sinceEpochStart;
  let   pageNum    = 1;
  let   totalTx    = 0;
  let   totalSvc   = 0;
  const unmatchedNames = new Set();

  try {
  while (true) {
    let json;
    try {
      json = await client.getPaidTransactionsPage({ sinceEpoch, limit: 1000 });
    } catch (err) {
      // A fetch failure must never look like "zero transactions". This is
      // the exact bug that let the bridge run silently empty for weeks:
      // 404/403 used to be caught here and treated as pagination-complete
      // instead of a real sync failure. Every status (401/403/404/429/5xx)
      // is now surfaced with outlet/page/date-range context and propagated
      // to the outer catch below, which records last_status=FAILED.
      throw Object.assign(
        new Error(`[TxSync] ${outlet.slug} page ${pageNum} (since=${sinceEpoch}): ${err.message}`),
        { status: err.status, code: err.code || 'MOKA_FETCH_FAILED', outlet: outlet.slug, page: pageNum, sinceEpoch }
      );
    }

    const data = validateMokaTransactionPage(json, `${outlet.slug} page ${pageNum}`);
    const payments = data.payments ?? [];
    if (!payments.length) break;

    // Log first payment shape on first page to help verify field names
    if (pageNum === 1 && payments.length > 0) {
      console.log(`[TxSync] ${outlet.slug} — sample payment keys:`, Object.keys(payments[0]).join(', '));
    }

    const txRows  = [];
    const svcRows = [];

    for (const p of payments) {
      if (p.is_deleted || p.is_refunded) continue;
      const receiptNumber = p.receipt_number || p.receipt_no || p.id;
      if (!receiptNumber) continue;

      const createdAt = p.transaction_date || p.transaction_time || p.created_at || p.updated_at || '';
      const txDate    = createdAt.slice(0, 10);
      const txTime    = createdAt.slice(11, 19);
      if (createdAt && new Date(createdAt).getTime() < sinceEpochStart * 1000) continue;

      if (stockistSalesSync && stockistPerformedBy) {
        stockistStats.fetched += 1;
        const stockistResult = await processMokaSale(supabase, {
          payment: { ...p, status: p.status || p.transaction_status || 'PAID' },
          outlet,
          locationId: stockistLocationId,
          mappings: stockistMappings,
          performedBy: stockistPerformedBy,
        });
        if (stockistResult.action === 'PROCESSED') {
          stockistStats.processed += 1;
          stockistStats.qty_deducted += stockistResult.quantityDeducted || 0;
        } else if (stockistResult.action === 'SKIPPED_DUPLICATE') {
          stockistStats.skipped_duplicate += 1;
        } else if (stockistResult.action === 'FAILED_MAPPING') {
          stockistStats.unmapped += stockistResult.unmapped?.length || 0;
          stockistStats.anomalies += 1;
        } else if (stockistResult.action === 'PARTIAL'
          || (stockistResult.action === 'FAILED' && stockistResult.errorCode === 'OUTLET_LOCATION_MAPPING_REQUIRED')) {
          stockistStats.anomalies += 1;
        }
        if (stockistResult.action !== 'PROCESSED' && stockistResult.action !== 'SKIPPED_DUPLICATE') {
          console.warn(`[StockistMoka] ${outlet.slug} ${receiptNumber}: ${stockistResult.action}`);
        }
      }

      // items_raw: checkouts[] is the confirmed field name (see
      // server/moka/sync.js's proven order.checkouts usage); other names
      // kept as fallback in case a different Moka payload shape is seen.
      const rawItems = p.checkouts || p.item_details || p.items || p.order_items || p.line_items || '';
      const itemsRaw = Array.isArray(rawItems)
        ? rawItems.map(i => `${i.name || i.item_name || ''}(${i.variant_name || i.service || ''})`).join(', ')
        : (rawItems || '');

      txRows.push({
        receipt_number:  String(receiptNumber),
        outlet_slug:     outlet.slug,
        tx_date:         txDate,
        tx_time:         txTime,
        net_sales:       Number(p.net_sales   || 0),
        gross_sales:     Number(p.gross_sales || 0),
        total_collected: Number(p.total_collected || p.total_transaction || 0),
        payment_method:  String(p.payment_type || p.payment_method || ''),
        collected_by:    String(p.collected_by || ''),
        items_raw:       itemsRaw,
      });

      if (itemsRaw) {
        const barberItems  = extractBarberItems(itemsRaw);
        const seenBarbers  = new Map();
        for (const item of barberItems) {
          const matched = matchBarberName(item.name, activeBarbers, outlet.slug);
          if (!matched) { unmatchedNames.add(item.name); continue; }
          if (!seenBarbers.has(matched.id)) seenBarbers.set(matched.id, { csvName: item.name, services: [] });
          seenBarbers.get(matched.id).services.push(item.service);
        }
        const netSales    = Number(p.net_sales || 0);
        const revShare    = seenBarbers.size > 0 ? Math.round(netSales / seenBarbers.size) : 0;
        for (const [barberId, { csvName, services }] of seenBarbers) {
          svcRows.push({
            receipt_number:  String(receiptNumber),
            outlet_slug:     outlet.slug,
            tx_date:         txDate,
            barber_id:       barberId,
            barber_name_raw: csvName,
            service_name:    services.join(', '),
            revenue_share:   revShare,
          });
        }
      }
    }

    if (txRows.length) {
      const { error } = await supabase.from('moka_transactions')
        .upsert(txRows, { onConflict: 'receipt_number', ignoreDuplicates: false });
      if (error) console.error(`[TxSync] ${outlet.slug} tx upsert:`, error.message);
      else totalTx += txRows.length;
    }
    if (svcRows.length) {
      const { error } = await supabase.from('moka_barber_services')
        .upsert(svcRows, { onConflict: 'receipt_number,barber_id', ignoreDuplicates: false });
      if (error) console.error(`[TxSync] ${outlet.slug} svc upsert:`, error.message);
      else totalSvc += svcRows.length;
    }

    if (data.completed || payments.length < 1000) break;
    const nextMatch = typeof data.next_url === 'string' ? data.next_url.match(/[?&]since=([0-9.]+)/) : null;
    if (!nextMatch) break;
    sinceEpoch = parseFloat(nextMatch[1]);
    pageNum += 1;
    await new Promise(r => setTimeout(r, 150));
  }
  } catch (err) {
    if (stockistSalesSync && stockistPerformedBy) {
      await supabase.from('moka_stockist_sync_state').upsert({
        outlet_id: outlet.id, last_status: 'FAILED', last_error: err.message,
        last_run_stats: stockistStats, updated_at: new Date().toISOString(),
      }, { onConflict: 'outlet_id' });
    }
    throw err;
  }

  if (stockistSalesSync && stockistPerformedBy) {
    const hadAnomalies = stockistStats.anomalies > 0;
    await supabase.from('moka_stockist_sync_state').upsert({
      outlet_id: outlet.id,
      last_status: hadAnomalies ? 'PARTIAL' : 'SUCCESS',
      last_error: null,
      last_successful_sync_at: new Date().toISOString(),
      cursor_at: new Date().toISOString(),
      last_run_stats: stockistStats,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'outlet_id' });
  }

  console.log(`[TxSync] ${outlet.slug} — ${totalTx} tx, ${totalSvc} svc upserted`);
  return { totalTx, totalSvc, unmatchedNames: [...unmatchedNames].slice(0, 20) };
}

module.exports = { syncCurrentMonthTx };
