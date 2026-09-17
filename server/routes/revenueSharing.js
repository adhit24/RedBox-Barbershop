'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');
const {
  getRevenueSharingPreview,
  getBarberRevenueDetail,
  fetchBarberRateHistory,
  setBarberCommissionRate,
} = require('../services/revenueSharingService');

function createRevenueSharingRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  // GET /api/payroll/revenue-sharing/preview
  router.get('/preview', adminAuth, async (req, res) => {
    try {
      const {
        date_from,
        date_to,
        branch,
        barber_id,
        status,
      } = req.query;

      const preview = await getRevenueSharingPreview(supabase, {
        dateFrom: date_from,
        dateTo: date_to,
        branch: branch || null,
        barberId: barber_id || null,
        status: status || null,
        auth: req.adminAuth,
      });

      return res.json(preview);
    } catch (error) {
      console.error('[RevenueSharingRoutes] preview error:', error);
      const statusCode = error.status || 500;
      return res.status(statusCode).json({ error: error.message || 'Failed to generate preview' });
    }
  });

  // GET /api/payroll/revenue-sharing/barbers/:id/detail
  router.get('/barbers/:id/detail', adminAuth, async (req, res) => {
    try {
      const barberId = req.params.id;
      const { date_from, date_to } = req.query;

      const detail = await getBarberRevenueDetail(supabase, {
        barberId,
        dateFrom: date_from,
        dateTo: date_to,
        auth: req.adminAuth,
      });

      return res.json(detail);
    } catch (error) {
      console.error('[RevenueSharingRoutes] detail error:', error);
      const statusCode = error.status || 500;
      return res.status(statusCode).json({ error: error.message || 'Failed to load barber detail' });
    }
  });

  // GET /api/payroll/revenue-sharing/rates
  router.get('/rates', adminAuth, async (req, res) => {
    try {
      const { barber_id } = req.query;
      const barberIds = barber_id ? [barber_id] : [];
      if (!barberIds.length) {
        // Fetch all active barbers
        const { data: barbers } = await supabase.from('barbers').select('id').eq('is_active', true);
        if (barbers) {
          barbers.forEach((b) => barberIds.push(b.id));
        }
      }

      const rates = await fetchBarberRateHistory(supabase, barberIds);
      return res.json({ rates });
    } catch (error) {
      console.error('[RevenueSharingRoutes] rates error:', error);
      return res.status(500).json({ error: error.message || 'Failed to load rates' });
    }
  });

  // POST /api/payroll/revenue-sharing/rates
  // Strictly Owner only
  router.post('/rates', adminAuth, async (req, res) => {
    try {
      if (req.adminAuth?.role !== 'owner') {
        return res.status(403).json({ error: 'Forbidden: Only Owner can configure commission rates' });
      }

      const { barberId, rate, effectiveFrom } = req.body || {};
      if (!barberId || rate == null || !effectiveFrom) {
        return res.status(400).json({ error: 'barberId, rate, and effectiveFrom are required' });
      }

      const createdBy = req.adminAuth?.email || req.adminAuth?.staffId || 'owner';
      const result = await setBarberCommissionRate(supabase, {
        barberId,
        rate,
        effectiveFrom,
        createdBy,
      });

      return res.json({ ok: true, rate: result });
    } catch (error) {
      console.error('[RevenueSharingRoutes] rate save error:', error);
      return res.status(400).json({ error: error.message || 'Failed to set commission rate' });
    }
  });

  return router;
}

module.exports = {
  createRevenueSharingRoutes,
};
