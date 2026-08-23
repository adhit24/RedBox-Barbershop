'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { getVerifiedStockistAccess, resolveStockistLocationScope, STOCKIST_BRANCHES } = require('../services/stockistAccess');
const {
  applyInventoryMovement,
  stripPurchasePrice,
  calculateTransferDiscrepancy,
  validateAdjustmentReason,
  validateProductType,
} = require('../services/stockistInventory');
const {
  generateRequestNumber, validateApprovalItems, deriveRequestStatus, validateRejectionReason,
  reserveInventoryStock, releaseInventoryReservation, fulfillReservedTransferOut,
} = require('../services/stockistRequests');
const {
  generateOpnameNumber, computeDifference, validateOpnameSubmission,
} = require('../services/stockistOpname');
const {
  RETURN_CATEGORIES, isSellableOnReceive, generateReturnNumber, validateReturnReason,
} = require('../services/stockistReturns');
const {
  summarizeLocations, findProblemShipments, topOpnameDiscrepancies, topRequestedProducts,
  calculateAssetValue, summarizeAssetLocations, buildAttentionItems, summarizeActiveTransfers,
} = require('../services/stockistDashboard');
const { isServiceConsumable, isFoodOrBeverageProduct } = require('../services/stockistInventory');

// A push notification failing (e.g. no subscription, provider outage) must
// never fail the transaction it's attached to — every call site awaits this
// wrapper so tests stay deterministic, but any rejection is swallowed.
async function notifyBestEffort(fn) {
  try { await fn(); } catch { /* best-effort */ }
}

