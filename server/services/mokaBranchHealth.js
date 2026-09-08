'use strict';

const DELAY_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Derives a branch's Moka health state deterministically.
 *
 * Suggested states:
 * - NOT_CONFIGURED: Missing moka_outlet_id or token row
 * - TOKEN_EXPIRED: Token expired timestamp has passed
 * - ERROR: Last sync failed or has last_error
 * - PARTIAL: Last sync was partial or has unmapped items / open anomalies
 * - DELAYED: More than 2 hours since last successful sync (or never synced)
 * - HEALTHY: Valid token, recent successful sync, no errors or partial lines
 *
 * @param {object} outlet
 * @param {object|null} token
 * @param {object|null} syncState
 * @param {Date} [now]
 */
function deriveBranchHealth(outlet, token, syncState, now = new Date()) {
  const mokaOutletId = outlet?.moka_outlet_id || null;
  const hasToken = Boolean(token);
  const tokenExpiresAt = token?.expires_at || null;
  const tokenExpired = Boolean(tokenExpiresAt && new Date(tokenExpiresAt) < now);

  const lastSuccessfulSyncAt = syncState?.last_successful_sync_at || null;
  const lastStartedAt = syncState?.last_started_at || null;
  const lastStatus = syncState?.last_status || null;
  const lastError = syncState?.last_error || null;
  const stats = syncState?.last_run_stats || null;

  let healthState = 'HEALTHY';
  let attentionReason = null;

  if (!mokaOutletId || !hasToken) {
    healthState = 'NOT_CONFIGURED';
    attentionReason = !mokaOutletId
      ? 'Moka outlet ID belum dikonfigurasi'
      : 'Token Moka belum tersedia';
  } else if (tokenExpired) {
    healthState = 'TOKEN_EXPIRED';
    attentionReason = 'Token Moka telah kedaluwarsa';
  } else if (lastStatus === 'FAILED' || Boolean(lastError)) {
    healthState = 'ERROR';
    attentionReason = lastError || 'Sinkronisasi terakhir gagal';
  } else if (lastStatus === 'PARTIAL' || (stats && (stats.unmapped > 0 || stats.anomalies > 0))) {
    healthState = 'PARTIAL';
    attentionReason = (stats?.unmapped > 0)
      ? `${stats.unmapped} item belum terpetakan`
      : 'Sebagian transaksi memerlukan perhatian';
  } else if (!lastSuccessfulSyncAt || (now.getTime() - new Date(lastSuccessfulSyncAt).getTime()) > DELAY_THRESHOLD_MS) {
    healthState = 'DELAYED';
    attentionReason = lastSuccessfulSyncAt
      ? 'Sinkronisasi terakhir lebih dari 2 jam lalu'
      : 'Belum pernah ada sinkronisasi berhasil';
  } else {
    healthState = 'HEALTHY';
    attentionReason = null;
  }

  return {
    outletId: outlet.id,
    name: outlet.name,
    slug: outlet.slug,
    mokaOutletId,
    hasToken,
    tokenExpiresAt,
    tokenExpired,
    lastSuccessfulSyncAt,
    lastStartedAt,
    lastStatus,
    lastError,
    healthState,
    attentionReason,
    stats: stats
      ? {
          fetched: stats.fetched || 0,
          unmapped: stats.unmapped || 0,
          anomalies: stats.anomalies || 0,
          processed: stats.processed || 0,
          qtyDeducted: stats.qty_deducted || 0,
          skippedDuplicate: stats.skipped_duplicate || 0,
        }
      : null,
  };
}

/**
 * Returns read-only branch health overview for Backoffice.
 * Scoped strictly by verified adminAuth role and branch.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {object} params.auth - req.adminAuth populated by createBackofficeSupabaseAuth
 * @param {Date} [params.now]
 */
async function getBranchHealthOverview({ supabase, auth, now = new Date() }) {
  if (!auth?.sessionVerified) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  if (auth.role !== 'owner' && auth.role !== 'manager') {
    const err = new Error('Forbidden: Insufficient permissions');
    err.status = 403;
    throw err;
  }

  let branchScope = null;
  if (auth.role === 'manager') {
    const rawBranch = typeof auth.branch === 'string' ? auth.branch.trim().toLowerCase() : '';
    if (!rawBranch) {
      const err = new Error('Forbidden: Manager has no assigned branch');
      err.status = 403;
      throw err;
    }
    branchScope = rawBranch;
  }

  let outletQuery = supabase
    .from('outlets')
    .select('id, name, slug, moka_outlet_id, is_active')
    .eq('is_active', true);

  if (branchScope) {
    outletQuery = outletQuery.eq('slug', branchScope);
  }

  // Strictly select non-sensitive fields from tokens — NO secrets or access_token selected!
  const [{ data: outlets, error: outErr }, { data: tokens, error: tokErr }, { data: syncStates, error: stateErr }] = await Promise.all([
    outletQuery,
    supabase.from('moka_tokens').select('outlet_id, expires_at, updated_at'),
    supabase.from('moka_stockist_sync_state').select('*'),
  ]);

  if (outErr) throw new Error(outErr.message);
  if (tokErr) throw new Error(tokErr.message);
  if (stateErr) throw new Error(stateErr.message);

  const tokenByOutletId = new Map((tokens || []).map((t) => [t.outlet_id, t]));
  const syncStateByOutletId = new Map((syncStates || []).map((s) => [s.outlet_id, s]));

  // Operational Moka branches: active branches with moka_outlet_id configured, or all scoped active branches
  const branches = (outlets || []).map((outlet) => {
    const token = tokenByOutletId.get(outlet.id) || null;
    const syncState = syncStateByOutletId.get(outlet.id) || null;
    return deriveBranchHealth(outlet, token, syncState, now);
  });

  return { branches };
}

module.exports = {
  DELAY_THRESHOLD_MS,
  deriveBranchHealth,
  getBranchHealthOverview,
};
