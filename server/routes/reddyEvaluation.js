'use strict';

const express = require('express');
const { getVerifiedStockistAccess } = require('../services/stockistAccess');
const { BRANCHES, getHealthSummary } = require('../services/reddyEvaluationMonitoring');

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

function parseWindow(query = {}, now = new Date()) {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return null;
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

function resolveEvaluationBranch(access, requestedBranch) {
  if (access.role === 'branch_admin') return access.branch;
  if (access.role === 'manager' && access.branch) return access.branch;
  if (!requestedBranch) return null;
  const normalized = String(requestedBranch).trim().toLowerCase();
  return BRANCHES.has(normalized) ? normalized : undefined;
}

function createReddyEvaluationRoutes(supabase, adminAuth, deps = {}) {
  const router = express.Router();
  const healthSummary = deps.getHealthSummary || getHealthSummary;

  router.get('/health', adminAuth, async (req, res) => {
    const access = getVerifiedStockistAccess(req);
    if (!access) return res.status(403).json({ error: 'verified staff access required' });
    const window = parseWindow(req.query);
    if (!window) return res.status(400).json({ error: 'invalid period; maximum window is 31 days' });
    const branch = resolveEvaluationBranch(access, req.query.branch);
    if (branch === undefined) return res.status(400).json({ error: 'invalid branch' });

    const result = await healthSummary({ supabase, ...window, branch });
    if (result.status !== 'ok') return res.status(503).json({ error: 'evaluation health unavailable' });
    return res.json(result.summary);
  });

  return router;
}

module.exports = { createReddyEvaluationRoutes, parseWindow, resolveEvaluationBranch, MAX_WINDOW_MS };