function createStockistRoutes(supabase, adminAuth, notifications = require('../services/stockistNotifications')) {
  const router = express.Router();

  function requireAccess(req, res) {
    const access = getVerifiedStockistAccess(req);
    if (!access) {
      res.status(403).json({ error: 'stockist access required' });
      return null;
    }
    return access;
  }

  // ─── PRODUCTS ────────────────────────────────────────────────
  router.get('/products', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data, error } = await supabase.from('products').select('*').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const products = (data || [])
      .filter((product) => !isFoodOrBeverageProduct(product))
      .map((p) => stripPurchasePrice(p, access.role));
    return res.json({ products });
  });

  router.post('/products', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can create products' });
    }

    const {
      sku, name, category, brand, unit, barcode, purchase_price, retail_price, minimum_stock, reorder_point, product_type,
    } = req.body || {};
    if (typeof sku !== 'string' || !sku.trim() || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'sku and name are required' });
    }

    const normalizedProductType = product_type ?? 'RETAIL';
    try {
      validateProductType(normalizedProductType);
    } catch (err) {
      if (err.code === 'INVALID_PRODUCT_TYPE') {
        return res.status(400).json({ error_code: err.code, error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    if (await isSkuTaken(sku.trim())) {
      return res.status(409).json({ error: 'SKU sudah digunakan.' });
    }

    const { data, error } = await supabase.from('products').insert({
      sku: sku.trim(),
      name: name.trim(),
      category: category || null,
      brand: brand || null,
      unit: unit || 'pcs',
      barcode: barcode || null,
      purchase_price: purchase_price ?? null,
      retail_price: retail_price ?? null,
      minimum_stock: minimum_stock ?? 0,
      reorder_point: reorder_point ?? 0,
      product_type: normalizedProductType,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ product: data });
  });

  router.patch('/products/:id', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can edit products' });
    }

    const { data: existing, error: findError } = await supabase.from('products').select('*').eq('id', req.params.id).single();
    if (findError || !existing) return res.status(404).json({ error: 'product not found' });

    const {
      sku, name, category, brand, unit, barcode, purchase_price, retail_price, minimum_stock, reorder_point, product_type,
    } = req.body || {};
    const patch = {};

    if (sku !== undefined) {
      if (typeof sku !== 'string' || !sku.trim()) return res.status(400).json({ error: 'sku cannot be empty' });
      if (await isSkuTaken(sku.trim(), req.params.id)) return res.status(409).json({ error: 'SKU sudah digunakan.' });
      patch.sku = sku.trim();
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      patch.name = name.trim();
    }
    if (category !== undefined) patch.category = category || null;
    if (brand !== undefined) patch.brand = brand || null;
    if (unit !== undefined) {
      if (typeof unit !== 'string' || !unit.trim()) return res.status(400).json({ error: 'unit cannot be empty' });
      patch.unit = unit.trim();
    }
    if (barcode !== undefined) patch.barcode = barcode || null;
    if (purchase_price !== undefined) patch.purchase_price = purchase_price;
    if (retail_price !== undefined) patch.retail_price = retail_price;
    if (minimum_stock !== undefined) {
      if (!Number.isInteger(minimum_stock) || minimum_stock < 0) return res.status(400).json({ error: 'minimum_stock must be a non-negative integer' });
      patch.minimum_stock = minimum_stock;
    }
    if (reorder_point !== undefined) {
      if (!Number.isInteger(reorder_point) || reorder_point < 0) return res.status(400).json({ error: 'reorder_point must be a non-negative integer' });
      patch.reorder_point = reorder_point;
    }
    if (product_type !== undefined) {
      try {
        validateProductType(product_type);
      } catch (err) {
        if (err.code === 'INVALID_PRODUCT_TYPE') {
          return res.status(400).json({ error_code: err.code, error: err.message });
        }
        return res.status(400).json({ error: err.message });
      }
      patch.product_type = product_type;
    }

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'no fields to update' });

    const { data, error } = await supabase.from('products').update(patch).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ product: data });
  });

  router.patch('/products/:id/deactivate', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can deactivate products' });
    }
    const { data, error } = await supabase.from('products').update({ is_active: false }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'product not found' });
    return res.json({ product: data });
  });

  router.patch('/products/:id/activate', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can activate products' });
    }
    const { data, error } = await supabase.from('products').update({ is_active: true }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'product not found' });
    return res.json({ product: data });
  });

  async function isSkuTaken(sku, excludeId = null) {
    let query = supabase.from('products').select('id').eq('sku', sku);
    if (excludeId) query = query.neq('id', excludeId);
    const { data } = await query;
    return (data || []).length > 0;
  }

  // Guards warehouse receipts, ad-hoc transfers, and branch requests from
  // starting a brand-new transaction against a discontinued product. Existing
  // stock/ledger history for an inactive product is untouched — only NEW
  // inbound/outbound transaction creation is blocked here.
  async function assertProductsActive(productIds) {
    const uniqueIds = [...new Set(productIds)];
    const { data } = await supabase.from('products').select('id, sku, is_active').in('id', uniqueIds);
    const inactive = (data || []).find((p) => !p.is_active);
    if (inactive) throw new Error(`product ${inactive.sku} is inactive and cannot be used in a new transaction`);
  }

  async function findLocation(type, branchSlug) {
    let query = supabase.from('inventory_locations').select('*').eq('type', type);
    if (type === 'warehouse') {
      const { data } = await query;
      return (data || [])[0] || null;
    }
    const { data: outlets } = await supabase.from('outlets').select('id').eq('slug', branchSlug).single();
    if (!outlets) return null;
    const { data } = await query.eq('outlet_id', outlets.id);
    return (data || [])[0] || null;
  }

  // Maps inventory_locations.id -> human-readable name for enriching lists/details.
  async function getLocationNames() {
    const { data: locations } = await supabase
      .from('inventory_locations')
      .select('id, type, outlet:outlets(name)');
    const locationNames = {};
    if (locations) {
      for (const loc of locations) {
        if (loc.type === 'warehouse') {
          locationNames[loc.id] = 'Gudang Pusat';
        } else if (loc.type === 'branch' && loc.outlet) {
          locationNames[loc.id] = loc.outlet.name;
        }
      }
    }
    return locationNames;
  }

  // ─── WAREHOUSE ───────────────────────────────────────────────
  router.post('/warehouse/receive', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can receive warehouse stock' });
    }

    const { product_id, quantity, reason } = req.body || {};
    if (typeof product_id !== 'string' || !product_id) {
      return res.status(400).json({ error: 'product_id required' });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    const warehouse = await findLocation('warehouse', null);
    if (!warehouse) return res.status(500).json({ error: 'warehouse location not configured' });

    try {
      await assertProductsActive([product_id]);
      const ledger = await applyInventoryMovement(supabase, {
        productId: product_id, locationId: warehouse.id, quantityDelta: quantity,
        movementType: 'WAREHOUSE_RECEIVE', performedBy: access.staffId, reason: reason || null,
      });
      return res.json({ ledger });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ─── INVENTORY ───────────────────────────────────────────────
  router.get('/inventory/summary', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const locationParam = req.query.location;
    if (typeof locationParam !== 'string' || !locationParam) {
      return res.status(400).json({ error: 'location query param required' });
    }
    const type = locationParam === 'warehouse' ? 'warehouse' : 'branch';
    const branchSlug = type === 'branch' ? locationParam : null;

    const scope = resolveStockistLocationScope(access, type, branchSlug);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

    const location = await findLocation(type, branchSlug);
    if (!location) return res.status(404).json({ error: 'location not found' });

    const { data, error } = await supabase.from('inventory_balances').select('*').eq('location_id', location.id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ balances: data || [] });
  });

  router.get('/inventory/ledger', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('inventory_ledger').select('*').order('created_at', { ascending: false }).limit(200);
    if (typeof req.query.product_id === 'string' && req.query.product_id) {
      query = query.eq('product_id', req.query.product_id);
    }

    if (access.role === 'branch_admin') {
      // branch_admin reads only their own branch history. Location is
      // resolved from the verified session, never from the request, so a
      // manipulated query param cannot leak another branch's ledger.
      const location = await findLocation('branch', access.branch);
      if (!location) return res.status(404).json({ error: `location not found for ${access.branch}` });
      query = query.eq('location_id', location.id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ledger: data || [] });
  });

  // ─── SERVICE CONSUMABLE ACCOUNTABILITY ───────────────────────
  router.get('/service-usage', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const requestedBranch = typeof req.query.branch === 'string' ? req.query.branch.trim().toLowerCase() : '';
    const branches = access.role === 'branch_admin' ? [access.branch] : (requestedBranch ? [requestedBranch] : [...STOCKIST_BRANCHES]);
    if (branches.some((branch) => !STOCKIST_BRANCHES.has(branch))) {
      return res.status(400).json({ error: 'invalid branch' });
    }

    const locations = [];
    for (const branch of branches) {
      const location = await findLocation('branch', branch);
      if (!location) return res.status(404).json({ error: `location not found for ${branch}` });
      locations.push({ ...location, branch });
    }
    const locationIds = locations.map((location) => location.id);
    const [{ data: products, error: productsError }, { data: balances, error: balancesError }, { data: usages, error: usagesError }] = await Promise.all([
      supabase.from('products').select('id, sku, name, unit, product_type, minimum_stock, reorder_point, is_active').eq('is_active', true).order('name'),
      supabase.from('inventory_balances').select('product_id, location_id, quantity').in('location_id', locationIds),
      supabase.from('inventory_service_usage').select('*').in('location_id', locationIds).order('opened_at', { ascending: false }),
    ]);
    if (productsError) return res.status(500).json({ error: productsError.message });
    if (balancesError) return res.status(500).json({ error: balancesError.message });
    if (usagesError) return res.status(500).json({ error: usagesError.message });

    const locationById = new Map(locations.map((location) => [location.id, location]));
    const serviceProducts = (products || []).filter((product) => isServiceConsumable(product.product_type));
    const availableByKey = new Map((balances || []).map((balance) => [`${balance.location_id}:${balance.product_id}`, balance.quantity]));
    const inUseByKey = new Map();
    for (const usage of usages || []) {
      if (usage.status !== 'IN_USE') continue;
      const key = `${usage.location_id}:${usage.product_id}`;
      inUseByKey.set(key, (inUseByKey.get(key) || 0) + usage.quantity);
    }
    const productById = new Map((products || []).map((product) => [product.id, product]));
    const items = [];
    for (const location of locations) {
      for (const product of serviceProducts) {
        const key = `${location.id}:${product.id}`;
        items.push({
          ...product,
          product_id: product.id,
          branch: location.branch,
          location_id: location.id,
          available_quantity: availableByKey.get(key) || 0,
          in_use_quantity: inUseByKey.get(key) || 0,
        });
      }
    }
    const enrichedUsages = (usages || []).map((usage) => ({
      ...usage,
      branch: locationById.get(usage.location_id)?.branch || null,
      product_name: productById.get(usage.product_id)?.name || usage.product_id,
      product_sku: productById.get(usage.product_id)?.sku || null,
      product_unit: productById.get(usage.product_id)?.unit || 'unit',
    }));
    return res.json({ items, usages: enrichedUsages });
  });

  router.get('/service-usage/pic-options', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    const branch = access.role === 'branch_admin' ? access.branch : (typeof req.query.branch === 'string' ? req.query.branch.trim().toLowerCase() : '');
    if (!STOCKIST_BRANCHES.has(branch)) return res.status(400).json({ error: 'valid branch is required' });
    const { data, error } = await supabase.from('users').select('id, name, role, branch').eq('branch', branch).in('role', ['branch_admin', 'barber']).order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ people: data || [] });
  });

  router.post('/service-usage/open', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'branch_admin') return res.status(403).json({ error: 'only branch_admin can open service consumables' });

    const { product_id, quantity = 1, pic_user_id, notes } = req.body || {};
    if (typeof product_id !== 'string' || !product_id) return res.status(400).json({ error: 'product_id required' });
    if (!Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity must be a positive integer' });
    const location = await findLocation('branch', access.branch);
    if (!location) return res.status(404).json({ error: 'branch location not found' });

    const { data: product, error: productError } = await supabase.from('products').select('id, product_type, is_active').eq('id', product_id).single();
    if (productError || !product) return res.status(404).json({ error: 'product not found' });
    if (!product.is_active) return res.status(400).json({ error: 'product is inactive' });
    if (!isServiceConsumable(product.product_type)) return res.status(400).json({ error_code: 'SERVICE_PRODUCT_REQUIRED', error: 'product is not a service consumable' });

    let picUserId = access.staffId;
    let picName = null;
    if (pic_user_id !== undefined) {
      if (typeof pic_user_id !== 'string' || !pic_user_id) return res.status(400).json({ error: 'pic_user_id must be a valid user' });
      const { data: pic, error: picError } = await supabase.from('users').select('id, name, branch, role').eq('id', pic_user_id).single();
      if (picError || !pic || pic.branch !== access.branch || !['branch_admin', 'barber'].includes(pic.role)) {
        return res.status(403).json({ error: 'PIC must belong to the authenticated branch' });
      }
      picUserId = pic.id;
      picName = pic.name;
    } else {
      const { data: currentUser } = await supabase.from('users').select('id, name').eq('id', access.staffId).single();
      picName = currentUser?.name || 'Branch Admin';
    }

    const { data: usage, error } = await supabase.rpc('open_service_usage', {
      p_product_id: product_id,
      p_location_id: location.id,
      p_quantity: quantity,
      p_pic_user_id: picUserId,
      p_pic_name: picName,
      p_opened_by: access.staffId,
      p_notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ usage });
  });

  router.patch('/service-usage/:id/finish', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'branch_admin') return res.status(403).json({ error: 'only branch_admin can finish service consumables' });
    const { data: usage, error: usageError } = await supabase.from('inventory_service_usage').select('id, location_id, status').eq('id', req.params.id).single();
    if (usageError || !usage) return res.status(404).json({ error: 'service usage not found' });
    const branchLocation = await findLocation('branch', access.branch);
    if (!branchLocation || usage.location_id !== branchLocation.id) return res.status(403).json({ error: 'branch access denied' });
    if (usage.status !== 'IN_USE') return res.status(409).json({ error: 'service usage is already finished' });
    const { data: finished, error } = await supabase.rpc('finish_service_usage', {
      p_usage_id: usage.id,
      p_finished_by: access.staffId,
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ usage: finished });
  });

  // ─── TRANSFERS ───────────────────────────────────────────────
  router.post('/transfers', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can create transfers' });
    }

    const { destination_branch, items } = req.body || {};
    if (!STOCKIST_BRANCHES.has(destination_branch)) {
      return res.status(400).json({ error: 'destination_branch invalid' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.product_id || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { product_id, quantity > 0 }' });
    }

    try {
      await assertProductsActive(items.map((i) => i.product_id));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const warehouseForCheck = await findLocation('warehouse', null);
    if (!warehouseForCheck) return res.status(500).json({ error: 'warehouse location not configured' });

    const { data: currentBalances, error: balanceCheckError } = await supabase
      .from('inventory_balances')
      .select('product_id, quantity')
      .eq('location_id', warehouseForCheck.id)
      .in('product_id', items.map((i) => i.product_id));
    if (balanceCheckError) return res.status(500).json({ error: balanceCheckError.message });

    const balanceByProduct = new Map((currentBalances || []).map((b) => [b.product_id, b.quantity]));
    const insufficientItem = items.find((i) => (balanceByProduct.get(i.product_id) || 0) < i.quantity);
    if (insufficientItem) {
      return res.status(400).json({ error: `insufficient warehouse stock for product ${insufficientItem.product_id}` });
    }

    const warehouse = await findLocation('warehouse', null);
    const destination = await findLocation('branch', destination_branch);
    if (!warehouse || !destination) return res.status(500).json({ error: 'location not configured' });

    const { data: transfer, error: transferError } = await supabase.from('stock_transfers').insert({
      transfer_number: `TRF-${Date.now()}-${randomUUID().slice(0, 6)}`,
      source_location_id: warehouse.id,
      destination_location_id: destination.id,
      status: 'SENT',
      sent_by: access.staffId,
    }).select().single();
    if (transferError) return res.status(500).json({ error: transferError.message });

    // Insert the tracking rows BEFORE applying any inventory movements so that,
    // even if the movement loop below fails partway through, the transfer and
    // its intended items are still visible for manual reconciliation.
    const { error: itemsInsertError } = await supabase.from('stock_transfer_items').insert(
      items.map((i) => ({ stock_transfer_id: transfer.id, product_id: i.product_id, quantity_sent: i.quantity, quantity_received: null }))
    );
    if (itemsInsertError) return res.status(500).json({ error: itemsInsertError.message });

    const appliedItems = [];
    try {
      for (const item of items) {
        await applyInventoryMovement(supabase, {
          productId: item.product_id, locationId: warehouse.id, quantityDelta: -item.quantity,
          movementType: 'TRANSFER_OUT', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
        });
        appliedItems.push(item);
      }
    } catch (err) {
      // Reverse any movements already applied in this failed attempt, then remove
      // the now-invalid transfer so it can never be received.
      for (const applied of appliedItems) {
        await applyInventoryMovement(supabase, {
          productId: applied.product_id, locationId: warehouse.id, quantityDelta: applied.quantity,
          movementType: 'TRANSFER_OUT', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
          reason: 'compensating reversal: transfer creation failed partway',
        });
      }
      await supabase.from('stock_transfers').delete().eq('id', transfer.id);
      return res.status(400).json({ error: err.message });
    }

    return res.json({ transfer });
  });

  router.get('/transfers', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('stock_transfers').select('*');
    if (access.role === 'branch_admin') {
      const location = await findLocation('branch', access.branch);
      if (!location) return res.status(500).json({ error: 'location not configured' });
      query = query.eq('destination_location_id', location.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const locationNames = await getLocationNames();

    const enrichedTransfers = (data || []).map((t) => ({
      ...t,
      source_name: locationNames[t.source_location_id] || t.source_location_id,
      destination_name: locationNames[t.destination_location_id] || t.destination_location_id,
    }));

    return res.json({ transfers: enrichedTransfers });
  });

  router.get('/transfers/:id', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: transfers, error: transferError } = await supabase.from('stock_transfers').select('*').eq('id', req.params.id);
    if (transferError) return res.status(500).json({ error: transferError.message });
    const transfer = (transfers || [])[0];
    if (!transfer) return res.status(404).json({ error: 'transfer not found' });

    if (access.role === 'branch_admin') {
      const ownBranchLocation = await findLocation('branch', access.branch);
      if (!ownBranchLocation || ownBranchLocation.id !== transfer.destination_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    const { data: items, error: itemsError } = await supabase.from('stock_transfer_items').select('*').eq('stock_transfer_id', transfer.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const locationNames = await getLocationNames();

    const enrichedTransfer = {
      ...transfer,
      source_name: locationNames[transfer.source_location_id] || transfer.source_location_id,
      destination_name: locationNames[transfer.destination_location_id] || transfer.destination_location_id,
    };

    return res.json({ transfer: enrichedTransfer, items: items || [] });
  });

  router.patch('/transfers/:id/receive', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: transfers, error: transferError } = await supabase.from('stock_transfers').select('*').eq('id', req.params.id);
    if (transferError) return res.status(500).json({ error: transferError.message });
    const transfer = (transfers || [])[0];
    if (!transfer) return res.status(404).json({ error: 'transfer not found' });

    if (access.role === 'branch_admin') {
      const ownBranchLocation = await findLocation('branch', access.branch);
      if (!ownBranchLocation || ownBranchLocation.id !== transfer.destination_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    if (transfer.status !== 'SENT') {
      return res.status(409).json({ error: 'transfer already received' });
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.item_id || !Number.isInteger(i.quantity_received) || i.quantity_received < 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { item_id, quantity_received >= 0 }' });
    }

    const { data: transferItems, error: itemsError } = await supabase.from('stock_transfer_items').select('*').eq('stock_transfer_id', transfer.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const allItemIds = new Set((transferItems || []).map((i) => i.id));
    const submittedIds = new Set(items.map((i) => i.item_id));
    if (allItemIds.size !== submittedIds.size || [...allItemIds].some((id) => !submittedIds.has(id))) {
      return res.status(400).json({ error: 'all transfer items must be included in the receive request' });
    }

    const byId = new Map((transferItems || []).map((i) => [i.id, i]));
    for (const submitted of items) {
      const existing = byId.get(submitted.item_id);
      if (!existing) return res.status(400).json({ error: `unknown transfer item ${submitted.item_id}` });
      if (existing.quantity_received != null) {
        // Already processed in a prior attempt (e.g. after a partial failure on a
        // previous request) — do not re-apply the movement.
        continue;
      }
      try {
        await applyInventoryMovement(supabase, {
          productId: existing.product_id, locationId: transfer.destination_location_id, quantityDelta: submitted.quantity_received,
          movementType: 'TRANSFER_IN', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
        });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const { error: itemUpdateError } = await supabase.from('stock_transfer_items').update({ quantity_received: submitted.quantity_received }).eq('id', submitted.item_id);
      if (itemUpdateError) return res.status(500).json({ error: itemUpdateError.message });
      existing.quantity_received = submitted.quantity_received;
    }

    const { data: updatedTransfers, error: transferUpdateError } = await supabase.from('stock_transfers').update({
      status: 'RECEIVED', received_by: access.staffId, received_at: new Date().toISOString(),
    }).eq('id', transfer.id);
    if (transferUpdateError) return res.status(500).json({ error: transferUpdateError.message });
    const updatedTransfer = (updatedTransfers || [])[0] || { ...transfer, status: 'RECEIVED' };

    const hasDiscrepancy = calculateTransferDiscrepancy([...byId.values()]);
    if (hasDiscrepancy) {
      await notifyBestEffort(() => notifications.notifyTransferDiscrepancy(supabase, { transfer: updatedTransfer }));
    }

    return res.json({ transfer: updatedTransfer, has_discrepancy: hasDiscrepancy });
  });

  // ─── MANUAL ADJUSTMENT ───────────────────────────────────────
  router.post('/inventory/adjustment', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can perform manual adjustments' });
    }

    const { product_id, location_type, location_branch, quantity_delta, reason } = req.body || {};
    try {
      validateAdjustmentReason(reason);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (typeof product_id !== 'string' || !product_id) {
      return res.status(400).json({ error: 'product_id required' });
    }
    if (!Number.isInteger(quantity_delta) || quantity_delta === 0) {
      return res.status(400).json({ error: 'quantity_delta must be a non-zero integer' });
    }
    if (location_type !== 'warehouse' && location_type !== 'branch') {
      return res.status(400).json({ error: 'location_type must be warehouse or branch' });
    }

    const location = await findLocation(location_type, location_type === 'branch' ? location_branch : null);
    if (!location) return res.status(404).json({ error: 'location not found' });

    try {
      const ledger = await applyInventoryMovement(supabase, {
        productId: product_id, locationId: location.id, quantityDelta: quantity_delta,
        movementType: 'ADJUSTMENT', performedBy: access.staffId, reason,
      });

      if (location_type === 'branch') {
        await notifyBestEffort(async () => {
          const { data: product } = await supabase.from('products').select('name, minimum_stock').eq('id', product_id).single();
          if (!product) return;
          await notifications.checkAndNotifyLowStock(supabase, {
            productId: product_id, locationId: location.id, branchSlug: location_branch,
            productName: product.name, newQuantity: ledger.quantity_after, minimumStock: product.minimum_stock,
          });
        });
      }

      return res.json({ ledger });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ─── STOCK REQUESTS (branch asks warehouse for restock) ───────
  router.post('/requests', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'branch_admin') {
      return res.status(403).json({ error: 'only branch_admin can submit a stock request' });
    }

    const { items, reason } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.product_id || !Number.isInteger(i.quantity_requested) || i.quantity_requested <= 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { product_id, quantity_requested > 0 }' });
    }

    try {
      await assertProductsActive(items.map((i) => i.product_id));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const branchLocation = await findLocation('branch', access.branch);
    if (!branchLocation) return res.status(500).json({ error: 'location not configured' });

    const { data: request, error: requestError } = await supabase.from('stock_requests').insert({
      request_number: generateRequestNumber(access.branch),
      branch_location_id: branchLocation.id,
      status: 'SUBMITTED',
      requested_by: access.staffId,
      reason: reason || null,
    }).select().single();
    if (requestError) return res.status(500).json({ error: requestError.message });

    const { error: itemsInsertError } = await supabase.from('stock_request_items').insert(
      items.map((i) => ({ stock_request_id: request.id, product_id: i.product_id, quantity_requested: i.quantity_requested, quantity_approved: null }))
    );
    if (itemsInsertError) return res.status(500).json({ error: itemsInsertError.message });

    const locationNames = await getLocationNames();
    await notifyBestEffort(() => notifications.notifyStockRequestSubmitted(supabase, {
      request, branchName: locationNames[branchLocation.id] || access.branch, itemCount: items.length,
    }));

    return res.json({ request });
  });

  router.get('/requests', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('stock_requests').select('*').order('created_at', { ascending: false });
    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation) return res.status(500).json({ error: 'location not configured' });
      query = query.eq('branch_location_id', branchLocation.id);
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      query = query.eq('status', req.query.status);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const locationNames = await getLocationNames();
    const enrichedRequests = (data || []).map((r) => ({
      ...r,
      branch_name: locationNames[r.branch_location_id] || r.branch_location_id,
    }));

    return res.json({ requests: enrichedRequests });
  });

  router.get('/requests/:id', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: requests, error: requestError } = await supabase.from('stock_requests').select('*').eq('id', req.params.id);
    if (requestError) return res.status(500).json({ error: requestError.message });
    const request = (requests || [])[0];
    if (!request) return res.status(404).json({ error: 'request not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== request.branch_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    const { data: items, error: itemsError } = await supabase.from('stock_request_items').select('*').eq('stock_request_id', request.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const locationNames = await getLocationNames();
    const enrichedRequest = { ...request, branch_name: locationNames[request.branch_location_id] || request.branch_location_id };

    return res.json({ request: enrichedRequest, items: items || [] });
  });

  router.patch('/requests/:id/approve', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can approve a stock request' });
    }

    const { data: requests, error: requestError } = await supabase.from('stock_requests').select('*').eq('id', req.params.id);
    if (requestError) return res.status(500).json({ error: requestError.message });
    const request = (requests || [])[0];
    if (!request) return res.status(404).json({ error: 'request not found' });
    if (request.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'only a SUBMITTED request can be approved' });
    }

    const { data: requestItems, error: itemsError } = await supabase.from('stock_request_items').select('*').eq('stock_request_id', request.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const { items } = req.body || {};
    try {
      validateApprovalItems(requestItems || [], items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const warehouse = await findLocation('warehouse', null);
    if (!warehouse) return res.status(500).json({ error: 'warehouse location not configured' });

    const requestItemById = new Map((requestItems || []).map((i) => [i.id, i]));
    const reservedSoFar = [];
    for (const submitted of items) {
      if (submitted.quantity_approved <= 0) continue;
      const productId = requestItemById.get(submitted.item_id).product_id;
      try {
        await reserveInventoryStock(supabase, { productId, locationId: warehouse.id, quantity: submitted.quantity_approved });
        reservedSoFar.push({ productId, quantity: submitted.quantity_approved });
      } catch (err) {
        // Undo reservations already made in this attempt before reporting the failure.
        for (const done of reservedSoFar) {
          await releaseInventoryReservation(supabase, { productId: done.productId, locationId: warehouse.id, quantity: done.quantity });
        }
        return res.status(400).json({ error: err.message });
      }
    }

    for (const submitted of items) {
      const { error: itemUpdateError } = await supabase.from('stock_request_items').update({ quantity_approved: submitted.quantity_approved }).eq('id', submitted.item_id);
      if (itemUpdateError) return res.status(500).json({ error: itemUpdateError.message });
    }

    const status = deriveRequestStatus(requestItems || [], items);
    const { data: updatedRequest, error: updateReqError } = await supabase.from('stock_requests').update({
      status, reviewed_by: access.staffId, reviewed_at: new Date().toISOString(),
    }).eq('id', request.id).select().single();
    if (updateReqError) return res.status(500).json({ error: updateReqError.message });

    await notifyBestEffort(() => notifications.notifyStockRequestReviewed(supabase, { request: updatedRequest }));

    return res.json({ request: updatedRequest });
  });

  router.patch('/requests/:id/reject', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can reject a stock request' });
    }

    const { reason } = req.body || {};
    try {
      validateRejectionReason(reason);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { data: requests, error: requestError } = await supabase.from('stock_requests').select('*').eq('id', req.params.id);
    if (requestError) return res.status(500).json({ error: requestError.message });
    const request = (requests || [])[0];
    if (!request) return res.status(404).json({ error: 'request not found' });
    if (request.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'only a SUBMITTED request can be rejected' });
    }

    const { data: updatedRequest, error: updateError } = await supabase.from('stock_requests').update({
      status: 'REJECTED', reviewed_by: access.staffId, reviewed_at: new Date().toISOString(), rejection_reason: reason,
    }).eq('id', request.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await notifyBestEffort(() => notifications.notifyStockRequestReviewed(supabase, { request: updatedRequest }));

    return res.json({ request: updatedRequest });
  });

  router.patch('/requests/:id/cancel', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: requests, error: requestError } = await supabase.from('stock_requests').select('*').eq('id', req.params.id);
    if (requestError) return res.status(500).json({ error: requestError.message });
    const request = (requests || [])[0];
    if (!request) return res.status(404).json({ error: 'request not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== request.branch_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
      if (request.status !== 'SUBMITTED') {
        return res.status(409).json({ error: 'branch_admin can only cancel a request before it has been reviewed' });
      }
    } else if (!['SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED'].includes(request.status)) {
      return res.status(409).json({ error: 'request cannot be cancelled in its current status' });
    }

    if (request.status === 'APPROVED' || request.status === 'PARTIALLY_APPROVED') {
      const { data: requestItems, error: itemsError } = await supabase.from('stock_request_items').select('*').eq('stock_request_id', request.id);
      if (itemsError) return res.status(500).json({ error: itemsError.message });
      const warehouse = await findLocation('warehouse', null);
      if (!warehouse) return res.status(500).json({ error: 'warehouse location not configured' });
      for (const item of requestItems || []) {
        if (item.quantity_approved > 0) {
          await releaseInventoryReservation(supabase, { productId: item.product_id, locationId: warehouse.id, quantity: item.quantity_approved });
        }
      }
    }

    const { data: updatedRequest, error: updateError } = await supabase.from('stock_requests').update({ status: 'CANCELLED' }).eq('id', request.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    return res.json({ request: updatedRequest });
  });

  router.post('/requests/:id/fulfill', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can fulfill a stock request' });
    }

    const { data: requests, error: requestError } = await supabase.from('stock_requests').select('*').eq('id', req.params.id);
    if (requestError) return res.status(500).json({ error: requestError.message });
    const request = (requests || [])[0];
    if (!request) return res.status(404).json({ error: 'request not found' });
    if (request.status !== 'APPROVED' && request.status !== 'PARTIALLY_APPROVED') {
      return res.status(409).json({ error: 'only an approved request can be fulfilled' });
    }
    if (request.fulfilling_transfer_id) {
      return res.status(409).json({ error: 'request has already been fulfilled' });
    }

    const { data: requestItems, error: itemsError } = await supabase.from('stock_request_items').select('*').eq('stock_request_id', request.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });
    const itemsToShip = (requestItems || []).filter((i) => i.quantity_approved > 0);
    if (itemsToShip.length === 0) return res.status(400).json({ error: 'no approved items to ship' });

    const warehouse = await findLocation('warehouse', null);
    if (!warehouse) return res.status(500).json({ error: 'warehouse location not configured' });

    const { data: transfer, error: transferError } = await supabase.from('stock_transfers').insert({
      transfer_number: `TRF-${Date.now()}-${randomUUID().slice(0, 6)}`,
      source_location_id: warehouse.id,
      destination_location_id: request.branch_location_id,
      status: 'SENT',
      sent_by: access.staffId,
    }).select().single();
    if (transferError) return res.status(500).json({ error: transferError.message });

    const { error: transferItemsError } = await supabase.from('stock_transfer_items').insert(
      itemsToShip.map((i) => ({ stock_transfer_id: transfer.id, product_id: i.product_id, quantity_sent: i.quantity_approved, quantity_received: null }))
    );
    if (transferItemsError) return res.status(500).json({ error: transferItemsError.message });

    const applied = [];
    try {
      for (const item of itemsToShip) {
        await fulfillReservedTransferOut(supabase, {
          productId: item.product_id, locationId: warehouse.id, quantity: item.quantity_approved,
          performedBy: access.staffId, referenceType: 'stock_transfer', referenceId: transfer.id,
        });
        applied.push(item);
      }
    } catch (err) {
      // Reverse fulfillment already applied in this failed attempt (restore
      // physical quantity and re-reserve it), then remove the now-invalid
      // transfer so it can never be received.
      for (const done of applied) {
        await applyInventoryMovement(supabase, {
          productId: done.product_id, locationId: warehouse.id, quantityDelta: done.quantity_approved,
          movementType: 'TRANSFER_OUT', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
          reason: 'compensating reversal: fulfillment failed partway',
        });
        await reserveInventoryStock(supabase, { productId: done.product_id, locationId: warehouse.id, quantity: done.quantity_approved });
      }
      await supabase.from('stock_transfer_items').delete().eq('stock_transfer_id', transfer.id);
      await supabase.from('stock_transfers').delete().eq('id', transfer.id);
      return res.status(400).json({ error: err.message });
    }

    const { data: updatedRequest, error: updateReqError } = await supabase.from('stock_requests').update({
      status: 'FULFILLED', fulfilling_transfer_id: transfer.id,
    }).eq('id', request.id).select().single();
    if (updateReqError) return res.status(500).json({ error: updateReqError.message });

    await notifyBestEffort(() => notifications.notifyStockRequestFulfilled(supabase, { request: updatedRequest }));

    return res.json({ request: updatedRequest, transfer });
  });

  // ─── STOCK OPNAME (physical count session) ─────────────────────
  router.post('/stock-opname', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { location_type, location_branch } = req.body || {};
    if (location_type !== 'warehouse' && location_type !== 'branch') {
      return res.status(400).json({ error: 'location_type must be warehouse or branch' });
    }
    const scope = resolveStockistLocationScope(access, location_type, location_type === 'branch' ? location_branch : null);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });

    const location = await findLocation(location_type, location_type === 'branch' ? location_branch : null);
    if (!location) return res.status(404).json({ error: 'location not found' });

    const { data: openOpnames, error: openCheckError } = await supabase
      .from('stock_opnames').select('id').eq('location_id', location.id).in('status', ['DRAFT', 'SUBMITTED']);
    if (openCheckError) return res.status(500).json({ error: openCheckError.message });
    if ((openOpnames || []).length > 0) {
      return res.status(409).json({ error: 'an open stock opname already exists for this location' });
    }

    const { data: activeProducts, error: productsError } = await supabase.from('products').select('id').eq('is_active', true);
    if (productsError) return res.status(500).json({ error: productsError.message });
    if (!activeProducts || activeProducts.length === 0) {
      return res.status(400).json({ error: 'no active products to count' });
    }

    const { data: balances, error: balancesError } = await supabase
      .from('inventory_balances').select('product_id, quantity').eq('location_id', location.id);
    if (balancesError) return res.status(500).json({ error: balancesError.message });
    const balanceByProduct = new Map((balances || []).map((b) => [b.product_id, b.quantity]));
    let activeServiceUsages = [];
    try {
      const { data: usageRows, error: usageError } = await supabase
        .from('inventory_service_usage').select('product_id, quantity').eq('location_id', location.id).eq('status', 'IN_USE');
      if (!usageError) activeServiceUsages = usageRows || [];
    } catch {
      // Existing installations can run the legacy opname flow until the
      // service-consumable migration has been applied.
    }
    const inUseByProduct = new Map();
    for (const usage of activeServiceUsages) {
      inUseByProduct.set(usage.product_id, (inUseByProduct.get(usage.product_id) || 0) + usage.quantity);
    }

    const locationLabel = location_type === 'warehouse' ? 'WH' : location_branch;
    const { data: opname, error: opnameError } = await supabase.from('stock_opnames').insert({
      opname_number: generateOpnameNumber(locationLabel),
      location_id: location.id,
      status: 'DRAFT',
      created_by: access.staffId,
    }).select().single();
    if (opnameError) return res.status(500).json({ error: opnameError.message });

    const { error: itemsInsertError } = await supabase.from('stock_opname_items').insert(
      activeProducts.map((p) => ({
        stock_opname_id: opname.id, product_id: p.id,
        system_quantity: balanceByProduct.get(p.id) || 0,
        in_use_quantity: inUseByProduct.get(p.id) || 0,
        total_accounted_quantity: (balanceByProduct.get(p.id) || 0) + (inUseByProduct.get(p.id) || 0),
        physical_quantity: null, difference: null, reason: null,
      }))
    );
    if (itemsInsertError) return res.status(500).json({ error: itemsInsertError.message });

    return res.json({ opname });
  });

  router.get('/stock-opname', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('stock_opnames').select('*').order('created_at', { ascending: false });
    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation) return res.status(500).json({ error: 'location not configured' });
      query = query.eq('location_id', branchLocation.id);
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      query = query.eq('status', req.query.status);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const locationNames = await getLocationNames();
    const enrichedOpnames = (data || []).map((o) => ({ ...o, location_name: locationNames[o.location_id] || o.location_id }));

    return res.json({ opnames: enrichedOpnames });
  });

  router.get('/stock-opname/:id', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: opnames, error: opnameError } = await supabase.from('stock_opnames').select('*').eq('id', req.params.id);
    if (opnameError) return res.status(500).json({ error: opnameError.message });
    const opname = (opnames || [])[0];
    if (!opname) return res.status(404).json({ error: 'opname not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== opname.location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    const { data: items, error: itemsError } = await supabase.from('stock_opname_items').select('*').eq('stock_opname_id', opname.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const locationNames = await getLocationNames();
    const enrichedOpname = { ...opname, location_name: locationNames[opname.location_id] || opname.location_id };

    return res.json({ opname: enrichedOpname, items: items || [] });
  });

  router.patch('/stock-opname/:id/count', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: opnames, error: opnameError } = await supabase.from('stock_opnames').select('*').eq('id', req.params.id);
    if (opnameError) return res.status(500).json({ error: opnameError.message });
    const opname = (opnames || [])[0];
    if (!opname) return res.status(404).json({ error: 'opname not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== opname.location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }
    if (opname.status !== 'DRAFT') {
      return res.status(409).json({ error: 'only a DRAFT opname can be counted' });
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.item_id || !Number.isInteger(i.physical_quantity) || i.physical_quantity < 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { item_id, physical_quantity >= 0 }' });
    }

    for (const submitted of items) {
      const { error: itemUpdateError } = await supabase.from('stock_opname_items').update({
        physical_quantity: submitted.physical_quantity, reason: submitted.reason || null,
      }).eq('id', submitted.item_id).eq('stock_opname_id', opname.id);
      if (itemUpdateError) return res.status(500).json({ error: itemUpdateError.message });
    }

    const { data: updatedItems, error: fetchError } = await supabase.from('stock_opname_items').select('*').eq('stock_opname_id', opname.id);
    if (fetchError) return res.status(500).json({ error: fetchError.message });

    return res.json({ items: updatedItems || [] });
  });

  router.patch('/stock-opname/:id/submit', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: opnames, error: opnameError } = await supabase.from('stock_opnames').select('*').eq('id', req.params.id);
    if (opnameError) return res.status(500).json({ error: opnameError.message });
    const opname = (opnames || [])[0];
    if (!opname) return res.status(404).json({ error: 'opname not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== opname.location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }
    if (opname.status !== 'DRAFT') {
      return res.status(409).json({ error: 'only a DRAFT opname can be submitted' });
    }

    const { data: items, error: itemsError } = await supabase.from('stock_opname_items').select('*').eq('stock_opname_id', opname.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    try {
      validateOpnameSubmission(items || []);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let discrepancyCount = 0;
    for (const item of items) {
      const difference = computeDifference(item.total_accounted_quantity ?? item.system_quantity, item.physical_quantity);
      if (difference !== 0) discrepancyCount += 1;
      const { error: updateError } = await supabase.from('stock_opname_items').update({ difference }).eq('id', item.id);
      if (updateError) return res.status(500).json({ error: updateError.message });
    }

    const { data: updatedOpname, error: updateOpnameError } = await supabase.from('stock_opnames').update({
      status: 'SUBMITTED', submitted_at: new Date().toISOString(),
    }).eq('id', opname.id).select().single();
    if (updateOpnameError) return res.status(500).json({ error: updateOpnameError.message });

    const locationNames = await getLocationNames();
    await notifyBestEffort(() => notifications.notifyStockOpnameSubmitted(supabase, {
      opname: updatedOpname, locationName: locationNames[opname.location_id] || opname.location_id, discrepancyCount,
    }));

    return res.json({ opname: updatedOpname });
  });

  router.patch('/stock-opname/:id/approve', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can approve a stock opname' });
    }

    const { data: opnames, error: opnameError } = await supabase.from('stock_opnames').select('*').eq('id', req.params.id);
    if (opnameError) return res.status(500).json({ error: opnameError.message });
    const opname = (opnames || [])[0];
    if (!opname) return res.status(404).json({ error: 'opname not found' });
    if (opname.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'only a SUBMITTED opname can be approved' });
    }

    const { data: items, error: itemsError } = await supabase.from('stock_opname_items').select('*').eq('stock_opname_id', opname.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const toAdjust = (items || []).filter((i) => i.difference !== 0);
    const applied = [];
    try {
      for (const item of toAdjust) {
        await applyInventoryMovement(supabase, {
          productId: item.product_id, locationId: opname.location_id, quantityDelta: item.difference,
          movementType: 'ADJUSTMENT', performedBy: access.staffId,
          referenceType: 'stock_opname', referenceId: opname.id, reason: item.reason,
        });
        applied.push(item);
      }
    } catch (err) {
      // Reverse adjustments already applied in this failed attempt; leave the
      // opname SUBMITTED so it can be corrected (e.g. re-count) and retried.
      for (const done of applied) {
        await applyInventoryMovement(supabase, {
          productId: done.product_id, locationId: opname.location_id, quantityDelta: -done.difference,
          movementType: 'ADJUSTMENT', performedBy: access.staffId,
          referenceType: 'stock_opname', referenceId: opname.id,
          reason: 'compensating reversal: opname approval failed partway',
        });
      }
      return res.status(400).json({ error: err.message });
    }

    const { data: updatedOpname, error: updateError } = await supabase.from('stock_opnames').update({
      status: 'APPROVED', approved_by: access.staffId, approved_at: new Date().toISOString(),
    }).eq('id', opname.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await notifyBestEffort(() => notifications.notifyStockOpnameApproved(supabase, { opname: updatedOpname }));

    return res.json({ opname: updatedOpname });
  });

  router.patch('/stock-opname/:id/cancel', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: opnames, error: opnameError } = await supabase.from('stock_opnames').select('*').eq('id', req.params.id);
    if (opnameError) return res.status(500).json({ error: opnameError.message });
    const opname = (opnames || [])[0];
    if (!opname) return res.status(404).json({ error: 'opname not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== opname.location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }
    if (opname.status !== 'DRAFT' && opname.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'opname cannot be cancelled in its current status' });
    }

    const { data: updatedOpname, error: updateError } = await supabase.from('stock_opnames').update({ status: 'CANCELLED' }).eq('id', opname.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    return res.json({ opname: updatedOpname });
  });

  // ─── RETURNS (branch ships defective/excess stock back to warehouse) ──
  router.post('/returns', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'branch_admin') {
      return res.status(403).json({ error: 'only branch_admin can submit a return' });
    }

    const { category, reason, items } = req.body || {};
    if (!RETURN_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'category invalid' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.product_id || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { product_id, quantity > 0 }' });
    }

    const branchLocation = await findLocation('branch', access.branch);
    if (!branchLocation) return res.status(500).json({ error: 'location not configured' });

    const { data: currentBalances, error: balanceCheckError } = await supabase
      .from('inventory_balances').select('product_id, quantity')
      .eq('location_id', branchLocation.id).in('product_id', items.map((i) => i.product_id));
    if (balanceCheckError) return res.status(500).json({ error: balanceCheckError.message });
    const balanceByProduct = new Map((currentBalances || []).map((b) => [b.product_id, b.quantity]));
    const insufficientItem = items.find((i) => (balanceByProduct.get(i.product_id) || 0) < i.quantity);
    if (insufficientItem) {
      return res.status(400).json({ error: `insufficient branch stock for product ${insufficientItem.product_id}` });
    }

    const { data: stockReturn, error: returnError } = await supabase.from('stock_returns').insert({
      return_number: generateReturnNumber(access.branch),
      branch_location_id: branchLocation.id,
      category, reason: reason || null, status: 'SUBMITTED', requested_by: access.staffId,
    }).select().single();
    if (returnError) return res.status(500).json({ error: returnError.message });

    const { error: itemsInsertError } = await supabase.from('stock_return_items').insert(
      items.map((i) => ({ stock_return_id: stockReturn.id, product_id: i.product_id, quantity: i.quantity }))
    );
    if (itemsInsertError) return res.status(500).json({ error: itemsInsertError.message });

    const locationNames = await getLocationNames();
    await notifyBestEffort(() => notifications.notifyStockReturnSubmitted(supabase, {
      stockReturn, branchName: locationNames[branchLocation.id] || access.branch, itemCount: items.length,
    }));

    return res.json({ return: stockReturn });
  });

  router.get('/returns', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    let query = supabase.from('stock_returns').select('*').order('created_at', { ascending: false });
    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation) return res.status(500).json({ error: 'location not configured' });
      query = query.eq('branch_location_id', branchLocation.id);
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      query = query.eq('status', req.query.status);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const locationNames = await getLocationNames();
    const enrichedReturns = (data || []).map((r) => ({ ...r, branch_name: locationNames[r.branch_location_id] || r.branch_location_id }));

    return res.json({ returns: enrichedReturns });
  });

  router.get('/returns/:id', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: returns, error: returnError } = await supabase.from('stock_returns').select('*').eq('id', req.params.id);
    if (returnError) return res.status(500).json({ error: returnError.message });
    const stockReturn = (returns || [])[0];
    if (!stockReturn) return res.status(404).json({ error: 'return not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== stockReturn.branch_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }

    const { data: items, error: itemsError } = await supabase.from('stock_return_items').select('*').eq('stock_return_id', stockReturn.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const locationNames = await getLocationNames();
    const enrichedReturn = { ...stockReturn, branch_name: locationNames[stockReturn.branch_location_id] || stockReturn.branch_location_id };

    return res.json({ return: enrichedReturn, items: items || [] });
  });

  router.patch('/returns/:id/approve', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can approve a return' });
    }

    const { data: returns, error: returnError } = await supabase.from('stock_returns').select('*').eq('id', req.params.id);
    if (returnError) return res.status(500).json({ error: returnError.message });
    const stockReturn = (returns || [])[0];
    if (!stockReturn) return res.status(404).json({ error: 'return not found' });
    if (stockReturn.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'only a SUBMITTED return can be approved' });
    }

    const { data: updatedReturn, error: updateError } = await supabase.from('stock_returns').update({
      status: 'APPROVED', reviewed_by: access.staffId, reviewed_at: new Date().toISOString(),
    }).eq('id', stockReturn.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await notifyBestEffort(() => notifications.notifyStockReturnReviewed(supabase, { stockReturn: updatedReturn }));

    return res.json({ return: updatedReturn });
  });

  router.patch('/returns/:id/reject', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can reject a return' });
    }

    const { reason } = req.body || {};
    try {
      validateReturnReason(reason);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { data: returns, error: returnError } = await supabase.from('stock_returns').select('*').eq('id', req.params.id);
    if (returnError) return res.status(500).json({ error: returnError.message });
    const stockReturn = (returns || [])[0];
    if (!stockReturn) return res.status(404).json({ error: 'return not found' });
    if (stockReturn.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'only a SUBMITTED return can be rejected' });
    }

    const { data: updatedReturn, error: updateError } = await supabase.from('stock_returns').update({
      status: 'REJECTED', reviewed_by: access.staffId, reviewed_at: new Date().toISOString(), rejection_reason: reason,
    }).eq('id', stockReturn.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await notifyBestEffort(() => notifications.notifyStockReturnReviewed(supabase, { stockReturn: updatedReturn }));

    return res.json({ return: updatedReturn });
  });

  router.patch('/returns/:id/ship', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: returns, error: returnError } = await supabase.from('stock_returns').select('*').eq('id', req.params.id);
    if (returnError) return res.status(500).json({ error: returnError.message });
    const stockReturn = (returns || [])[0];
    if (!stockReturn) return res.status(404).json({ error: 'return not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== stockReturn.branch_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
    }
    if (stockReturn.status !== 'APPROVED') {
      return res.status(409).json({ error: 'only an APPROVED return can be shipped' });
    }

    const { data: items, error: itemsError } = await supabase.from('stock_return_items').select('*').eq('stock_return_id', stockReturn.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const applied = [];
    try {
      for (const item of items || []) {
        await applyInventoryMovement(supabase, {
          productId: item.product_id, locationId: stockReturn.branch_location_id, quantityDelta: -item.quantity,
          movementType: 'RETURN_TO_CENTER', performedBy: access.staffId,
          referenceType: 'stock_return', referenceId: stockReturn.id,
        });
        applied.push(item);
      }
    } catch (err) {
      // Reverse decrements already applied in this failed attempt.
      for (const done of applied) {
        await applyInventoryMovement(supabase, {
          productId: done.product_id, locationId: stockReturn.branch_location_id, quantityDelta: done.quantity,
          movementType: 'RETURN_TO_CENTER', performedBy: access.staffId,
          referenceType: 'stock_return', referenceId: stockReturn.id,
          reason: 'compensating reversal: ship failed partway',
        });
      }
      return res.status(400).json({ error: err.message });
    }

    const { data: updatedReturn, error: updateError } = await supabase.from('stock_returns').update({
      status: 'SHIPPED', shipped_by: access.staffId, shipped_at: new Date().toISOString(),
    }).eq('id', stockReturn.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    return res.json({ return: updatedReturn });
  });

  router.patch('/returns/:id/receive', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can receive a return at the warehouse' });
    }

    const { data: returns, error: returnError } = await supabase.from('stock_returns').select('*').eq('id', req.params.id);
    if (returnError) return res.status(500).json({ error: returnError.message });
    const stockReturn = (returns || [])[0];
    if (!stockReturn) return res.status(404).json({ error: 'return not found' });
    if (stockReturn.status !== 'SHIPPED') {
      return res.status(409).json({ error: 'only a SHIPPED return can be received' });
    }

    const warehouse = await findLocation('warehouse', null);
    if (!warehouse) return res.status(500).json({ error: 'warehouse location not configured' });

    if (isSellableOnReceive(stockReturn.category)) {
      const { data: items, error: itemsError } = await supabase.from('stock_return_items').select('*').eq('stock_return_id', stockReturn.id);
      if (itemsError) return res.status(500).json({ error: itemsError.message });

      const applied = [];
      try {
        for (const item of items || []) {
          await applyInventoryMovement(supabase, {
            productId: item.product_id, locationId: warehouse.id, quantityDelta: item.quantity,
            movementType: 'WAREHOUSE_RECEIVE', performedBy: access.staffId,
            referenceType: 'stock_return', referenceId: stockReturn.id,
          });
          applied.push(item);
        }
      } catch (err) {
        for (const done of applied) {
          await applyInventoryMovement(supabase, {
            productId: done.product_id, locationId: warehouse.id, quantityDelta: -done.quantity,
            movementType: 'WAREHOUSE_RECEIVE', performedBy: access.staffId,
            referenceType: 'stock_return', referenceId: stockReturn.id,
            reason: 'compensating reversal: receive failed partway',
          });
        }
        return res.status(400).json({ error: err.message });
      }
    }
    // Damaged/expired categories skip the warehouse increment entirely —
    // the goods left the branch at /ship, and never re-enter sellable stock.

    const { data: updatedReturn, error: updateError } = await supabase.from('stock_returns').update({
      status: 'RECEIVED', received_by: access.staffId, received_at: new Date().toISOString(),
    }).eq('id', stockReturn.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    await notifyBestEffort(() => notifications.notifyStockReturnReceived(supabase, { stockReturn: updatedReturn }));

    return res.json({ return: updatedReturn });
  });

  router.patch('/returns/:id/cancel', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: returns, error: returnError } = await supabase.from('stock_returns').select('*').eq('id', req.params.id);
    if (returnError) return res.status(500).json({ error: returnError.message });
    const stockReturn = (returns || [])[0];
    if (!stockReturn) return res.status(404).json({ error: 'return not found' });

    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation || branchLocation.id !== stockReturn.branch_location_id) {
        return res.status(403).json({ error: 'branch access denied' });
      }
      if (stockReturn.status !== 'SUBMITTED') {
        return res.status(409).json({ error: 'branch_admin can only cancel a return before it has been reviewed' });
      }
    } else if (!['SUBMITTED', 'APPROVED'].includes(stockReturn.status)) {
      return res.status(409).json({ error: 'return cannot be cancelled in its current status' });
    }

    const { data: updatedReturn, error: updateError } = await supabase.from('stock_returns').update({ status: 'CANCELLED' }).eq('id', stockReturn.id).select().single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    return res.json({ return: updatedReturn });
  });

  // ─── OWNER DASHBOARD OVERVIEW ──────────────────────────────────
  // Every location — including the warehouse, which is physically
  // co-located with Cabang Bypass — is summarized as its own row. Never
  // collapse warehouse and Cabang Bypass into one combined number here.
  router.get('/dashboard/overview', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can view the dashboard overview' });
    }

    const { data: locations, error: locationsError } = await supabase.from('inventory_locations').select('*');
    if (locationsError) return res.status(500).json({ error: locationsError.message });

    const { data: balances, error: balancesError } = await supabase.from('inventory_balances').select('*');
    if (balancesError) return res.status(500).json({ error: balancesError.message });

    const { data: products, error: productsError } = await supabase.from('products').select('*');
    if (productsError) return res.status(500).json({ error: productsError.message });
    const productById = new Map((products || []).map((p) => [p.id, p]));

    const locationNames = await getLocationNames();
    const locationSummaries = summarizeLocations(locations || [], balances || [], products || [])
      .map((s) => ({ ...s, location_name: locationNames[s.location_id] || s.location_id }));

    const { data: submittedRequests, error: requestsError } = await supabase.from('stock_requests').select('id').eq('status', 'SUBMITTED');
    if (requestsError) return res.status(500).json({ error: requestsError.message });

    // NOTE: fetches every RECEIVED transfer and every transfer item to spot
    // discrepancies — fine at current data volume, but a future reports
    // module should add date-range filtering before this table grows large.
    const { data: receivedTransfers, error: transfersError } = await supabase.from('stock_transfers').select('*').eq('status', 'RECEIVED');
    if (transfersError) return res.status(500).json({ error: transfersError.message });
    const { data: transferItems, error: transferItemsError } = await supabase.from('stock_transfer_items').select('*');
    if (transferItemsError) return res.status(500).json({ error: transferItemsError.message });
    const itemsByTransferId = new Map();
    for (const item of transferItems || []) {
      if (!itemsByTransferId.has(item.stock_transfer_id)) itemsByTransferId.set(item.stock_transfer_id, []);
      itemsByTransferId.get(item.stock_transfer_id).push(item);
    }
    const problemShipments = findProblemShipments(receivedTransfers || [], itemsByTransferId).map((t) => ({
      id: t.id,
      transfer_number: t.transfer_number,
      source_name: locationNames[t.source_location_id] || t.source_location_id,
      destination_name: locationNames[t.destination_location_id] || t.destination_location_id,
      received_at: t.received_at,
    }));

    const { data: approvedOpnames, error: opnamesError } = await supabase.from('stock_opnames').select('*').eq('status', 'APPROVED');
    if (opnamesError) return res.status(500).json({ error: opnamesError.message });
    const { data: opnameItems, error: opnameItemsError } = await supabase.from('stock_opname_items').select('*');
    if (opnameItemsError) return res.status(500).json({ error: opnameItemsError.message });
    const opnameById = new Map((approvedOpnames || []).map((o) => [o.id, o]));
    const enrichedOpnameItems = (opnameItems || [])
      .filter((i) => opnameById.has(i.stock_opname_id))
      .map((i) => {
        const opname = opnameById.get(i.stock_opname_id);
        const product = productById.get(i.product_id);
        return {
          ...i,
          opname_number: opname.opname_number,
          location_name: locationNames[opname.location_id] || opname.location_id,
          product_name: product ? product.name : i.product_id,
        };
      });
    const topDiscrepancies = topOpnameDiscrepancies(enrichedOpnameItems, 5);

    const { data: allRequestItems, error: requestItemsError } = await supabase.from('stock_request_items').select('*');
    if (requestItemsError) return res.status(500).json({ error: requestItemsError.message });
    const topProducts = topRequestedProducts(allRequestItems || [], 5)
      .map((row) => ({ ...row, product_name: productById.get(row.product_id)?.name || row.product_id }));

    return res.json({
      locations: locationSummaries,
      pending_requests_count: (submittedRequests || []).length,
      problem_shipments: problemShipments,
      top_discrepancies: topDiscrepancies,
      top_requested_products: topProducts,
    });
  });

  // ─── ASSET-FIRST DASHBOARD ────────────────────────────────────
  router.get(['/dashboard/assets', '/dashboard/owner'], adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;

    const { data: allLocations, error: locationsError } = await supabase.from('inventory_locations').select('*');
    if (locationsError) return res.status(500).json({ error: locationsError.message });

    let locations = allLocations || [];
    if (access.role === 'branch_admin') {
      const branchLocation = await findLocation('branch', access.branch);
      if (!branchLocation) return res.status(404).json({ error: 'branch location not found' });
      locations = locations.filter((location) => location.id === branchLocation.id);
    }
    const locationIds = new Set(locations.map((location) => location.id));

    const { data: balances, error: balancesError } = await supabase.from('inventory_balances').select('*');
    if (balancesError) return res.status(500).json({ error: balancesError.message });
    const scopedBalances = (balances || []).filter((balance) => locationIds.has(balance.location_id));

    const { data: products, error: productsError } = await supabase.from('products').select('*');
    if (productsError) return res.status(500).json({ error: productsError.message });
    const activeProducts = (products || []).filter((product) => product.is_active !== false);
    const { data: purchasePrices, error: purchasePricesError } = await supabase
      .from('inventory_purchase_prices')
      .select('location_id, product_id, purchase_price');
    if (purchasePricesError) return res.status(500).json({ error: purchasePricesError.message });

    const locationNames = await getLocationNames();
    const assetByLocation = summarizeAssetLocations(locations, scopedBalances, activeProducts, purchasePrices || [])
      .map((summary) => ({ ...summary, location_name: locationNames[summary.location_id] || summary.location_id }));
    const { data: transfers, error: transfersError } = await supabase.from('stock_transfers').select('*');
    if (transfersError) return res.status(500).json({ error: transfersError.message });
    const scopedTransfers = (transfers || []).filter((transfer) => (
      locationIds.has(transfer.source_location_id) || locationIds.has(transfer.destination_location_id)
    ));
    const activeTransfers = summarizeActiveTransfers(scopedTransfers, locationNames);
    const attentionItems = buildAttentionItems(scopedBalances, activeProducts, locationNames);
    const isOwner = access.role === 'owner';
    const totalAssetValue = calculateAssetValue(scopedBalances, activeProducts, purchasePrices || []);
    const warehouseAssetValue = assetByLocation
      .filter((location) => location.type === 'warehouse')
      .reduce((sum, location) => sum + location.total_asset_value, 0);
    const branchAssetValue = assetByLocation
      .filter((location) => location.type === 'branch')
      .reduce((sum, location) => sum + location.total_asset_value, 0);

    return res.json({
      total_asset_value: isOwner ? totalAssetValue : null,
      warehouse_asset_value: isOwner ? warehouseAssetValue : null,
      branch_asset_value: isOwner ? branchAssetValue : null,
      asset_by_location: assetByLocation.map((location) => isOwner
        ? location
        : { ...location, total_asset_value: null }),
      attention_items: attentionItems,
      active_transfers: activeTransfers,
      role: access.role,
      breakdown: {
        warehouse: isOwner ? warehouseAssetValue : null,
        branches: isOwner ? branchAssetValue : null,
      },
    });
  });

  return router;
}

module.exports = { createStockistRoutes };
