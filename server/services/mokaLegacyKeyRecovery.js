'use strict';

// Recovers NULL tx_date / outlet_slug on legacy public.moka_transactions rows using the Moka
// API as the only authority, matched strictly on receipt_number (the payment UUID).
// Never overwrites a non-null value, never guesses, never touches other columns or tables.

const { fetchOutletDayRange, REDBOX_OUTLET_SLUGS } = require('./mokaDailyTransactionSync');

const isNullRow = row => row.tx_date === null || row.tx_date === undefined
  || row.outlet_slug === null || row.outlet_slug === undefined;

function indexApiRows(apiRows) {
  const index = new Map();
  for (const row of apiRows) {
    if (!row.receipt_number || !row.tx_date || !row.outlet_slug) continue;
    const key = `${row.tx_date}|${row.outlet_slug}`;
    const entry = index.get(row.receipt_number) || new Map();
    entry.set(key, { tx_date: row.tx_date, outlet_slug: row.outlet_slug });
    index.set(row.receipt_number, entry);
  }
  return index;
}

/**
 * legacyRows: { receipt_number, tx_date, outlet_slug } from public.moka_transactions
 * apiRows:    normalized API rows { receipt_number, tx_date, outlet_slug }
 */
function classifyLegacyRecovery({ legacyRows, apiRows }) {
  const index = indexApiRows(apiRows);
  const result = { recoverable: [], ambiguous: [], notFound: [], alreadyValid: [], conflicts: [] };
  for (const legacy of legacyRows) {
    const candidates = index.get(legacy.receipt_number);
    const needsRecovery = isNullRow(legacy);
    if (!candidates) {
      if (needsRecovery) result.notFound.push({ receipt_number: legacy.receipt_number, reason: 'not_in_api_window' });
      continue;
    }
    if (candidates.size > 1) {
      if (needsRecovery) result.ambiguous.push({ receipt_number: legacy.receipt_number, reason: 'multiple_api_matches', candidates: [...candidates.keys()] });
      continue;
    }
    const [api] = candidates.values();
    const disagreements = [];
    if (legacy.tx_date && legacy.tx_date !== api.tx_date) disagreements.push({ field: 'tx_date', legacy: legacy.tx_date, api: api.tx_date });
    if (legacy.outlet_slug && legacy.outlet_slug !== api.outlet_slug) disagreements.push({ field: 'outlet_slug', legacy: legacy.outlet_slug, api: api.outlet_slug });
    if (disagreements.length) {
      result.conflicts.push({ receipt_number: legacy.receipt_number, disagreements, was_null_row: needsRecovery });
      if (needsRecovery) result.ambiguous.push({ receipt_number: legacy.receipt_number, reason: 'conflicts_with_existing_value', disagreements });
      continue;
    }
    if (!needsRecovery) { result.alreadyValid.push({ receipt_number: legacy.receipt_number }); continue; }
    result.recoverable.push({
      receipt_number: legacy.receipt_number,
      tx_date: api.tx_date,
      outlet_slug: api.outlet_slug,
      set_tx_date: !legacy.tx_date,
      set_outlet_slug: !legacy.outlet_slug,
    });
  }
  return result;
}

async function fetchApiRows({ supabase, businessDates, clientFactory }) {
  const { data: outlets, error } = await supabase.from('outlets')
    .select('id,slug,moka_outlet_id').in('slug', REDBOX_OUTLET_SLUGS).eq('is_active', true).not('moka_outlet_id', 'is', null);
  if (error) throw error;
  const results = await Promise.all((outlets || []).map(outlet => fetchOutletDayRange({ supabase, outlet, businessDates, clientFactory })));
  return {
    outlets: results.map(r => ({ slug: r.outlet.slug, pages: r.pages, fetched: r.fetched, accepted: r.accepted })),
    rows: results.flatMap(r => r.rows.map(({ receipt_number, tx_date, outlet_slug }) => ({ receipt_number, tx_date, outlet_slug }))),
  };
}

async function readLegacyRows(supabase, apiReceipts) {
  const columns = 'receipt_number,tx_date,outlet_slug';
  const byReceipt = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('moka_transactions').select(columns)
      .or('tx_date.is.null,outlet_slug.is.null').order('receipt_number').range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) byReceipt.set(row.receipt_number, row);
    if (!data || data.length < 1000) break;
  }
  const receipts = [...apiReceipts];
  for (let i = 0; i < receipts.length; i += 100) {
    const { data, error } = await supabase.from('moka_transactions').select(columns).in('receipt_number', receipts.slice(i, i + 100));
    if (error) throw error;
    for (const row of data || []) byReceipt.set(row.receipt_number, row);
  }
  return [...byReceipt.values()];
}

async function planRecovery({ supabase, businessDates, clientFactory }) {
  const api = await fetchApiRows({ supabase, businessDates, clientFactory });
  const legacyRows = await readLegacyRows(supabase, new Set(api.rows.map(r => r.receipt_number)));
  return { api, legacyRows, ...classifyLegacyRecovery({ legacyRows, apiRows: api.rows }) };
}

/** Groups recoverable rows so each UPDATE only fills columns that are still NULL. */
async function applyRecovery({ supabase, recoverable }) {
  const groups = new Map();
  for (const item of recoverable) {
    const key = [item.tx_date, item.outlet_slug, item.set_tx_date, item.set_outlet_slug].join('|');
    if (!groups.has(key)) groups.set(key, { ...item, receipts: [] });
    groups.get(key).receipts.push(item.receipt_number);
  }
  let updated = 0;
  for (const group of groups.values()) {
    for (let i = 0; i < group.receipts.length; i += 100) {
      const patch = {};
      if (group.set_tx_date) patch.tx_date = group.tx_date;
      if (group.set_outlet_slug) patch.outlet_slug = group.outlet_slug;
      let query = supabase.from('moka_transactions').update(patch).in('receipt_number', group.receipts.slice(i, i + 100));
      if (group.set_tx_date) query = query.is('tx_date', null);
      if (group.set_outlet_slug) query = query.is('outlet_slug', null);
      const { data, error } = await query.select('receipt_number');
      if (error) throw error;
      updated += (data || []).length;
    }
  }
  return updated;
}

module.exports = { classifyLegacyRecovery, planRecovery, applyRecovery, fetchApiRows };
