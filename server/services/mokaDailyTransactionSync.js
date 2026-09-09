'use strict';

const MokaClient = require('../moka/client');
const { matchBarberName } = require('../moka/txSync');
const { logSystemEvent } = require('./systemEventLog');

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

async function fetchOutletDayRange({ supabase, outlet, businessDates, clientFactory, maxPages = MAX_PAGES }) {
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

function sameMetrics(a, b) {
  return ['net_sales', 'gross_sales', 'discounts', 'refunds', 'transaction_count']
    .every(key => amount(a?.[key]) === amount(b?.[key]));
}

async function upsertChunks(supabase, rows) {
  for (let index = 0; index < rows.length; index += 500) {
    const persistedRows = rows.slice(index, index + 500).map(({ _barber_items, ...row }) => row);
    const { error } = await supabase.from('moka_transactions')
      .upsert(persistedRows, { onConflict: 'receipt_number', ignoreDuplicates: false });
    if (error) throw error;
  }
}

async function upsertBarberServices(supabase, rows, barbers) {
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
    const revenueShare = matched.size > 0 ? Math.round(amount(row.net_sales) / matched.size) : 0;
    for (const [barberId, item] of matched) {
      serviceRows.push({
        receipt_number: row.receipt_number,
        outlet_slug: row.outlet_slug,
        tx_date: row.tx_date,
        barber_id: barberId,
        barber_name_raw: item.name,
        service_name: item.services.join(', '),
        revenue_share: revenueShare,
      });
    }
  }
  for (let index = 0; index < serviceRows.length; index += 500) {
    const { error } = await supabase.from('moka_barber_services')
      .upsert(serviceRows.slice(index, index + 500), { onConflict: 'receipt_number,barber_id', ignoreDuplicates: false });
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

  const settled = await Promise.all(REDBOX_OUTLET_SLUGS.map(async slug => {
    const outlet = bySlug.get(slug);
    if (!outlet) return { slug, error: 'outlet_not_configured' };
    try {
      const result = await fetchOutletDayRange({ supabase, outlet, businessDates, clientFactory });
      let servicesUpserted = 0;
      if (!dryRun) {
        await upsertChunks(supabase, result.rows);
        servicesUpserted = await upsertBarberServices(supabase, result.rows, barbers || []);
      }
      return { slug, ...result, servicesUpserted };
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
      let canonicalRows = projectedRows;
      if (!dryRun) {
        const { data: persisted, error } = await supabase.from('moka_transactions')
          .select('receipt_number,outlet_slug,tx_date,net_sales,gross_sales,"Discounts","Refunds","Event Type"')
          .eq('outlet_slug', result.slug).eq('tx_date', businessDate);
        if (error) {
          failed.push({ slug: result.slug, error: `canonical_read_failed: ${error.message}` });
          continue;
        }
        canonicalRows = persisted || [];
      }
      const aggregate = aggregateRows(canonicalRows, businessDate, result.slug);
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
      const { error: aggregateError } = await supabase.from('business_performance_daily')
        .upsert(aggregate, { onConflict: 'business_date,branch_slug', ignoreDuplicates: false });
      if (aggregateError) failed.push({ slug: result.slug, error: `aggregate_upsert_failed: ${aggregateError.message}` });
      else if (seeded?.source === 'moka_csv') reconciliations.push({ business_date: businessDate, branch_slug: result.slug, status: 'matched' });
    }
  }

  const uniqueFailures = [...new Map(failed.map(item => [`${item.slug}:${item.error}`, item])).values()];
  const status = uniqueFailures.length
    ? (successful.length ? 'PARTIAL' : 'FAILED')
    : reconciliations.some(item => item.status === 'protected_mismatch') ? 'PARTIAL' : 'SUCCESS';
  const summary = {
    status,
    dry_run: dryRun,
    business_dates: businessDates,
    outlets_requested: REDBOX_OUTLET_SLUGS.length,
    outlets_succeeded: successful.length,
    transactions_fetched: settled.reduce((sum, item) => sum + (item.fetched || 0), 0),
    transactions_upserted: dryRun ? 0 : successful.reduce((sum, item) => sum + (item.accepted || 0), 0),
    aggregates_updated: dryRun ? 0 : aggregates.length - reconciliations.filter(item => item.status === 'protected_mismatch').length,
    duration_ms: Date.now() - startedAt,
    outlets: settled.map(item => ({ slug: item.slug, pages: item.pages || 0, rows_fetched: item.fetched || 0, rows_accepted: item.accepted || 0, rows_skipped: item.skipped || 0, services_upserted: item.servicesUpserted || 0, error: item.error || null })),
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
      transactions_upserted: summary.transactions_upserted, aggregates_updated: summary.aggregates_updated,
      error_summary: uniqueFailures.map(item => ({ outlet: item.slug, error: item.error })), dry_run: dryRun,
    },
  }, { supabase });
  return summary;
}

module.exports = {
  JAKARTA_TIME_ZONE, REDBOX_OUTLET_SLUGS, MAX_PAGES, PAGE_SIZE,
  jakartaDate, resolveBusinessDates, normalizeMokaPayment, fetchOutletDayRange,
  aggregateRows, sameMetrics, upsertBarberServices, syncMokaDailyTransactions,
};
