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
  const status = normalizeMokaStatus(payment);
  if (payment?.is_deleted || payment?.is_refunded || payment?.voided || payment?.is_void) return false;
  return FINAL_STATUSES.has(status);
}

function normalizeMokaTransaction(payment, outlet) {
  const externalId = firstValue(payment?.id, payment?.transaction_id, payment?.order_id,
    payment?.receipt_number, payment?.receipt_no);
  const receiptNumber = firstValue(payment?.receipt_number, payment?.receipt_no, externalId);
  const occurredAt = firstValue(payment?.transaction_date, payment?.created_at, payment?.updated_at);
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
    mokaVariantId: firstValue(line?.variant_id, line?.variantId, line?.moka_variant_id),
    name: firstValue(line?.name, line?.item_name, line?.product_name),
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
  };
}

function extractMokaSaleLines(payment) {
  const raw = firstValue(payment?.item_details, payment?.items, payment?.order_items, payment?.line_items);
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
  const lines = extractMokaSaleLines(payment).map((line) => {
    const exact = mappingByKey.get(`${line.mokaItemId || ''}:${line.mokaVariantId || ''}`);
    const itemOnly = mappingByKey.get(`${line.mokaItemId || ''}:`);
    const mapping = exact || itemOnly || null;
    return { ...line, productId: mapping?.product_id || null, mapped: Boolean(mapping) };
  });
  if (!lines.length) return { action: 'FAILED', errorCode: 'MOKA_LINE_ITEMS_REQUIRED', transaction, lines };
  if (lines.some((line) => !line.quantity || line.quantity <= 0)) {
    return { action: 'FAILED', errorCode: 'MOKA_INVALID_LINE_QUANTITY', transaction, lines };
  }
  const unmapped = lines.filter((line) => !line.mapped);
  if (unmapped.length) return { action: 'FAILED_MAPPING', transaction, lines, unmapped };
  return { action: 'PROCESS', transaction, lines };
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
  return { action: 'PROCESSED', saleId: sale.id, transaction };
}

module.exports = {
  extractMokaSaleLines,
  normalizeMokaTransaction,
  isFinalMokaTransaction,
  buildMokaSalePlan,
  processMokaSale,
};
