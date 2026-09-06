'use strict';

const { applyInventoryMovement } = require('./stockistInventory');

const FINAL_STATUSES = new Set(['PAID', 'COMPLETED', 'CLOSED', 'SETTLED', 'SUCCESS']);

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function normalizeMokaStatus(payment) {
  return String(firstValue(payment?.status, payment?.transaction_status, payment?.payment_status, 'UNKNOWN'))
    .trim().toUpperCase();
}

function isFinalMokaTransaction(payment) {
  if (payment?.is_deleted || payment?.is_refunded || payment?.voided || payment?.is_void) return false;
  // Moka's v3 Report API (get_latest_transactions) — the endpoint this
  // bridge fetches from — never includes a status field; it only ever
  // returns settled transactions, and voids are signaled purely via
  // is_deleted/is_refunded (confirmed by the proven order-sync handling in
  // server/moka/sync.js:525-528, which drives 260k+ successful syncs).
  // Absence of any status-like field therefore means "final", not
  // "unknown, so skip" — treating it as skip is what silently dropped
  // every real transaction even after the fetch layer was fixed.
  const hasStatusField = payment?.status !== undefined
    || payment?.transaction_status !== undefined
    || payment?.payment_status !== undefined;
  if (!hasStatusField) return true;
  return FINAL_STATUSES.has(normalizeMokaStatus(payment));
}

function normalizeMokaTransaction(payment, outlet) {
  const externalId = firstValue(payment?.id, payment?.transaction_id, payment?.order_id,
    payment?.receipt_number, payment?.receipt_no);
  const receiptNumber = firstValue(payment?.receipt_number, payment?.receipt_no, externalId);
  const occurredAt = firstValue(payment?.transaction_date, payment?.transaction_time, payment?.created_at, payment?.updated_at);
  return {
    externalId: externalId == null ? null : String(externalId),
    receiptNumber: receiptNumber == null ? null : String(receiptNumber),
    outletId: outlet?.id || null,
    outletSlug: outlet?.slug || null,
    status: normalizeMokaStatus(payment),
    occurredAt,
    isFinal: isFinalMokaTransaction(payment),
  };
}

function normalizeMokaLine(line) {
  if (typeof line === 'string') return { mokaItemId: null, mokaVariantId: null, name: line, quantity: 1 };
  const quantity = Number(firstValue(line?.quantity, line?.qty, line?.count, 1));
  return {
    mokaItemId: firstValue(line?.item_id, line?.itemId, line?.moka_item_id, line?.id),
    // item_variant_id is the confirmed candidate for checkouts[] line items
    // (mirrors item_id's naming convention); item_variant_name/variant_name
    // are name-only fields seen in the proven order-sync path (server/moka/
    // sync.js's _mapOrderItems) and are not IDs, but kept as a last resort
    // in case a numeric variant id truly isn't present on a given payload.
    mokaVariantId: firstValue(line?.item_variant_id, line?.variant_id, line?.variantId, line?.moka_variant_id),
    name: firstValue(line?.item_variant_name, line?.variant_name, line?.name, line?.item_name, line?.product_name),
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
  };
}

function extractMokaSaleLines(payment) {
  // checkouts[] is the confirmed field name for a Moka v3 report payment's
  // line items (see server/moka/sync.js's proven `order.checkouts` usage,
  // which drives 260k+ successful production syncs). Other names are kept
  // as fallback for any differently-shaped payload.
  const raw = firstValue(payment?.checkouts, payment?.item_details, payment?.items, payment?.order_items, payment?.line_items);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeMokaLine);
  return String(raw).split(',').map((name) => normalizeMokaLine(name.trim())).filter((line) => line.name);
}

