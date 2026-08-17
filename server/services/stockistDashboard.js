'use strict';

const { calculateTransferDiscrepancy } = require('./stockistInventory');

// Every location (including the warehouse, even though it's physically
// co-located with Cabang Bypass) gets its own row — callers must never
// merge two location_ids into one summary number.
function summarizeLocations(locations, balances, products) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const balancesByLocation = new Map();
  for (const balance of balances) {
    if (!balancesByLocation.has(balance.location_id)) balancesByLocation.set(balance.location_id, []);
    balancesByLocation.get(balance.location_id).push(balance);
  }

  return locations.map((location) => {
    const locationBalances = balancesByLocation.get(location.id) || [];
    let totalQuantity = 0;
    let lowStockCount = 0;
    let skuCount = 0;
    for (const balance of locationBalances) {
      if (balance.quantity <= 0) continue;
      skuCount += 1;
      totalQuantity += balance.quantity;
      const product = productById.get(balance.product_id);
      if (product && balance.quantity <= product.minimum_stock) lowStockCount += 1;
    }
    return {
      location_id: location.id,
      type: location.type,
      total_quantity: totalQuantity,
      low_stock_count: lowStockCount,
      sku_count: skuCount,
    };
  });
}

function findProblemShipments(transfers, itemsByTransferId) {
  return transfers.filter((t) => {
    if (t.status !== 'RECEIVED') return false;
    const items = itemsByTransferId.get(t.id) || [];
    return calculateTransferDiscrepancy(items);
  });
}

function topOpnameDiscrepancies(opnameItems, limit = 5) {
  return [...opnameItems]
    .filter((item) => item.difference !== 0)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    .slice(0, limit);
}

function topRequestedProducts(requestItems, limit = 5) {
  const totals = new Map();
  for (const item of requestItems) {
    totals.set(item.product_id, (totals.get(item.product_id) || 0) + item.quantity_requested);
  }
  return [...totals.entries()]
    .map(([product_id, total_requested]) => ({ product_id, total_requested }))
    .sort((a, b) => b.total_requested - a.total_requested)
    .slice(0, limit);
}

module.exports = {
  summarizeLocations,
  findProblemShipments,
  topOpnameDiscrepancies,
  topRequestedProducts,
};
