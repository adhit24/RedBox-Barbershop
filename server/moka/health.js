'use strict';
// ============================================================
// MOKA POS  —  Health & sync-status summaries for the Command Center
//
// Pure data-fetching helpers, kept separate from routes.js so the health
// classification and outlet-scoping logic can be unit-tested without an
// Express app or a real Supabase connection.
// ============================================================

// Beyond this many minutes since the last SUCCESSFUL pull (outlets.last_polled_at,
// which sync.js only advances when a pull genuinely succeeds — see pullMokaToWeb),
// classify the outlet as sync_error even if its token is still valid. Cron cadence
// today is external (cron-job.org, not configured in this repo) — tune this once
// the real interval is confirmed operationally.
const HEALTH_STALE_MINUTES = 120;

/** @typedef {'healthy'|'expired'|'missing_token'|'sync_error'} MokaOutletHealth */

/**
 * @param {{ connected: boolean, hasToken: boolean, tokenExpired: boolean|null, staleMinutes: number|null }} input
 * @returns {MokaOutletHealth}
 */
function classifyOutletHealth({ connected, hasToken, tokenExpired, staleMinutes }) {
  if (!connected || !hasToken) return 'missing_token';
  if (tokenExpired) return 'expired';
  if (staleMinutes !== null && staleMinutes > HEALTH_STALE_MINUTES) return 'sync_error';
  return 'healthy';
}

/** Today's calendar-day bounds in Asia/Jakarta (WIB, UTC+7, no DST). */
function wibDayBounds(now = new Date()) {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayStr = wib.toISOString().slice(0, 10);
  return {
    dayStr,
    startIso: `${dayStr}T00:00:00+07:00`,
    endIso: `${dayStr}T23:59:59+07:00`,
  };
}

/**
 * Resolves which outlets a caller may see, from req.adminAuth — never from a
 * client-supplied query param. req.adminAuth is set by whichever auth
 * middleware actually authenticated the request:
 *
 *  - Backoffice (since PR #68, server/middleware/backofficeSupabaseAuth.js):
 *    a real Supabase session, verified against the `users` table. Only
 *    produces role 'owner' or 'manager' (createBackofficeSupabaseAuth
 *    rejects any other profile role with 403 before this ever runs).
 *  - The older HMAC session-assertion path (server/services/
 *    adminSessionAssertion.js, used by frontend/'s membership-admin proxy)
 *    produces role 'owner' or 'branch_admin'. It can still reach Moka routes
 *    via createMokaRouter's legacyAdminAuth fallthrough for non-Backoffice
 *    callers, so both scoped-role spellings are handled identically here.
 *  - Legacy/system callers using the raw ADMIN_PASSWORD/CRON_SECRET token
 *    directly (no verified session) get role: null, sessionVerified: false —
 *    unchanged, unrestricted, exactly as before either auth upgrade existed.
 *
 * 'owner' always sees every outlet. A scoped role ('manager' or
 * 'branch_admin') with no branch on file is NOT unrestricted — it fails
 * closed, since an unscoped "manager" would otherwise see every branch's
 * data, which is exactly the authorization bug this resolves.
 * @param {{ role: string|null, branch: string|null }|null|undefined} adminAuth
 * @returns {{ slugs: string[]|null, forbidden?: boolean }} null slugs = unrestricted; forbidden = no valid scope, caller must get 403
 */
function resolveMokaOutletScope(adminAuth) {
  const role = adminAuth?.role ?? null;
  if (role === 'owner') return { slugs: null };
  if (role === 'manager' || role === 'branch_admin') {
    if (adminAuth.branch) return { slugs: [adminAuth.branch] };
    return { slugs: null, forbidden: true };
  }
  return { slugs: null };
}

/**
 * Per-outlet Moka health summary for the Command Center dashboard: connection
 * health, last successful sync, today's transaction volume, and today's
 * unmatched-transaction count. Never returns a token value or a raw
 * upstream/technical error string — only booleans and derived enums.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ outletSlugs?: string[]|null }} [opts]
 */