function buildMokaSalePlan(payment, outlet, { locationId, mappings = [] } = {}) {
  const transaction = normalizeMokaTransaction(payment, outlet);
  if (!transaction.externalId) return { action: 'FAILED', errorCode: 'MOKA_TRANSACTION_ID_REQUIRED', transaction };
  if (!transaction.isFinal) return { action: 'SKIP', reason: 'NOT_FINAL', transaction };
  if (!locationId) return { action: 'FAILED', errorCode: 'OUTLET_LOCATION_MAPPING_REQUIRED', transaction };

  const mappingByKey = new Map();
  for (const mapping of mappings) {
    const key = `${mapping.moka_item_id || ''}:${mapping.moka_variant_id || ''}`;
    mappingByKey.set(key, mapping);
  }
  // NON_STOCK_SERVICE/NON_STOCK_MISC classified lines (haircuts, grooming
  // packages, drinks, food, tips, membership tiers, custom amounts) are
  // dropped entirely before mapping is even evaluated — they must never
  // count as "unmapped" (no anomaly) or be attempted for deduction. Only
  // an explicit, active STOCK_PRODUCT classification pointing at a real
  // product counts as mapped; a real product whose mapping was disabled
  // for unrelated reasons still falls through to the unmapped/anomaly
  // path so it doesn't silently vanish.
  const rawLines = extractMokaSaleLines(payment).map((line) => {
    const exact = mappingByKey.get(`${line.mokaItemId || ''}:${line.mokaVariantId || ''}`);
    const itemOnly = mappingByKey.get(`${line.mokaItemId || ''}:`);
    const mapping = exact || itemOnly || null;
    // classification is NOT NULL with a STOCK_PRODUCT default in the
    // database (every real row always has a value); treat it as
    // STOCK_PRODUCT when genuinely absent from the object too, so any
    // caller building a mapping row without the field keeps prior
    // behavior instead of silently losing every mapping.
    const classification = mapping?.classification ?? 'STOCK_PRODUCT';
    const isStockProduct = Boolean(mapping) && classification === 'STOCK_PRODUCT' && mapping.is_active !== false && mapping.product_id;
    const isKnownNonStock = Boolean(mapping) && (classification === 'NON_STOCK_SERVICE' || classification === 'NON_STOCK_MISC');
    return { ...line, productId: isStockProduct ? mapping.product_id : null, mapped: isStockProduct, ignored: isKnownNonStock };
  });
  const lines = rawLines.filter((line) => !line.ignored);
  if (!lines.length) {
    // A transaction made up entirely of known non-stock lines (a plain
    // haircut, a drink-only sale) is the common case for a barbershop —
    // that is a clean no-op, not a data failure, and must never be
    // reported or counted as one.
    if (rawLines.length > 0) return { action: 'SKIP', reason: 'NO_STOCK_LINES', transaction };
    return { action: 'FAILED', errorCode: 'MOKA_LINE_ITEMS_REQUIRED', transaction, lines: rawLines };
  }
  if (lines.some((line) => !line.quantity || line.quantity <= 0)) {
    return { action: 'FAILED', errorCode: 'MOKA_INVALID_LINE_QUANTITY', transaction, lines };
  }
  const unmapped = lines.filter((line) => !line.mapped);
  if (unmapped.length) return { action: 'FAILED_MAPPING', transaction, lines, unmapped };
  return { action: 'PROCESS', transaction, lines };
}

// Anomaly rows are dedupe-checked (not upserted on a unique constraint)
// because the underlying failures — an unmapped item, an outlet with no
// location — recur every time the same still-broken transaction is
// refetched within the current sync window, and nothing else marks that
// transaction as "already seen" the way a persisted sale row does.
async function recordAnomalyOnce(supabase, match, insert) {
  let query = supabase.from('moka_stockist_anomalies').select('id').eq('status', 'OPEN');
  for (const [key, value] of Object.entries(match)) {
    query = value === null ? query.is(key, null) : query.eq(key, value);
  }
  const { data: existing } = await query.limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase
    .from('moka_stockist_anomalies')
    .insert({ ...match, ...insert })
    .select('id')
    .single();
  if (error) { console.warn('[StockistMoka] failed to record anomaly:', error.message); return null; }
  return created.id;
}

async function recordUnknownOutletAnomaly(supabase, outlet, transaction) {
  return recordAnomalyOnce(
    supabase,
    { outlet_id: outlet?.id || null, anomaly_type: 'UNKNOWN_OUTLET', moka_item_id: null, moka_variant_id: null },
    { detail: { transaction } },
  );
}

async function recordUnmappedItemAnomalies(supabase, outlet, transaction, unmapped, mappings) {
  const knownItemIds = new Set(mappings.map((m) => m.moka_item_id));
  for (const line of unmapped) {
    const anomalyType = knownItemIds.has(line.mokaItemId) ? 'UNKNOWN_VARIANT' : 'UNMAPPED_PRODUCT';
    await recordAnomalyOnce(
      supabase,
      {
        outlet_id: outlet?.id || null,
        anomaly_type: anomalyType,
        moka_item_id: line.mokaItemId,
        moka_variant_id: line.mokaVariantId,
      },
      { requested_quantity: line.quantity, detail: { transaction, name: line.name } },
    );
  }
}

/**
 * Persist and apply one already-fetched Moka sale. The caller owns polling,
 * outlet/location lookup, and mapping retrieval. This function deliberately
 * leaves a PARTIAL row on failure so it can be retried and investigated.
 */
