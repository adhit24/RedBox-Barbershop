'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { getVerifiedStockistAccess, resolveStockistLocationScope, STOCKIST_BRANCHES } = require('../services/stockistAccess');
const { applyInventoryMovement, stripPurchasePrice, calculateTransferDiscrepancy } = require('../services/stockistInventory');

function createStockistRoutes(supabase, adminAuth) {
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

    const products = (data || []).map((p) => stripPurchasePrice(p, access.role));
    return res.json({ products });
  });

  router.post('/products', adminAuth, async (req, res) => {
    const access = requireAccess(req, res);
    if (!access) return;
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can create products' });
    }

    const { sku, name, category, brand, unit, barcode, purchase_price, retail_price, minimum_stock, reorder_point } = req.body || {};
    if (typeof sku !== 'string' || !sku.trim() || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'sku and name are required' });
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
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ product: data });
  });

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
    // Full ledger browsing is an owner capability in this spec; branch_admin
    // sees their own branch history via /inventory/summary + transfer detail.
    if (access.role !== 'owner') {
      return res.status(403).json({ error: 'only owner can browse the full ledger' });
    }

    let query = supabase.from('inventory_ledger').select('*').order('created_at', { ascending: false });
    if (typeof req.query.product_id === 'string' && req.query.product_id) {
      query = query.eq('product_id', req.query.product_id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ledger: data || [] });
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

    try {
      for (const item of items) {
        await applyInventoryMovement(supabase, {
          productId: item.product_id, locationId: warehouse.id, quantityDelta: -item.quantity,
          movementType: 'TRANSFER_OUT', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
        });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await supabase.from('stock_transfer_items').insert(
      items.map((i) => ({ stock_transfer_id: transfer.id, product_id: i.product_id, quantity_sent: i.quantity, quantity_received: null }))
    );

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

    return res.json({ transfers: data || [] });
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

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.some((i) => !i.item_id || !Number.isInteger(i.quantity_received) || i.quantity_received < 0)) {
      return res.status(400).json({ error: 'items must be a non-empty list of { item_id, quantity_received >= 0 }' });
    }

    const { data: transferItems, error: itemsError } = await supabase.from('stock_transfer_items').select('*').eq('stock_transfer_id', transfer.id);
    if (itemsError) return res.status(500).json({ error: itemsError.message });

    const byId = new Map((transferItems || []).map((i) => [i.id, i]));
    try {
      for (const submitted of items) {
        const existing = byId.get(submitted.item_id);
        if (!existing) throw new Error(`unknown transfer item ${submitted.item_id}`);
        await applyInventoryMovement(supabase, {
          productId: existing.product_id, locationId: transfer.destination_location_id, quantityDelta: submitted.quantity_received,
          movementType: 'TRANSFER_IN', performedBy: access.staffId,
          referenceType: 'stock_transfer', referenceId: transfer.id,
        });
        await supabase.from('stock_transfer_items').update({ quantity_received: submitted.quantity_received }).eq('id', submitted.item_id);
        existing.quantity_received = submitted.quantity_received;
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { data: updatedTransfers } = await supabase.from('stock_transfers').update({
      status: 'RECEIVED', received_by: access.staffId, received_at: new Date().toISOString(),
    }).eq('id', transfer.id);
    const updatedTransfer = (updatedTransfers || [])[0] || { ...transfer, status: 'RECEIVED' };

    return res.json({ transfer: updatedTransfer, has_discrepancy: calculateTransferDiscrepancy([...byId.values()]) });
  });

  return router;
}

module.exports = { createStockistRoutes };
