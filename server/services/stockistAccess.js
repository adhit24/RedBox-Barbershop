'use strict';

const STOCKIST_BRANCHES = new Set(['bypass', 'sumber', 'samadikun', 'csb', 'tegal']);

function getVerifiedStockistAccess(req) {
  const auth = req.adminAuth;
  if (!auth?.sessionVerified || !['owner', 'branch_admin'].includes(auth.role)) return null;
  if (auth.role === 'owner') {
    return { role: 'owner', branch: null, staffId: auth.staffId };
  }
  const branch = typeof auth.branch === 'string' ? auth.branch.trim().toLowerCase() : '';
  if (!STOCKIST_BRANCHES.has(branch)) return null;
  return { role: 'branch_admin', branch, staffId: auth.staffId };
}

function resolveStockistLocationScope(access, requestedLocationType, requestedBranchSlug) {
  if (access.role === 'branch_admin') {
    const branch = typeof requestedBranchSlug === 'string' ? requestedBranchSlug.trim().toLowerCase() : '';
    if (requestedLocationType !== 'branch' || branch !== access.branch) {
      return { ok: false, status: 403, error: 'branch access denied' };
    }
    return { ok: true, branch: access.branch };
  }

  // owner
  if (requestedLocationType === 'warehouse') {
    return { ok: true, branch: null };
  }
  const branch = typeof requestedBranchSlug === 'string' ? requestedBranchSlug.trim().toLowerCase() : '';
  if (!STOCKIST_BRANCHES.has(branch)) {
    return { ok: false, status: 400, error: 'invalid branch' };
  }
  return { ok: true, branch };
}

module.exports = { STOCKIST_BRANCHES, getVerifiedStockistAccess, resolveStockistLocationScope };
