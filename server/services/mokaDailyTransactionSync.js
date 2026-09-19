'use strict';

const MokaClient = require('../moka/client');
const { matchBarberName } = require('../moka/txSync');
const { logSystemEvent } = require('./systemEventLog');
const { normalizeTransactionPackage } = require('./mokaTransactionNormalizer');

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';
const REDBOX_OUTLET_SLUGS = Object.freeze(['bypass', 'csb', 'samadikun', 'sumber', 'tegal']);
const MAX_PAGES = 100;
const PAGE_SIZE = 1000;

function jakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return jakartaDate(date);
}

function resolveBusinessDates({ now = new Date(), date } = {}) {
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || jakartaDate(new Date(`${date}T00:00:00+07:00`)) !== date) {
      throw Object.assign(new Error('date must be a valid YYYY-MM-DD business date'), { code: 'INVALID_DATE' });
    }
    return [date];
  }
  const today = jakartaDate(now);
  return [shiftDate(today, -1), shiftDate(today, -2)];
}

function amount(value) {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + amount(
      item?.amount ?? item?.discount_amount ?? item?.refund_amount ?? item?.value ?? 0,
    ), 0);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function paymentDate(payment) {
  const iso = payment.created_at || payment.synchronized_at || payment.updated_at;
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return jakartaDate(parsed);
  }
  const display = String(payment.transaction_date || '').trim();
  const match = display.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (match) {
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const month = months[match[2]];
    if (month) return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
  }
  return null;
}

function normalizeMokaPayment(payment, outletSlug) {
  // Moka's report payload uses the globally unique payment UUID as `id`.
  // Keep it in the legacy receipt_number column so the existing unique index
  // remains the single idempotency authority across outlets and corrections.
  const receiptNumber = payment.id || payment.receipt_number || payment.receipt_no;
  const txDate = paymentDate(payment);
  if (!receiptNumber || !txDate) return null;

  const subtotal = amount(payment.subtotal ?? payment.net_sales ?? payment.total_collected);
  const reportedDiscounts = Math.max(amount(payment.discounts), amount(payment.payment_discounts));
  const checkoutGross = Array.isArray(payment.checkouts)
    ? payment.checkouts.reduce((sum, item) => sum + (
      amount(item?.item_price_quantity)
      || (amount(item?.price ?? item?.item_price) * amount(item?.quantity || 1))
      || amount(item?.total_price)
    ), 0)
    : 0;
  // In the verified v3 report payload `subtotal` is already after discount.
  // Checkout item_price_quantity retains the pre-discount value and therefore
  // reconciles with Moka CSV Gross Sales. Fall back to subtotal + discount for
  // payload variants without checkout detail.
  const grossSales = amount(payment.gross_sales) || checkoutGross || (subtotal + reportedDiscounts);
  const discounts = Math.max(reportedDiscounts, grossSales - subtotal, 0);
  const refunds = Math.max(
    amount(payment.total_refund), amount(payment.refund_amount), amount(payment.payment_refunds),
  );
  const isVoid = Boolean(payment.is_deleted) || String(payment.transaction_status || '').toUpperCase() === 'VOID';
  const netSales = isVoid ? 0 : amount(
    payment.net_sales !== undefined && payment.net_sales !== null
      ? payment.net_sales
      : subtotal - refunds,
  );
  const createdAt = payment.created_at || payment.synchronized_at || payment.updated_at || '';
  const txTime = /^\d{4}-\d{2}-\d{2}T/.test(createdAt)
    ? new Intl.DateTimeFormat('en-GB', { timeZone: JAKARTA_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(createdAt))
    : String(payment.transaction_time || '');
  const eventType = isVoid ? 'Void' : refunds > 0 ? 'Payment with Refund' : 'Payment';

  return {
    receipt_number: String(receiptNumber),
    outlet_slug: outletSlug,
    tx_date: txDate,
    tx_time: txTime,
    net_sales: netSales,
    gross_sales: grossSales,
    total_collected: amount(payment.total_collected),
    payment_method: String(payment.payment_type_label || payment.payment_type || payment.payment_method || ''),
    collected_by: String(payment.collected_by || ''),
    items_raw: Array.isArray(payment.checkouts) ? JSON.stringify(payment.checkouts) : '',
    imported_at: new Date().toISOString(),
    'Gross Sales': grossSales,
    Discounts: discounts,
    Refunds: refunds,
    'Net Sales': netSales,
    'Receipt Number': String(receiptNumber),
    'Payment Method': String(payment.payment_type_label || payment.payment_type || payment.payment_method || ''),
    'Event Type': eventType,
    _barber_items: Array.isArray(payment.checkouts)
      ? payment.checkouts.map(item => ({
        name: String(item?.name || item?.item_name || '').trim(),
        service: String(item?.variant_name || item?.item_variant_name || item?.service || '').trim(),
      })).filter(item => item.name && item.service)
      : [],
  };
}

function nextSince(nextUrl) {
  if (typeof nextUrl !== 'string') return null;
  const match = nextUrl.match(/[?&]since=([0-9.]+)/);
  return match ? Number(match[1]) : null;
}

async function fetchOutletDayRange({
  supabase,
  outlet,
  businessDates,
  clientFactory,
  maxPages = MAX_PAGES,
  mappingsMap = new Map(),
  barbers = [],
}) {
  const firstDate = [...businessDates].sort()[0];
  let sinceEpoch = Math.floor(new Date(`${firstDate}T00:00:00+07:00`).getTime() / 1000);
  const wanted = new Set(businessDates);
  const seenCursors = new Set();
  const rowsByReceipt = new Map();
  let fetched = 0;
  let skipped = 0;
  let pages = 0;
  let completed = false;
  const client = clientFactory
    ? clientFactory(outlet)
    : new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);

  while (pages < maxPages) {
    pages += 1;
    const response = await client.getPaidTransactionsPage({ sinceEpoch, limit: PAGE_SIZE });
    const data = response?.data;
    if (!data || !Array.isArray(data.payments) || typeof data.completed !== 'boolean') {
      throw new Error(`Invalid Moka transaction envelope for ${outlet.slug} page ${pages}`);
    }
    fetched += data.payments.length;
    for (const payment of data.payments) {
      const row = normalizeMokaPayment(payment, outlet.slug);
      if (!row || !wanted.has(row.tx_date)) {
        skipped += 1;
        continue;
      }
      const pkg = normalizeTransactionPackage(payment, outlet, mappingsMap, barbers);
      if (pkg && pkg.items) {
        row._normalized_items = pkg.items;
      }
      rowsByReceipt.set(row.receipt_number, row);
    }
    if (data.completed) {
      completed = true;
      break;
    }
    const cursor = nextSince(data.next_url);
    if (!Number.isFinite(cursor) || seenCursors.has(cursor)) {
      throw new Error(`Incomplete or repeated Moka cursor for ${outlet.slug} page ${pages}`);
    }
    seenCursors.add(cursor);
    sinceEpoch = cursor;
  }
  if (!completed) throw new Error(`Moka pagination exceeded ${maxPages} pages for ${outlet.slug}`);

  return { outlet, pages, fetched, accepted: rowsByReceipt.size, skipped, rows: [...rowsByReceipt.values()] };
}

