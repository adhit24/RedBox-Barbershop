'use strict';

/**
 * Service: stockistDailyMovements
 * 
 * Handles daily aggregation of inventory_ledger into inventory_daily_movements.
 * Strictly READ-ONLY with respect to operational balances and stockist transactions.
 * Timezone: Asia/Jakarta (+07:00).
 */

const TIMEZONE_OFFSET_HOURS = 7;
const MS_PER_HOUR = 3600000;

function getWIBDate(date = new Date()) {
  const wibTime = new Date(date.getTime() + TIMEZONE_OFFSET_HOURS * MS_PER_HOUR);
  return wibTime.toISOString().slice(0, 10);
}

function getYesterdayWIBDate(date = new Date()) {
  const wibTime = new Date(date.getTime() + TIMEZONE_OFFSET_HOURS * MS_PER_HOUR);
  wibTime.setUTCDate(wibTime.getUTCDate() - 1);
  return wibTime.toISOString().slice(0, 10);
}

function getWIBDateBoundaries(dateStr) {
  // dateStr is YYYY-MM-DD
  const startIso = `${dateStr}T00:00:00.000+07:00`;
  const endIso = `${dateStr}T23:59:59.999+07:00`;
  return { startIso, endIso };
}

async function aggregateDailyMovements(supabase, options = {}) {
  const targetDate = options.targetDate || getYesterdayWIBDate(options.now || new Date());
  const { startIso, endIso } = getWIBDateBoundaries(targetDate);

  // 1. Fetch locations map to resolve branch_id (outlet_id)
  const { data: locations, error: locError } = await supabase
    .from('inventory_locations')
    .select('id, type, outlet_id');
  if (locError) throw new Error(`Failed to load locations: ${locError.message}`);

  const locationById = new Map((locations || []).map((loc) => [loc.id, loc]));

  // 2. Fetch ledger rows in the exact WIB 24h window
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('inventory_ledger')
    .select('id, product_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after, created_at')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: true });

  if (ledgerError) throw new Error(`Failed to load ledger: ${ledgerError.message}`);

  // 3. Group by (location_id, product_id)
  const groups = new Map();

  for (const row of ledgerRows || []) {
    const key = `${row.location_id}:${row.product_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        location_id: row.location_id,
        product_id: row.product_id,
        first_row: row,
        last_row: row,
        received_qty: 0,
        transfer_in_qty: 0,
        transfer_out_qty: 0,
        sales_qty: 0,
        adjustment_plus_qty: 0,
        adjustment_minus_qty: 0,
      });
    }

    const grp = groups.get(key);
    grp.last_row = row;

    const delta = row.quantity_delta;
    const absDelta = Math.abs(delta);

    switch (row.movement_type) {
      case 'WAREHOUSE_RECEIVE':
        grp.received_qty += delta;
        break;
      case 'TRANSFER_IN':
        grp.transfer_in_qty += delta;
        break;
      case 'TRANSFER_OUT':
        grp.transfer_out_qty += absDelta;
        break;
      case 'SALE_MOKA':
      case 'SALE_RETAIL':
        grp.sales_qty += absDelta;
        break;
      case 'ADJUSTMENT':
      case 'STOCK_OPNAME_GAIN':
        if (delta > 0) grp.adjustment_plus_qty += delta;
        else grp.adjustment_minus_qty += absDelta;
        break;
      case 'STOCK_OPNAME_LOSS':
      case 'DAMAGE':
      case 'LOST':
      case 'RETURN_TO_CENTER':
        grp.adjustment_minus_qty += absDelta;
        break;
      default:
        if (delta > 0) grp.adjustment_plus_qty += delta;
        else grp.adjustment_minus_qty += absDelta;
        break;
    }
  }

  // 4. Construct records for upsert
  const records = [];
  for (const grp of groups.values()) {
    const loc = locationById.get(grp.location_id);
    const branchId = loc?.outlet_id || null;

    records.push({
      date: targetDate,
      location_id: grp.location_id,
      branch_id: branchId,
      product_id: grp.product_id,
      opening_qty: grp.first_row.quantity_before,
      received_qty: grp.received_qty,
      transfer_in_qty: grp.transfer_in_qty,
      transfer_out_qty: grp.transfer_out_qty,
      sales_qty: grp.sales_qty,
      adjustment_plus_qty: grp.adjustment_plus_qty,
      adjustment_minus_qty: grp.adjustment_minus_qty,
      closing_qty: grp.last_row.quantity_after,
      updated_at: new Date().toISOString(),
    });
  }

  // 5. Upsert idempotently into inventory_daily_movements
  if (records.length > 0) {
    const { error: upsertError } = await supabase
      .from('inventory_daily_movements')
      .upsert(records, { onConflict: 'date,location_id,product_id' });

    if (upsertError) throw new Error(`Failed to upsert daily movements: ${upsertError.message}`);
  }

  return {
    ok: true,
    target_date: targetDate,
    window_start: startIso,
    window_end: endIso,
    movements_processed: (ledgerRows || []).length,
    records_upserted: records.length,
    records,
  };
}

module.exports = {
  getWIBDate,
  getYesterdayWIBDate,
  getWIBDateBoundaries,
  aggregateDailyMovements,
};
