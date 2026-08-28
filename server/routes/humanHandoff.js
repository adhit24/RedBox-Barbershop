'use strict';

const express = require('express');
const { getVerifiedStockistAccess } = require('../services/stockistAccess');
const { listWaitingCases, claimCase, resolveCase } = require('../services/humanHandoff');
const { logHandoffEvent } = require('../orchestrator/telemetry');

/**
 * Task 15 — minimal internal endpoints for a human agent to see and take over
 * a WhatsApp handoff case. No dashboard UI in this PR (spec §23) — reuses the
 * same staff auth/role model as the Stockist backoffice (owner/manager/
 * branch_admin with a verified admin session), since a handoff case is worked
 * by the same RedBox staff, not a separate CS-only identity system.
 */
function createHumanHandoffRoutes(supabase, adminAuth) {
  const router = express.Router();

  function requireStaff(req, res) {
    const access = getVerifiedStockistAccess(req);
    if (!access) {
      res.status(403).json({ error: 'staff access required' });
      return null;
    }
    return access;
  }

  router.get('/cases', adminAuth, async (req, res) => {
    const access = requireStaff(req, res);
    if (!access) return;
    const cases = await listWaitingCases({ supabase });
    return res.json({ cases });
  });

  router.post('/cases/:id/claim', adminAuth, async (req, res) => {
    const access = requireStaff(req, res);
    if (!access) return;
    const result = await claimCase(req.params.id, access.staffId, { supabase });
    if (result.status === 'claimed') {
      logHandoffEvent({
        event_type: 'handoff_human_claimed',
        branch: result.case.branch || 'unknown',
        priority: result.case.priority || null,
        status_transition: 'waiting_human_to_human_active',
      });
      return res.json({ case: result.case });
    }
    if (result.status === 'not_claimable') {
      return res.status(409).json({ error: 'case is not waiting for a human (already claimed, resolved, or missing)' });
    }
    if (result.status === 'unavailable') {
      return res.status(503).json({ error: 'handoff storage unavailable' });
    }
    return res.status(500).json({ error: 'failed to claim case' });
  });

  router.post('/cases/:id/resolve', adminAuth, async (req, res) => {
    const access = requireStaff(req, res);
    if (!access) return;
    const result = await resolveCase(req.params.id, { supabase });
    if (result.status === 'resolved') {
      logHandoffEvent({
        event_type: 'handoff_resolved',
        branch: result.case.branch || 'unknown',
        priority: result.case.priority || null,
        status_transition: 'human_active_to_resolved',
      });
      return res.json({ case: result.case });
    }
    if (result.status === 'not_resolvable') {
      return res.status(409).json({ error: 'case is not open (already resolved or missing)' });
    }
    if (result.status === 'unavailable') {
      return res.status(503).json({ error: 'handoff storage unavailable' });
    }
    return res.status(500).json({ error: 'failed to resolve case' });
  });

  return router;
}

module.exports = { createHumanHandoffRoutes };
