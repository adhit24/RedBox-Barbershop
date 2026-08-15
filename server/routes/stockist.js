'use strict';

const express = require('express');
const { getVerifiedStockistAccess } = require('../services/stockistAccess');
const { stripPurchasePrice } = require('../services/stockistInventory');

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

  return router;
}

module.exports = { createStockistRoutes };
