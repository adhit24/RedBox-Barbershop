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

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function calculateAssetValue(balances, products, purchasePrices = []) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const priceByLocationProduct = new Map(
    purchasePrices.map((price) => [`${price.location_id}:${price.product_id}`, numeric(price.purchase_price)])
  );
  return balances.reduce((total, balance) => {
    const product = productById.get(balance.product_id);
    const quantity = Math.max(0, numeric(balance.quantity));
    const locationPrice = priceByLocationProduct.get(`${balance.location_id}:${balance.product_id}`);
    const purchasePrice = locationPrice ?? numeric(product?.purchase_price);
    return total + quantity * Math.max(0, purchasePrice);
  }, 0);
}

function summarizeAssetLocations(locations, balances, products, purchasePrices = []) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const balancesByLocation = new Map();
  for (const balance of balances) {
    if (!balancesByLocation.has(balance.location_id)) balancesByLocation.set(balance.location_id, []);
    balancesByLocation.get(balance.location_id).push(balance);
  }

  return locations.map((location) => {
    const locationBalances = balancesByLocation.get(location.id) || [];
    const positiveBalances = locationBalances.filter((balance) => numeric(balance.quantity) > 0);
    const totalQuantity = positiveBalances.reduce((sum, balance) => sum + numeric(balance.quantity), 0);
    const totalAssetValue = calculateAssetValue(
      positiveBalances,
      products.filter((product) => positiveBalances.some((b) => b.product_id === product.id)),
      purchasePrices
    );
    const lowStockCount = positiveBalances.filter((balance) => {
      const product = productById.get(balance.product_id);
      const threshold = product?.reorder_point ?? product?.minimum_stock ?? 0;
      return product && numeric(balance.quantity) <= numeric(threshold);
    }).length;

    return {
      location_id: location.id,
      type: location.type,
      total_quantity: totalQuantity,
      total_asset_value: totalAssetValue,
      sku_count: positiveBalances.length,
      low_stock_count: lowStockCount,
    };
  });
}

function buildAttentionItems(balances, products, locationNames = {}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return balances.flatMap((balance) => {
    const product = productById.get(balance.product_id);
    if (!product) return [];
    const quantity = numeric(balance.quantity);
    const threshold = numeric(product.reorder_point ?? product.minimum_stock);
    if (quantity > threshold) return [];
    return [{
      product_id: product.id,
      product_name: product.name,
      location_id: balance.location_id,
      location_name: locationNames[balance.location_id] || balance.location_id,
      quantity,
      reorder_point: threshold,
      reason: quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
    }];
  });
}

function summarizeActiveTransfers(transfers, locationNames = {}) {
  return transfers
    .filter((transfer) => transfer.status === 'SENT' || transfer.status === 'IN_TRANSIT')
    .map((transfer) => ({
      id: transfer.id,
      transfer_number: transfer.transfer_number,
      status: transfer.status,
      source_location_id: transfer.source_location_id,
      destination_location_id: transfer.destination_location_id,
      source_name: locationNames[transfer.source_location_id] || transfer.source_location_id,
      destination_name: locationNames[transfer.destination_location_id] || transfer.destination_location_id,
      sent_at: transfer.sent_at,
    }));
}

module.exports = {
  summarizeLocations,
  findProblemShipments,
  topOpnameDiscrepancies,
  topRequestedProducts,
  calculateAssetValue,
  summarizeAssetLocations,
  buildAttentionItems,
  summarizeActiveTransfers,
};