function aggregateRows(rows, businessDate, branchSlug) {
  const selected = rows.filter(row => row.tx_date === businessDate && row.outlet_slug === branchSlug);
  return selected.reduce((result, row) => {
    result.net_sales += amount(row.net_sales ?? row['Net Sales']);
    result.gross_sales += amount(row.gross_sales ?? row['Gross Sales']);
    result.discounts += amount(row.Discounts);
    result.refunds += amount(row.Refunds);
    const event = String(row['Event Type'] || 'Payment').toLowerCase();
    if (event.startsWith('payment')) result.transaction_count += 1;
    return result;
  }, {
    business_date: businessDate,
    branch_slug: branchSlug,
    net_sales: 0,
    gross_sales: 0,
    discounts: 0,
    refunds: 0,
    transaction_count: 0,
    source: 'moka_api',
    imported_at: new Date().toISOString(),
  });
}

/**
 * Canonical arithmetic (Task 2.1C authority: public.moka_transaction_items).
 * Verified against live Moka payloads for 2026-09-16..18: SUM(net_amount) and
 * SUM(gross_amount) equal the receipt-level Net/Gross Sales exactly (tax and
 * gratuity live in their own columns and are not part of net_amount). Item
 * discount_amount is NOT used: it under-reports receipt-level discounts, so
 * discounts are derived as gross - net, the same identity Moka reports.
 */
function aggregateItems(items, businessDate, branchSlug) {
  const live = (items || []).filter(item => item.tx_date === businessDate
    && item.outlet_slug === branchSlug && !item.is_deleted);
  const receipts = new Set();
  let gross = 0; let net = 0; let refunds = 0;
  for (const item of live) {
    receipts.add(item.receipt_number);
    gross += amount(item.gross_amount);
    net += amount(item.net_amount);
    const quantity = amount(item.quantity);
    if (quantity > 0 && amount(item.refunded_quantity) > 0) {
      refunds += Math.round(amount(item.net_amount) * Math.min(amount(item.refunded_quantity), quantity) / quantity);
    }
  }
  return {
    business_date: businessDate,
    branch_slug: branchSlug,
    net_sales: net,
    gross_sales: gross,
    discounts: Math.max(gross - net, 0),
    refunds,
    transaction_count: receipts.size,
    source: 'moka_api',
    imported_at: new Date().toISOString(),
  };
}

