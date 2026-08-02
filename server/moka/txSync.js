'use strict';
const MokaClient = require('./client');

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

  const client     = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
  let   page       = 1;
  let   totalTx    = 0;
  let   totalSvc   = 0;

  while (true) {
    let json;
    try {
      json = await client.getPaidTransactionsPage({ page, perPage: 1000 });
    } catch (err) {
      if (err.status === 404 || err.status === 403) break;
      throw err;
    }

    const payments = json?.data?.transactions ?? [];
    if (!payments.length) break;

    // Log first payment shape on first page to help verify field names
    if (page === 1 && payments.length > 0) {
      console.log(`[TxSync] ${outlet.slug} — sample payment keys:`, Object.keys(payments[0]).join(', '));
    }

    const txRows  = [];
    const svcRows = [];

    for (const p of payments) {
      if (p.is_deleted || p.is_refunded) continue;
      const receiptNumber = p.receipt_number || p.receipt_no || p.id;
      if (!receiptNumber) continue;

      const createdAt = p.created_at || p.updated_at || '';
      const txDate    = createdAt.slice(0, 10);
      const txTime    = createdAt.slice(11, 19);
      if (createdAt && new Date(createdAt).getTime() < sinceEpochStart * 1000) continue;

      // items_raw: probe multiple candidate field names
      const rawItems = p.item_details || p.items || p.order_items || p.line_items || '';
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
          if (!matched) continue;
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

    if (json?.data?.completed || payments.length < 1000) break;
    const totalPages = Number(json?.data?.total_pages || 0);
    if (totalPages && page >= totalPages) break;
    page += 1;
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`[TxSync] ${outlet.slug} — ${totalTx} tx, ${totalSvc} svc upserted`);
  return { totalTx, totalSvc };
}

module.exports = { syncCurrentMonthTx };
