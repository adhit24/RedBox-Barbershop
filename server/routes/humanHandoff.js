'use strict';

const express = require('express');
const { getVerifiedStockistAccess } = require('../services/stockistAccess');
const { listWaitingCases, claimCase, resolveCase } = require('../services/humanHandoff');
const { logHandoffEvent } = require('../orchestrator/telemetry');
const { TASK15_PAUSE_SOURCE, clearHumanTakeoverIfSourcedFrom } = require('../../api/wa/webhook');

/**
 * Task 15 — minimal internal endpoints for a human agent to see and take over
 * a WhatsApp handoff case. No dashboard UI in this PR (spec §23) — reuses the
 * same staff auth/role model as the Stockist backoffice (owner/manager/
 * branch_admin with a verified admin session), since a handoff case is worked
 * by the same RedBox staff, not a separate CS-only identity system.
 *
 * Branch authority (Correction Round 1, Blocker 2) follows the same model
 * already enforced for stock transfers (see routes/stockist.js's
 * access.role === 'manager' && access.branch check): owner is always global;
 * a manager is scoped to access.branch only when one is actually assigned to
 * them, otherwise global; branch_admin is always scoped, strictly, to
 * access.branch. access.branch comes from the verified admin session, never
 * from request input, so a branch_admin cannot widen their own scope.
 */
function resolveHandoffBranchScope(access) {
  if (access.role === 'branch_admin') return access.branch;
  if (access.role === 'manager') return access.branch || null;
  return null; // owner — always global
}

function createHumanHandoffRoutes(supabase, adminAuth, deps = {}) {
  const router = express.Router();
  const {
    clearHumanTakeover = (phone) => clearHumanTakeoverIfSourcedFrom(phone, TASK15_PAUSE_SOURCE, { supabase }),
  } = deps;

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
    const branchScope = resolveHandoffBranchScope(access);
    const cases = await listWaitingCases({ supabase, branchScope });
    return res.json({ cases });
  });

  router.post('/cases/:id/claim', adminAuth, async (req, res) => {
    const access = requireStaff(req, res);
    if (!access) return;
    const branchScope = resolveHandoffBranchScope(access);
    const result = await claimCase(req.params.id, access.staffId, { supabase, branchScope });
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
      return res.status(409).json({ error: 'case is not waiting for a human (already claimed, resolved, missing, or not in your branch)' });
    }
    if (result.status === 'unavailable') {
      return res.status(503).json({ error: 'handoff storage unavailable' });
    }
    return res.status(500).json({ error: 'failed to claim case' });
  });

  router.post('/cases/:id/resolve', adminAuth, async (req, res) => {
    const access = requireStaff(req, res);
    if (!access) return;
    const branchScope = resolveHandoffBranchScope(access);
    const result = await resolveCase(req.params.id, { supabase, branchScope });
    if (result.status === 'resolved') {
      // Correction Round 1, Blocker 1b: a resolved case must actually let AI
      // resume. Task 15's own case-creation path may have set the legacy
      // 30-minute wa_paused pause as a secondary safety net (see
      // api/wa/webhook.js) — that pause does not expire just because the
      // case resolved, so it is reconciled here. Source-verified: only
      // clears if the persisted pause is provably Task-15-sourced, never a
      // genuinely separate manual-admin takeover (H4).
      await clearHumanTakeover(result.case.customer_phone).catch(() => {});
      logHandoffEvent({
        event_type: 'handoff_resolved',
        branch: result.case.branch || 'unknown',
        priority: result.case.priority || null,
        status_transition: 'human_active_to_resolved',
      });
      return res.json({ case: result.case });
    }
    if (result.status === 'not_resolvable') {
      return res.status(409).json({ error: 'case is not open (already resolved, missing, or not in your branch)' });
    }
    if (result.status === 'unavailable') {
      return res.status(503).json({ error: 'handoff storage unavailable' });
    }
    return res.status(500).json({ error: 'failed to resolve case' });
  });

  return router;
}

module.exports = { createHumanHandoffRoutes, resolveHandoffBranchScope };