async function readCanonicalItems(supabase, branchSlug, businessDate) {
  const items = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('moka_transaction_items')
      .select('receipt_number,outlet_slug,tx_date,gross_amount,net_amount,quantity,refunded_quantity,is_deleted')
      .eq('outlet_slug', branchSlug).eq('tx_date', businessDate)
      .order('receipt_number').order('source_line_key')
      .range(from, from + pageSize - 1);
    if (error) return { error };
    items.push(...(data || []));
    if (!data || data.length < pageSize) return { items };
  }
}

const isZeroAggregate = aggregate => amount(aggregate.net_sales) === 0 && amount(aggregate.transaction_count) === 0;

/**
 * Zero-overwrite guard. A zero aggregate may only be persisted when the
 * canonical sources genuinely hold no transactions for the date/branch and it
 * would not wipe an existing non-zero row.
 */
function zeroOverwriteBlocker(aggregate, { canonicalReceipts = 0, existing = null } = {}) {
  if (!isZeroAggregate(aggregate)) return null;
  if (canonicalReceipts > 0) return 'canonical_transactions_exist';
  if (existing && (amount(existing.net_sales) !== 0 || amount(existing.transaction_count) !== 0)) return 'would_overwrite_non_zero_row';
  return null;
}

function sameMetrics(a, b) {
  return ['net_sales', 'gross_sales', 'discounts', 'refunds', 'transaction_count']
    .every(key => amount(a?.[key]) === amount(b?.[key]));
}

async function upsertChunks(supabase, rows) {
  for (let index = 0; index < rows.length; index += 500) {
    const persistedRows = rows.slice(index, index + 500).map(({ _barber_items, _normalized_items, ...row }) => row);
    const { error } = await supabase.from('moka_transactions')
      .upsert(persistedRows, { onConflict: 'receipt_number', ignoreDuplicates: false });
    if (error) throw error;
  }
}

async function upsertTransactionItems(supabase, items) {
  if (!items || !items.length) return 0;
  for (let index = 0; index < items.length; index += 500) {
    const chunk = items.slice(index, index + 500).map(({ commission_base, ...item }) => item);
    const { error } = await supabase.from('moka_transaction_items')
      .upsert(chunk, { onConflict: 'outlet_id,receipt_number,source_line_key', ignoreDuplicates: false });
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('[MokaSync] moka_transaction_items table not present in Postgres schema — skipping table write');
        return 0;
      }
      throw error;
    }
  }
  return items.length;
}

async function upsertBarberServices(supabase, rows, barbers) {
  // Task 2.1B (single-writer remediation): this is now the ONLY writer of
  // moka_barber_services (server/moka/txSync.js's syncCurrentMonthTx used to
  // write here too, with its own independent equal-split arithmetic — a P1
  // data-integrity bug, see commit history). revenue_share is deliberately
  // never computed here anymore: "net_sales / distinct barber count" folds
  // retail/drink line items into the shared total and divides it across
  // every barber on a receipt regardless of who actually performed which
  // service — exactly the outcome Task 2.1B forbids. This column is kept
  // (not dropped) for backward-compatible reads but always written as NULL;
  // real commission must be computed by
  // server/services/commissionCalculator.js, which knows how to mark a
  // multi-barber/mixed-item receipt REVIEW_REQUIRED instead of guessing.
  const serviceRows = [];
  for (const row of rows) {
    const matched = new Map();
    for (const item of row._barber_items || []) {
      const barber = matchBarberName(item.name, barbers, row.outlet_slug);
      if (!barber) continue;
      const current = matched.get(barber.id) || { name: item.name, services: [] };
      current.services.push(item.service);
      matched.set(barber.id, current);
    }
    for (const [barberId, item] of matched) {
      serviceRows.push({
        receipt_number: row.receipt_number,
        outlet_slug: row.outlet_slug,
        tx_date: row.tx_date,
        barber_id: barberId,
        barber_name_raw: item.name,
        service_name: item.services.join(', '),
        revenue_share: null,
      });
    }
  }
  // Task 2.1B root-cause fix: the live moka_barber_services table has NO
  // unique constraint on (receipt_number, barber_id) — only on
  // (receipt_number, barber_name_raw, service_name)
  // (moka_barber_services_receipt_number_barber_name_raw_service_key,
  // confirmed via pg_constraint). Upserting with onConflict:
  // 'receipt_number,barber_id' is invalid against this schema and Postgres
  // rejects EVERY such statement with "no unique or exclusion constraint
  // matching the ON CONFLICT specification" — this was the actual cause of
  // zero rows being written by every cron run logged since 2026-09-08 (187
  // consecutive failures). Using the real constraint here is a correctness
  // fix, not a schema change.
  for (let index = 0; index < serviceRows.length; index += 500) {
    const { error } = await supabase.from('moka_barber_services')
      .upsert(serviceRows.slice(index, index + 500), { onConflict: 'receipt_number,barber_name_raw,service_name', ignoreDuplicates: false });
    if (error) throw error;
  }
  return serviceRows.length;
}