async function getMokaHealth(supabase, { outletSlugs = null } = {}) {
  let outletQuery = supabase
    .from('outlets')
    .select('id, name, slug, moka_outlet_id, last_polled_at')
    .eq('is_active', true);
  if (outletSlugs && outletSlugs.length > 0) outletQuery = outletQuery.in('slug', outletSlugs);
  const { data: outlets, error: outletsError } = await outletQuery;
  if (outletsError) throw new Error(outletsError.message);

  const { data: tokens, error: tokensError } = await supabase
    .from('moka_tokens')
    .select('outlet_id, expires_at');
  if (tokensError) throw new Error(tokensError.message);
  const tokenMap = new Map((tokens || []).map((t) => [t.outlet_id, t]));

  const { startIso, endIso, dayStr } = wibDayBounds();
  const now = Date.now();

  const outletList = outlets || [];
  const results = await Promise.all(outletList.map(async (outlet) => {
    const token = tokenMap.get(outlet.id);
    const hasToken = Boolean(token);
    const tokenExpired = hasToken ? new Date(token.expires_at).getTime() < now : null;
    const staleMinutes = outlet.last_polled_at
      ? Math.round((now - new Date(outlet.last_polled_at).getTime()) / 60000)
      : null;
    const connected = Boolean(outlet.moka_outlet_id);

    const { data: todaysTx, error: txError } = await supabase
      .from('transactions')
      .select('id, schedule_id')
      .eq('outlet_id', outlet.id)
      .gte('created_at', startIso)
      .lte('created_at', endIso);
    if (txError) throw new Error(txError.message);

    const transactionsToday = (todaysTx || []).length;
    const unmatchedTransactionsToday = (todaysTx || []).filter((t) => !t.schedule_id).length;

    return {
      outletId: outlet.id,
      slug: outlet.slug,
      name: outlet.name,
      connected,
      health: classifyOutletHealth({ connected, hasToken, tokenExpired, staleMinutes }),
      lastSuccessfulSync: outlet.last_polled_at || null,
      transactionsToday,
      unmatchedTransactionsToday,
    };
  }));

  return { today: dayStr, outlets: results };
}

/**
 * Debug-oriented sync status per outlet — schedules-based counts, staleness,
 * and token presence. Shared by the legacy /api/admin/moka-sync-status and the
 * new /api/moka/sync-status so the logic exists in exactly one place.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ outletSlugs?: string[]|null }} [opts]
 */
async function getMokaSyncStatus(supabase, { outletSlugs = null } = {}) {
  const { startIso, endIso, dayStr } = wibDayBounds();

  let outletQuery = supabase
    .from('outlets')
    .select('id, slug, name, moka_outlet_id, last_polled_at')
    .eq('is_active', true);
  if (outletSlugs && outletSlugs.length > 0) outletQuery = outletQuery.in('slug', outletSlugs);
  const { data: outlets, error: outletsError } = await outletQuery;
  if (outletsError) throw new Error(outletsError.message);

  const { data: tokens, error: tokensError } = await supabase
    .from('moka_tokens')
    .select('outlet_id, expires_at, updated_at');
  if (tokensError) throw new Error(tokensError.message);
  const tokenMap = new Map((tokens || []).map((t) => [t.outlet_id, t]));

  const now = Date.now();
  const results = await Promise.all((outlets || []).map(async (o) => {
    const [{ data: completed, error: completedError }, { data: reserved, error: reservedError }] = await Promise.all([
      supabase.from('schedules').select('id')
        .eq('outlet_id', o.id).eq('source', 'moka').eq('status', 'completed')
        .gte('start_time', startIso).lte('start_time', endIso),
      supabase.from('schedules').select('id')
        .eq('outlet_id', o.id).eq('source', 'moka').eq('status', 'reserved')
        .gte('start_time', startIso).lte('start_time', endIso),
    ]);
    if (completedError) throw new Error(completedError.message);
    if (reservedError) throw new Error(reservedError.message);

    const tok = tokenMap.get(o.id);
    const staleMins = o.last_polled_at ? Math.round((now - new Date(o.last_polled_at).getTime()) / 60000) : null;

    return {
      slug: o.slug,
      name: o.name,
      mokaOutletId: o.moka_outlet_id || null,
      lastPolledAt: o.last_polled_at || null,
      staleMinutes: staleMins,
      staleWarn: staleMins !== null && staleMins > 30,
      completedToday: (completed || []).length,
      reservedToday: (reserved || []).length,
      tokenOk: Boolean(tok),
      tokenExpiresAt: tok?.expires_at || null,
    };
  }));

  return { today: dayStr, outlets: results };
}

module.exports = {
  HEALTH_STALE_MINUTES,
  classifyOutletHealth,
  wibDayBounds,
  resolveMokaOutletScope,
  getMokaHealth,
  getMokaSyncStatus,
};
