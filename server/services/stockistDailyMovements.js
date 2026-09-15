'use strict';

/**
 * Service: stockistDailyMovements
 * Aggregates inventory_ledger into inventory_daily_movements.
 * READ-ONLY with respect to operational balances/transactions.
 * Uses movement_at (business-effective time), not created_at (processing time),
 * so late/backfilled Moka sales land on the correct business date.
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
  return {
    startIso: `${dateStr}T00:00:00.000+07:00`,
    endIso: `${dateStr}T23:59:59.999+07:00`,
  };
}

async function aggregateDailyMovements(supabase, options = {}) {
  const targetDate = options.targetDate || getYesterdayWIBDate(options.now || new Date());
  const { startIso, endIso } = getWIBDateBoundaries(targetDate);

  const { data: locations, error: locError } = await supabase
    .from('inventory_locations')
    .select('id, type, outlet_id');
  if (locError) throw new Error(`Failed to load locations: ${locError.message}`);
  const locationById = new Map((locations || []).map((loc) => [loc.id, loc]));

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('inventory_ledger')
    .select('id, product_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after, movement_at, created_at')
    .gte('movement_at', startIso)
    .lte('movement_at', endIso)
    .order('movement_at', { ascending: true });
  if (ledgerError) throw new Error(`Failed to load ledger: ${ledgerError.message}`);

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
    const delta = Number(row.quantity_delta || 0);
    const absDelta = Math.abs(delta);
    switch (row.movement_type) {
      case 'WAREHOUSE_RECEIVE': grp.received_qty += delta; break;
      case 'TRANSFER_IN': grp.transfer_in_qty += delta; break;
      case 'TRANSFER_OUT': grp.transfer_out_qty += absDelta; break;
      case 'SALE_MOKA':
      case 'SALE_RETAIL': grp.sales_qty += absDelta; break;
      case 'ADJUSTMENT':
      case 'STOCK_OPNAME_GAIN':
        if (delta > 0) grp.adjustment_plus_qty += delta;
        else grp.adjustment_minus_qty += absDelta;
        break;
      case 'STOCK_OPNAME_LOSS':
      case 'DAMAGE':
      case 'LOST':
      case 'RETURN_TO_CENTER': grp.adjustment_minus_qty += absDelta; break;
      default:
        if (delta > 0) grp.adjustment_plus_qty += delta;
        else grp.adjustment_minus_qty += absDelta;
    }
  }

  const records = [];
  for (const grp of groups.values()) {
    const loc = locationById.get(grp.location_id);
    records.push({
      date: targetDate,
      location_id: grp.location_id,
      branch_id: loc?.outlet_id || null,
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

  // Remove stale rows for this date that may have been produced before a
  // late correction/backfill, then upsert the fresh canonical aggregate.
  // This table is reporting-only; operational stock remains in balances/ledger.
  const keys = new Set(records.map(r => `${r.location_id}:${r.product_id}`));
  const { data: existingRows, error: existingError } = await supabase
    .from('inventory_daily_movements')
    .select('id, location_id, product_id')
    .eq('date', targetDate);
  if (existingError) throw new Error(`Failed to inspect daily movements: ${existingError.message}`);
  const staleIds = (existingRows || [])
    .filter(r => !keys.has(`${r.location_id}:${r.product_id}`))
    .map(r => r.id);
  if (staleIds.length) {
    const { error: deleteError } = await supabase.from('inventory_daily_movements').delete().in('id', staleIds);
    if (deleteError) throw new Error(`Failed to clear stale daily movements: ${deleteError.message}`);
  }

  if (records.length) {
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
    stale_rows_removed: staleIds.length,
    records,
  };
}

module.exports = {
  getWIBDate,
  getYesterdayWIBDate,
  getWIBDateBoundaries,
  aggregateDailyMovements,
};
