'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');
const {
  listRegularPayrollRuns,
  generateRegularPayrollDraft,
  getRegularPayrollRunDetail,
  addRegularPayrollAdjustment,
  deleteRegularPayrollAdjustment,
  lockRegularPayrollRun,
} = require('../services/regularPayrollService');

function createRegularPayrollRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  // Helper guard: Owner only
  function requireOwner(req, res, next) {
    if (req.adminAuth?.role !== 'owner') {
      return res.status(403).json({ error: 'Forbidden: Only Owner can manage regular payroll' });
    }
    next();
  }

  // 1. GET / — List all regular payroll runs
  router.get('/', adminAuth, async (req, res) => {
    try {
      const { status, business_unit } = req.query;
      const runs = await listRegularPayrollRuns(supabase, {
        status: status || null,
        businessUnit: business_unit || null,
      });
      return res.json({ runs });
    } catch (err) {
      console.error('[RegularPayrollRoutes] list error:', err);
      return res.status(500).json({ error: err.message || 'Failed to list regular payroll runs' });
    }
  });

  // 2. POST / — Generate a new regular payroll draft (Owner only)
  router.post('/', adminAuth, requireOwner, async (req, res) => {
    try {
      const { period_start, period_end, business_unit, overrides } = req.body || {};
      if (!period_start || !period_end) {
        return res.status(400).json({ error: 'period_start and period_end are required' });
      }

      const result = await generateRegularPayrollDraft(supabase, {
        periodStart: period_start,
        periodEnd: period_end,
        businessUnit: business_unit || 'ALL',
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
        itemOverrides: overrides || {},
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] generate error:', err);
      const status = err.message?.includes('overlapping') ? 409 : 400;
      return res.status(status).json({ error: err.message || 'Failed to generate regular payroll draft' });
    }
  });

  // 3. GET /:id — Get run detail with items and adjustments
  router.get('/:id', adminAuth, async (req, res) => {
    try {
      const runId = req.params.id;
      const { status, business_unit } = req.query;
      const detail = await getRegularPayrollRunDetail(supabase, {
        runId,
        filters: { status, business_unit },
      });
      return res.json(detail);
    } catch (err) {
      console.error('[RegularPayrollRoutes] get run error:', err);
      const status = err.status || (err.message?.includes('not found') ? 404 : 500);
      return res.status(status).json({ error: err.message || 'Failed to get payroll run detail' });
    }
  });

  // 4. POST /:id/lock — Lock a validated DRAFT run (Owner only)
  router.post('/:id/lock', adminAuth, requireOwner, async (req, res) => {
    try {
      const runId = req.params.id;
      const result = await lockRegularPayrollRun(supabase, {
        runId,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });
      return res.json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] lock error:', err);
      return res.status(400).json({ error: err.message || 'Failed to lock payroll run' });
    }
  });

  // 5. POST /:id/adjustments — Add manual adjustment (Owner only)
  router.post('/:id/adjustments', adminAuth, requireOwner, async (req, res) => {
    try {
      const runId = req.params.id;
      const { payroll_regular_item_id, employee_id, type, amount, reason, note } = req.body || {};

      if (!payroll_regular_item_id || !employee_id || !amount || !reason) {
        return res.status(400).json({ error: 'Missing required fields for adjustment' });
      }

      const result = await addRegularPayrollAdjustment(supabase, {
        runId,
        payrollRegularItemId: payroll_regular_item_id,
        employeeId: employee_id,
        type: type || 'OTHER',
        amount: Number(amount),
        reason,
        note,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] add adjustment error:', err);
      return res.status(400).json({ error: err.message || 'Failed to add adjustment' });
    }
  });

  // 6. DELETE /adjustments/:adjId — Delete manual adjustment (Owner only)
  router.delete('/adjustments/:adjId', adminAuth, requireOwner, async (req, res) => {
    try {
      const adjId = req.params.adjId;
      const result = await deleteRegularPayrollAdjustment(supabase, {
        adjustmentId: adjId,
      });
      return res.json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] delete adjustment error:', err);
      return res.status(400).json({ error: err.message || 'Failed to delete adjustment' });
    }
  });

  return router;
}

module.exports = {
  createRegularPayrollRoutes,
};