async function processMokaSale(supabase, {
  payment, outlet, locationId, mappings = [], performedBy,
}) {
  if (!performedBy) return { action: 'FAILED', errorCode: 'SYSTEM_ACTOR_REQUIRED' };
  const plan = buildMokaSalePlan(payment, outlet, { locationId, mappings });
  if (plan.action === 'FAILED' && plan.errorCode === 'OUTLET_LOCATION_MAPPING_REQUIRED') {
    await recordUnknownOutletAnomaly(supabase, outlet, plan.transaction);
    return plan;
  }
  if (plan.action === 'FAILED_MAPPING') {
    await recordUnmappedItemAnomalies(supabase, outlet, plan.transaction, plan.unmapped, mappings);
    return plan;
  }
  if (plan.action !== 'PROCESS') return plan;

  const { transaction } = plan;
  const { data: existing, error: existingError } = await supabase
    .from('moka_stockist_sales')
    .select('*')
    .eq('outlet_id', outlet.id)
    .eq('external_transaction_id', transaction.externalId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return {
      action: existing.processing_status === 'PROCESSED' ? 'SKIPPED_DUPLICATE' : 'SKIPPED_EXISTING',
      saleId: existing.id,
      status: existing.processing_status,
      transaction,
    };
  }

  const { data: rawEvent, error: rawError } = await supabase
    .from('moka_stockist_raw_events')
    .upsert({
      outlet_id: outlet.id,
      external_id: transaction.externalId,
      event_type: 'sale',
      payload: payment,
      processing_status: 'RECEIVED',
    }, { onConflict: 'outlet_id,external_id,event_type', ignoreDuplicates: false })
    .select('id')
    .single();
  if (rawError) throw new Error(rawError.message);

  let sale = existing;
  if (!sale) {
    const { data: created, error: createError } = await supabase
      .from('moka_stockist_sales')
      .insert({
        outlet_id: outlet.id,
        location_id: locationId,
        raw_event_id: rawEvent.id,
        external_transaction_id: transaction.externalId,
        receipt_number: transaction.receiptNumber,
        transaction_status: transaction.status,
        processing_status: 'PENDING',
        occurred_at: transaction.occurredAt,
      })
      .select('*')
      .single();
    if (createError) {
      if (createError.code === '23505') {
        return { action: 'SKIPPED_CONCURRENT', transaction };
      }
      throw new Error(createError.message);
    }
    sale = created;
  }

  try {
    for (const line of plan.lines) {
      const { data: item, error: itemError } = await supabase
        .from('moka_stockist_sale_items')
        .insert({
          sale_id: sale.id,
          moka_item_id: line.mokaItemId,
          moka_variant_id: line.mokaVariantId,
          product_id: line.productId,
          quantity: line.quantity,
          status: 'MAPPED',
        })
        .select('id')
        .single();
      if (itemError) throw new Error(itemError.message);

      try {
        await applyInventoryMovement(supabase, {
          productId: line.productId,
          locationId,
          quantityDelta: -line.quantity,
          movementType: 'SALE_MOKA',
          performedBy,
          referenceType: 'moka_stockist_sale_item',
          referenceId: item.id,
          reason: `Moka sale ${transaction.receiptNumber || transaction.externalId}`,
        });
      } catch (movementError) {
        if (movementError.code === 'NEGATIVE_STOCK_RISK') {
          // Fail closed: never let a Moka sale push Stockist below zero.
          // The sale stays PARTIAL below so an owner can investigate and
          // reconcile (e.g. a missed opname or an earlier bad movement)
          // instead of stock silently going negative.
          const { data: balance } = await supabase
            .from('inventory_balances')
            .select('quantity')
            .eq('product_id', line.productId)
            .eq('location_id', locationId)
            .maybeSingle();
          await supabase.from('moka_stockist_sale_items').update({
            status: 'SKIPPED', error_message: movementError.message,
          }).eq('id', item.id);
          await recordAnomalyOnce(
            supabase,
            {
              outlet_id: outlet?.id || null,
              anomaly_type: 'NEGATIVE_STOCK_RISK',
              moka_item_id: line.mokaItemId,
              moka_variant_id: line.mokaVariantId,
            },
            {
              sale_id: sale.id,
              sale_item_id: item.id,
              product_id: line.productId,
              requested_quantity: line.quantity,
              available_quantity: balance?.quantity ?? null,
              detail: { transaction },
            },
          );
        }
        throw movementError;
      }

      const { error: itemUpdateError } = await supabase
        .from('moka_stockist_sale_items')
        .update({ status: 'PROCESSED' })
        .eq('id', item.id);
      if (itemUpdateError) throw new Error(itemUpdateError.message);
    }
  } catch (error) {
    await supabase.from('moka_stockist_sales').update({
      processing_status: 'PARTIAL', error_message: error.message,
    }).eq('id', sale.id);
    await supabase.from('moka_stockist_raw_events').update({
      processing_status: 'PARTIAL', error_message: error.message,
    }).eq('id', rawEvent.id);
    return { action: 'PARTIAL', saleId: sale.id, error: error.message, transaction };
  }

  await supabase.from('moka_stockist_sales').update({
    processing_status: 'PROCESSED', processed_at: new Date().toISOString(), error_message: null,
  }).eq('id', sale.id);
  await supabase.from('moka_stockist_raw_events').update({
    processing_status: 'PROCESSED', processed_at: new Date().toISOString(), error_message: null,
  }).eq('id', rawEvent.id);
  const quantityDeducted = plan.lines.reduce((sum, line) => sum + line.quantity, 0);
  return { action: 'PROCESSED', saleId: sale.id, transaction, quantityDeducted };
}

module.exports = {
  extractMokaSaleLines,
  normalizeMokaTransaction,
  isFinalMokaTransaction,
  buildMokaSalePlan,
  processMokaSale,
};
