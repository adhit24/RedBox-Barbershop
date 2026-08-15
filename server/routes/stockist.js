'use strict';

const express = require('express');
const { getVerifiedStockistAccess, resolveStockistLocationScope, STOCKIST_BRANCHES } = require('../services/stockistAccess');
const { applyInventoryMovement, stripPurchasePrice } = require('../services/stockistInventory');

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

  return router;
}

module.exports = { createStockistRoutes };
