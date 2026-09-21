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
  listOvertimeApprovals,
  reviewOvertimeApproval,
  syncOvertimeCandidates,
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

  // Helper guard: Owner or Manager (for overtime approvals)
  function requireOwnerOrManager(req, res, next) {
    const role = req.adminAuth?.role;
    if (role !== 'owner' && role !== 'manager') {
      return res.status(403).json({ error: 'Forbidden: Only Owner or Manager can approve overtime' });
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

  // 7. GET /overtime/approvals — List overtime approvals
  router.get('/overtime/approvals', adminAuth, async (req, res) => {
    try {
      const { period_start, period_end, employee_id, status } = req.query;
      const approvals = await listOvertimeApprovals(supabase, {
        periodStart: period_start || null,
        periodEnd: period_end || null,
        employeeId: employee_id || null,
        status: status || null,
      });
      return res.json({ approvals });
    } catch (err) {
      console.error('[RegularPayrollRoutes] list overtime approvals error:', err);
      return res.status(500).json({ error: err.message || 'Failed to list overtime approvals' });
    }
  });

  // 8. POST /overtime/approvals/:id/review — Review overtime candidate (Approve / Reject) (Owner/Manager only)
  router.post('/overtime/approvals/:id/review', adminAuth, requireOwnerOrManager, async (req, res) => {
    try {
      const approvalId = req.params.id;
      const { status, approved_minutes, note } = req.body || {};

      if (!status || !['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
        return res.status(400).json({ error: "status must be 'APPROVED', 'REJECTED', or 'PENDING'" });
      }

      const result = await reviewOvertimeApproval(supabase, {
        approvalId,
        status,
        approvedMinutes: approved_minutes,
        note,
        userEmail: req.adminAuth?.email || 'manager@redbox.id',
      });
      if (result.approval_saved && !result.recalculation_success) {
        // Approval is committed but the payroll snapshot could not follow (e.g. run locked concurrently).
        return res.status(409).json({
          ...result,
          error: `Persetujuan lembur tersimpan, tetapi payroll tidak dapat dihitung ulang (${result.recalculation?.reason || 'RECALCULATION_FAILED'}): ${result.recalculation?.error || ''}`,
        });
      }
      return res.json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] review overtime error:', err);
      return res.status(400).json({ error: err.message || 'Failed to review overtime approval' });
    }
  });

  // 9. POST /overtime/sync — Sync candidate overtime from attendance records (Owner/Manager only)
  router.post('/overtime/sync', adminAuth, requireOwnerOrManager, async (req, res) => {
    try {
      const { period_start, period_end } = req.body || {};
      const result = await syncOvertimeCandidates(supabase, {
        periodStart: period_start || null,
        periodEnd: period_end || null,
      });
      return res.json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] sync overtime candidates error:', err);
      return res.status(500).json({ error: err.message || 'Failed to sync overtime candidates' });
    }
  });

  return router;
}

module.exports = {
  createRegularPayrollRoutes,
};
