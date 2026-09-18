'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');
const {
  listPayrollRuns,
  getPayrollRunDetail,
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  getBarberRunDetail,
} = require('../services/kapsterPayrollService');

function createKapsterPayrollRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  // Helper guard: Owner only
  function requireOwner(req, res, next) {
    if (req.adminAuth?.role !== 'owner') {
      return res.status(403).json({ error: 'Forbidden: Only Owner can manage payroll runs' });
    }
    next();
  }

  // 1. GET / — List all payroll runs
  router.get('/', adminAuth, async (req, res) => {
    try {
      const { status } = req.query;
      const runs = await listPayrollRuns(supabase, {
        status: status || null,
        auth: req.adminAuth,
      });
      return res.json({ runs });
    } catch (err) {
      console.error('[KapsterPayrollRoutes] list error:', err);
      return res.status(500).json({ error: err.message || 'Failed to list payroll runs' });
    }
  });

  // 2. POST / — Generate a new payroll draft (Owner only)
  router.post('/', adminAuth, requireOwner, async (req, res) => {
    try {
      const { period_start, period_end } = req.body || {};
      if (!period_start || !period_end) {
        return res.status(400).json({ error: 'period_start and period_end are required' });
      }

      const result = await generatePayrollDraft(supabase, {
        periodStart: period_start,
        periodEnd: period_end,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error('[KapsterPayrollRoutes] generate error:', err);
      const status = err.message?.includes('overlapping') ? 409 : 400;
      return res.status(status).json({ error: err.message || 'Failed to generate payroll draft' });
    }
  });

  // 3. GET /:id — Get run detail with barber items
  router.get('/:id', adminAuth, async (req, res) => {
    try {
      const runId = req.params.id;
      const detail = await getPayrollRunDetail(supabase, {
        runId,
        auth: req.adminAuth,
      });
      return res.json(detail);
    } catch (err) {
      console.error('[KapsterPayrollRoutes] get run error:', err);
      const status = err.status || (err.message?.includes('not found') ? 404 : 500);
      return res.status(status).json({ error: err.message || 'Failed to get payroll run detail' });
    }
  });

  // 4. POST /:id/regenerate — Atomically regenerate DRAFT run (Owner only)
  router.post('/:id/regenerate', adminAuth, requireOwner, async (req, res) => {
    try {
      const runId = req.params.id;
      const result = await regeneratePayrollDraft(supabase, {
        runId,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });
      return res.json(result);
    } catch (err) {
      console.error('[KapsterPayrollRoutes] regenerate error:', err);
      const status = err.status || 400;
      return res.status(status).json({ error: err.message || 'Failed to regenerate payroll draft' });
    }
  });

  // 5. POST /:id/lock — Lock a validated DRAFT run (Owner only)
  router.post('/:id/lock', adminAuth, requireOwner, async (req, res) => {
    try {
      const runId = req.params.id;
      const lockedRun = await lockPayrollRun(supabase, {
        runId,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });
      return res.json({ ok: true, run: lockedRun });
    } catch (err) {
      console.error('[KapsterPayrollRoutes] lock error:', err);
      const status = err.message?.includes('Cannot lock') ? 400 : (err.status || 500);
      return res.status(status).json({ error: err.message || 'Failed to lock payroll run' });
    }
  });

  // 6. GET /:id/barbers/:barberId — Get snapshotted items & detail for a barber
  router.get('/:id/barbers/:barberId', adminAuth, async (req, res) => {
    try {
      const { id: runId, barberId } = req.params;
      const detail = await getBarberRunDetail(supabase, {
        runId,
        barberId,
        auth: req.adminAuth,
      });
      return res.json(detail);
    } catch (err) {
      console.error('[KapsterPayrollRoutes] barber detail error:', err);
      const status = err.status || 500;
      return res.status(status).json({ error: err.message || 'Failed to get barber payroll detail' });
    }
  });

  // 7. POST /:id/barbers/:barberId/adjustments — Add manual adjustment (Owner only)
  router.post('/:id/barbers/:barberId/adjustments', adminAuth, requireOwner, async (req, res) => {
    try {
      const { id: runId, barberId } = req.params;
      const { amount, reason, note } = req.body || {};

      const adj = await addManualAdjustment(supabase, {
        runId,
        barberId,
        amount,
        reason,
        note,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });

      return res.status(201).json({ ok: true, adjustment: adj });
    } catch (err) {
      console.error('[KapsterPayrollRoutes] add adjustment error:', err);
      return res.status(400).json({ error: err.message || 'Failed to add manual adjustment' });
    }
  });

  // 8. DELETE /:id/adjustments/:adjustmentId — Delete manual adjustment while DRAFT (Owner only)
  router.delete('/:id/adjustments/:adjustmentId', adminAuth, requireOwner, async (req, res) => {
    try {
      const { id: runId, adjustmentId } = req.params;
      const result = await deleteManualAdjustment(supabase, {
        runId,
        adjustmentId,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });
      return res.json(result);
    } catch (err) {
      console.error('[KapsterPayrollRoutes] delete adjustment error:', err);
      return res.status(400).json({ error: err.message || 'Failed to delete manual adjustment' });
    }
  });

  return router;
}

module.exports = {
  createKapsterPayrollRoutes,
};
