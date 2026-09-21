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

function createRegularPayrollRoutes(supabase, legacyAdminAuth, options = {}) {
  const router = express.Router();
  // options.adminAuth lets tests inject the auth middleware; production always uses Supabase auth.
  const adminAuth = options.adminAuth || createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  // Compensation (salary, allowances, deductions, adjustments, take-home) authority:
  //   OWNER   -> every unit / branch
  //   MANAGER -> only employees of the branch in the VERIFIED session (never a query/body value)
  //   anything else (incl. BRANCH_ADMIN) and a manager without an assigned branch -> denied (fail closed)
  function compensationScope(req, res, next) {
    const role = req.adminAuth?.role;
    if (role === 'owner') {
      req.compensationBranchScope = null;
      return next();
    }
    if (role === 'manager' && req.adminAuth?.branch) {
      req.compensationBranchScope = req.adminAuth.branch;
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: rincian kompensasi payroll hanya untuk Owner atau Manager cabang yang ditetapkan' });
  }

  // Overtime branch authority: OWNER -> all branches; MANAGER / BRANCH_ADMIN -> the branch assigned in
  // their verified session (employee branch, never the fingerprint machine). A branch-bound role
  // without an assigned branch gets no overtime access (fail closed).
  function overtimeScope(req, res, next) {
    const role = req.adminAuth?.role;
    if (role === 'owner') {
      req.overtimeBranchScope = null;
      return next();
    }
    const branch = req.adminAuth?.branch;
    if (!branch) {
      return res.status(403).json({ error: 'Forbidden: akun belum memiliki cabang yang ditetapkan untuk persetujuan lembur' });
    }
    req.overtimeBranchScope = branch;
    return next();
  }

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
  router.get('/', adminAuth, compensationScope, async (req, res) => {
    try {
      const { status, business_unit } = req.query;
      const runs = await listRegularPayrollRuns(supabase, {
        status: status || null,
        businessUnit: business_unit || null,
        branchScope: req.compensationBranchScope,
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
      const status = (err.code === 'OVERLAPPING_RUN' || /overlapping/i.test(err.message || '')) ? 409 : 400;
      return res.status(status).json({ error: err.message || 'Failed to generate regular payroll draft' });
    }
  });

  // 3. GET /:id — Get run detail with items and adjustments
  router.get('/:id', adminAuth, compensationScope, async (req, res) => {
    try {
      const runId = req.params.id;
      const { status, business_unit } = req.query;
      const detail = await getRegularPayrollRunDetail(supabase, {
        runId,
        filters: { status, business_unit },
        branchScope: req.compensationBranchScope,
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

      // employee_id is optional and only cross-checked against the item; the employee is derived server-side
      if (!payroll_regular_item_id || !amount || !reason) {
        return res.status(400).json({ error: 'Missing required fields for adjustment' });
      }

      const result = await addRegularPayrollAdjustment(supabase, {
        runId,
        payrollRegularItemId: payroll_regular_item_id,
        employeeId: employee_id || undefined,
        type: type || 'OTHER',
        amount: Number(amount),
        reason,
        note,
        userEmail: req.adminAuth?.email || 'owner@redbox.id',
      });

      if (result.adjustment_saved && !result.recalculation_success) {
        return res.status(result.reason === 'RUN_LOCKED_CONCURRENTLY' ? 409 : 500).json({
          ...result,
          error: `Penyesuaian tersimpan, tetapi payroll tidak dapat dihitung ulang (${result.reason}): ${result.error}`,
        });
      }
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
      if (result.adjustment_deleted && !result.recalculation_success) {
        return res.status(result.reason === 'RUN_LOCKED_CONCURRENTLY' ? 409 : 500).json({
          ...result,
          error: `Penyesuaian dihapus, tetapi payroll tidak dapat dihitung ulang (${result.reason}): ${result.error}`,
        });
      }
      return res.json(result);
    } catch (err) {
      console.error('[RegularPayrollRoutes] delete adjustment error:', err);
      return res.status(400).json({ error: err.message || 'Failed to delete adjustment' });
    }
  });

  // 7. GET /overtime/approvals — List overtime approvals
  router.get('/overtime/approvals', adminAuth, overtimeScope, async (req, res) => {
    try {
      const { period_start, period_end, employee_id, status } = req.query;
      const approvals = await listOvertimeApprovals(supabase, {
        periodStart: period_start || null,
        periodEnd: period_end || null,
        employeeId: employee_id || null,
        status: status || null,
        branchScope: req.overtimeBranchScope,
      });
      return res.json({ approvals });
    } catch (err) {
      console.error('[RegularPayrollRoutes] list overtime approvals error:', err);
      return res.status(500).json({ error: err.message || 'Failed to list overtime approvals' });
    }
  });

  // 8. POST /overtime/approvals/:id/review — Review overtime candidate (Approve / Reject) (Owner/Manager only)
  router.post('/overtime/approvals/:id/review', adminAuth, requireOwnerOrManager, overtimeScope, async (req, res) => {
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
        branchScope: req.overtimeBranchScope,
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
      if (err.code === 'FORBIDDEN_BRANCH') return res.status(403).json({ error: err.message });
      if (err.code === 'RUN_LOCKED') return res.status(409).json({ error: err.message, code: err.code });
      if (err.code === 'INVALID_OVERTIME_MINUTES') return res.status(400).json({ error: err.message, code: err.code });
      return res.status(400).json({ error: err.message || 'Failed to review overtime approval' });
    }
  });

  // 9. POST /overtime/sync — Sync candidate overtime from attendance records (Owner/Manager only)
  router.post('/overtime/sync', adminAuth, requireOwnerOrManager, overtimeScope, async (req, res) => {
    try {
      const { period_start, period_end } = req.body || {};
      const result = await syncOvertimeCandidates(supabase, {
        periodStart: period_start || null,
        periodEnd: period_end || null,
        branchScope: req.overtimeBranchScope,
      });
      if (!result.success) {
        // Never report a failed reconciliation as success. State conflicts (locked run, duplicate candidate
        // from a concurrent sync) are 409; anything else is an unexpected persistence failure (500).
        const messages = [
          ...result.insert_errors.map((e) => e.error),
          ...result.update_errors.map((e) => e.error),
          ...result.delete_errors.map((e) => e.error),
          ...result.recalculation_errors.map((e) => e.message),
        ];
        const conflict = messages.some((m) => /LOCKED|duplicate key|unique constraint/i.test(m || ''));
        return res.status(conflict ? 409 : 500).json({
          ...result,
          error: `Sinkronisasi lembur gagal atau hanya sebagian berhasil (${messages.length} kegagalan): ${messages[0] || 'unknown'}`,
        });
      }
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