async function syncMokaDailyTransactions({
  supabase,
  now = new Date(),
  date,
  dryRun = false,
  clientFactory,
  eventLogger = logSystemEvent,
} = {}) {
  if (!supabase) throw new Error('supabase is required');
  const startedAt = Date.now();
  const businessDates = resolveBusinessDates({ now, date });
  const { data: outlets, error: outletError } = await supabase.from('outlets')
    .select('id,slug,moka_outlet_id')
    .in('slug', REDBOX_OUTLET_SLUGS)
    .eq('is_active', true)
    .not('moka_outlet_id', 'is', null);
  if (outletError) throw outletError;
  const bySlug = new Map((outlets || []).map(outlet => [outlet.slug, outlet]));
  const { data: barbers, error: barberError } = await supabase.from('barbers')
    .select('id,name,branch').eq('is_active', true);
  if (barberError) throw barberError;

  const { data: mappingsData } = await supabase.from('moka_item_mappings').select('*');
  const mappingsMap = new Map();
  for (const m of mappingsData || []) {
    if (m.outlet_id && m.moka_item_id && m.moka_variant_id) {
      mappingsMap.set(`${m.outlet_id}:${m.moka_item_id}:${m.moka_variant_id}`, m);
    }
    if (m.moka_item_id && m.moka_variant_id) {
      mappingsMap.set(`${m.moka_item_id}:${m.moka_variant_id}`, m);
    }
  }

  const settled = await Promise.all(REDBOX_OUTLET_SLUGS.map(async slug => {
    const outlet = bySlug.get(slug);
    if (!outlet) return { slug, error: 'outlet_not_configured' };
    try {
      const result = await fetchOutletDayRange({
        supabase, outlet, businessDates, clientFactory, mappingsMap, barbers: barbers || [],
      });
      let servicesUpserted = 0;
      let itemsUpserted = 0;
      if (!dryRun) {
        await upsertChunks(supabase, result.rows);
        servicesUpserted = await upsertBarberServices(supabase, result.rows, barbers || []);
        const allItems = result.rows.flatMap(r => r._normalized_items || []);
        itemsUpserted = await upsertTransactionItems(supabase, allItems);
      }
      return { slug, ...result, servicesUpserted, itemsUpserted };
    } catch (error) {
      return { slug, error: error.message };
    }
  }));

  const successful = settled.filter(result => !result.error);
  const failed = settled.filter(result => result.error);
  const projectedRows = successful.flatMap(result => result.rows);
  const aggregates = [];
  const reconciliations = [];

  for (const result of successful) {
    for (const businessDate of businessDates) {
      const fetchedRows = result.rows.filter(row => row.tx_date === businessDate);
      let aggregate;
      let canonicalReceipts = fetchedRows.length;
      if (dryRun) {
        aggregate = aggregateRows(projectedRows, businessDate, result.slug);
      } else {
        // moka_transactions is NOT the aggregate authority: its
        // trg_sync_moka_csv_columns trigger nulls tx_date/outlet_slug on API rows.
        const { items, error } = await readCanonicalItems(supabase, result.slug, businessDate);
        if (error) {
          failed.push({ slug: result.slug, error: `canonical_read_failed: ${error.message}` });
          continue;
        }
        const fromItems = aggregateItems(items, businessDate, result.slug);
        // Receipts without checkout detail have no item rows; the freshly
        // fetched API payload is the fallback only when it holds more receipts.
        aggregate = fromItems.transaction_count >= fetchedRows.length
          ? fromItems : aggregateRows(result.rows, businessDate, result.slug);
        canonicalReceipts = Math.max(fromItems.transaction_count, fetchedRows.length);
      }
      aggregates.push(aggregate);
      if (dryRun) continue;

      const { data: seeded, error: seededError } = await supabase.from('business_performance_daily')
        .select('*').eq('business_date', businessDate).eq('branch_slug', result.slug).maybeSingle();
      if (seededError) {
        failed.push({ slug: result.slug, error: `aggregate_read_failed: ${seededError.message}` });
        continue;
      }
      if (seeded?.source === 'moka_csv' && !sameMetrics(seeded, aggregate)) {
        reconciliations.push({
          business_date: businessDate,
          branch_slug: result.slug,
          status: 'protected_mismatch',
          differences: Object.fromEntries(['net_sales', 'gross_sales', 'discounts', 'refunds', 'transaction_count']
            .filter(key => amount(seeded[key]) !== amount(aggregate[key]))
            .map(key => [key, { seeded: amount(seeded[key]), api: amount(aggregate[key]), delta: amount(aggregate[key]) - amount(seeded[key]) }])),
        });
        continue;
      }
      const blocked = zeroOverwriteBlocker(aggregate, { canonicalReceipts, existing: seeded });
      if (blocked) {
        aggregates.pop();
        reconciliations.push({ business_date: businessDate, branch_slug: result.slug, status: 'zero_overwrite_blocked', reason: blocked });
        continue;
      }
      const { error: aggregateError } = await supabase.from('business_performance_daily')
        .upsert(aggregate, { onConflict: 'business_date,branch_slug', ignoreDuplicates: false });
      if (aggregateError) failed.push({ slug: result.slug, error: `aggregate_upsert_failed: ${aggregateError.message}` });
      else if (seeded?.source === 'moka_csv') reconciliations.push({ business_date: businessDate, branch_slug: result.slug, status: 'matched' });
    }
  }

  const uniqueFailures = [...new Map(failed.map(item => [`${item.slug}:${item.error}`, item])).values()];
  const status = uniqueFailures.length
    ? (successful.length ? 'PARTIAL' : 'FAILED')
    : reconciliations.some(item => item.status === 'protected_mismatch' || item.status === 'zero_overwrite_blocked') ? 'PARTIAL' : 'SUCCESS';
  const summary = {
    status,
    dry_run: dryRun,
    business_dates: businessDates,
    outlets_requested: REDBOX_OUTLET_SLUGS.length,
    outlets_succeeded: successful.length,
    transactions_fetched: settled.reduce((sum, item) => sum + (item.fetched || 0), 0),
    transactions_upserted: dryRun ? 0 : successful.reduce((sum, item) => sum + (item.accepted || 0), 0),
    items_upserted: dryRun ? 0 : successful.reduce((sum, item) => sum + (item.itemsUpserted || 0), 0),
    aggregates_updated: dryRun ? 0 : aggregates.length - reconciliations.filter(item => item.status === 'protected_mismatch').length,
    duration_ms: Date.now() - startedAt,
    outlets: settled.map(item => ({ slug: item.slug, pages: item.pages || 0, rows_fetched: item.fetched || 0, rows_accepted: item.accepted || 0, rows_skipped: item.skipped || 0, services_upserted: item.servicesUpserted || 0, items_upserted: item.itemsUpserted || 0, error: item.error || null })),
    errors: uniqueFailures,
    reconciliations,
    aggregates,
  };

  await eventLogger({
    module: 'moka', eventName: 'MOKA_DAILY_TRANSACTION_SYNC', eventType: 'MOKA_DAILY_TRANSACTION_SYNC',
    severity: status === 'FAILED' ? 'ERROR' : status === 'PARTIAL' ? 'WARNING' : 'INFO',
    status: status.toLowerCase(), source: 'cron', durationMs: summary.duration_ms,
    message: `Moka daily transaction sync ${status.toLowerCase()}`,
    metadata: {
      business_dates: businessDates, outlets_requested: summary.outlets_requested,
      outlets_succeeded: summary.outlets_succeeded, transactions_fetched: summary.transactions_fetched,
      transactions_upserted: summary.transactions_upserted, items_upserted: summary.items_upserted,
      aggregates_updated: summary.aggregates_updated,
      error_summary: uniqueFailures.map(item => ({ outlet: item.slug, error: item.error })), dry_run: dryRun,
    },
  }, { supabase });
  return summary;
}

module.exports = {
  JAKARTA_TIME_ZONE, REDBOX_OUTLET_SLUGS, MAX_PAGES, PAGE_SIZE,
  jakartaDate, shiftDate, resolveBusinessDates, normalizeMokaPayment, fetchOutletDayRange,
  aggregateRows, aggregateItems, readCanonicalItems, zeroOverwriteBlocker, sameMetrics, upsertBarberServices, syncMokaDailyTransactions,
};
