'use strict';

/**
 * ============================================================
 * REDBOX BARBERSHOP — Moka Order Outbox Service
 * ============================================================
 *
 * Implements persistent idempotency and atomic state transitions for
 * outbound Moka Online Orders.
 *
 * Invariant: 1 Redbox Booking = Maximum 1 Moka Online Order
 *
 * State Machine:
 *   pending    -> worker may claim
 *   processing -> claimed by active worker, locked against other workers
 *   sent       -> order created in Moka, NEVER create again
 *   failed     -> eligible for retry on the SAME logical record
 */

const MAX_ATTEMPTS = 5;

/**
 * Atomically claim an outbox row for outbound processing.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.scheduleId
 * @param {string} [params.bookingId]
 * @param {number} [params.staleMinutes=5]
 * @returns {Promise<{ claimed: boolean, status: string, outboxId?: string, mokaOrderId?: string, attemptCount?: number }>}
 */
async function claimOutboxJob(supabase, { scheduleId, bookingId = null, staleMinutes = 5 }) {
  if (!supabase || !scheduleId) {
    return { claimed: false, status: 'error', error: 'Missing supabase client or scheduleId' };
  }

  // 1. Prefer database atomic RPC if available
  if (typeof supabase.rpc === 'function') {
    try {
      const { data, error } = await supabase.rpc('claim_moka_outbox_job', {
        p_schedule_id: scheduleId,
        p_booking_id: bookingId,
        p_stale_interval: `${staleMinutes} minutes`,
      });

      if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data;
        return {
          claimed: Boolean(row.claimed),
          status: row.status,
          outboxId: row.outbox_id || row.id,
          mokaOrderId: row.moka_order_id,
          attemptCount: row.attempt_count,
        };
      }
    } catch (rpcErr) {
      console.warn('[MokaOutbox] claim RPC fallback to direct query:', rpcErr.message);
    }
  }

  // 2. Direct query fallback (for testing/mock clients or if RPC unavailable)
  try {
    // Check existing row
    const { data: existing } = await supabase
      .from('moka_order_outbox')
      .select('*')
      .eq('schedule_id', scheduleId)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'sent' || existing.moka_order_id) {
        return {
          claimed: false,
          status: 'sent',
          outboxId: existing.id,
          mokaOrderId: existing.moka_order_id,
          attemptCount: existing.attempt_count,
        };
      }

      // Check if fresh processing
      const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
      const isStale = existing.last_attempt_at && existing.last_attempt_at < staleCutoff;
      if (existing.status === 'processing' && !isStale) {
        return {
          claimed: false,
          status: 'processing',
          outboxId: existing.id,
          mokaOrderId: existing.moka_order_id,
          attemptCount: existing.attempt_count,
        };
      }

      // Atomic conditional update
      const now = new Date().toISOString();
      const { data: updated, error: updErr } = await supabase
        .from('moka_order_outbox')
        .update({
          status: 'processing',
          attempt_count: (existing.attempt_count || 0) + 1,
          last_attempt_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .in('status', ['pending', 'failed', 'processing'])
        .select()
        .maybeSingle();

      if (updErr || !updated) {
        return { claimed: false, status: existing.status, outboxId: existing.id };
      }

      return {
        claimed: true,
        status: 'processing',
        outboxId: updated.id,
        mokaOrderId: updated.moka_order_id,
        attemptCount: updated.attempt_count,
      };
    }

    // Row does not exist yet: insert pending and claim
    const now = new Date().toISOString();
    const insertPayload = {
      schedule_id: scheduleId,
      booking_id: bookingId || null,
      status: 'processing',
      attempt_count: 1,
      last_attempt_at: now,
      created_at: now,
      updated_at: now,
    };

    const { data: inserted, error: insErr } = await supabase
      .from('moka_order_outbox')
      .insert(insertPayload)
      .select()
      .maybeSingle();

    if (insErr) {
      // Concurrency conflict: another process created the row first
      const { data: conflicted } = await supabase
        .from('moka_order_outbox')
        .select('*')
        .eq('schedule_id', scheduleId)
        .maybeSingle();

      return {
        claimed: false,
        status: conflicted?.status || 'pending',
        outboxId: conflicted?.id,
        mokaOrderId: conflicted?.moka_order_id,
      };
    }

    return {
      claimed: true,
      status: 'processing',
      outboxId: inserted?.id,
      mokaOrderId: inserted?.moka_order_id,
      attemptCount: 1,
    };
  } catch (err) {
    console.error('[MokaOutbox] claimOutboxJob direct query error:', err.message);
    return { claimed: false, status: 'error', error: err.message };
  }
}

/**
 * Mark outbox job as SENT upon successful Moka order creation.
 * NEVER creates again once sent.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.scheduleId
 * @param {string|number} params.mokaOrderId
 */
async function markOutboxSent(supabase, { scheduleId, mokaOrderId }) {
  if (!supabase || !scheduleId) return;
  const now = new Date().toISOString();
  await supabase
    .from('moka_order_outbox')
    .update({
      status: 'sent',
      moka_order_id: String(mokaOrderId),
      last_error: null,
      updated_at: now,
    })
    .eq('schedule_id', scheduleId);
}

/**
 * Mark outbox job as FAILED when Moka API returns error.
 * Enables controlled retry on the same record.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.scheduleId
 * @param {string} params.error
 */
async function markOutboxFailed(supabase, { scheduleId, error }) {
  if (!supabase || !scheduleId) return;
  const now = new Date().toISOString();
  await supabase
    .from('moka_order_outbox')
    .update({
      status: 'failed',
      last_error: String(error || 'Unknown Moka push failure'),
      updated_at: now,
    })
    .eq('schedule_id', scheduleId);
}

/**
 * Fetch eligible jobs for retry.
 * Excludes 'sent' and excludes fresh 'processing' jobs.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
async function getStaleOrFailedJobs(supabase, options = {}) {
  if (!supabase) return [];
  const {
    limit = 20,
    maxAttempts = MAX_ATTEMPTS,
    staleMinutes = 10,
    pendingWaitMinutes = 2,
  } = options;

  const nowMs = Date.now();
  const staleProcessingCutoff = new Date(nowMs - staleMinutes * 60 * 1000).toISOString();
  const pendingCutoff = new Date(nowMs - pendingWaitMinutes * 60 * 1000).toISOString();

  // Query failed jobs
  const { data: failedJobs } = await supabase
    .from('moka_order_outbox')
    .select('*')
    .eq('status', 'failed')
    .lt('attempt_count', maxAttempts)
    .order('last_attempt_at', { ascending: true })
    .limit(limit);

  // Query stale processing jobs (worker crash recovery)
  const { data: staleJobs } = await supabase
    .from('moka_order_outbox')
    .select('*')
    .eq('status', 'processing')
    .lt('last_attempt_at', staleProcessingCutoff)
    .lt('attempt_count', maxAttempts)
    .order('last_attempt_at', { ascending: true })
    .limit(limit);

  // Query overdue pending jobs
  const { data: pendingJobs } = await supabase
    .from('moka_order_outbox')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', pendingCutoff)
    .lt('attempt_count', maxAttempts)
    .order('created_at', { ascending: true })
    .limit(limit);

  const combined = [
    ...(failedJobs || []),
    ...(staleJobs || []),
    ...(pendingJobs || []),
  ];

  // Deduplicate by id
  const map = new Map();
  for (const job of combined) {
    if (!map.has(job.id)) map.set(job.id, job);
  }

  return Array.from(map.values()).slice(0, limit);
}

module.exports = {
  claimOutboxJob,
  markOutboxSent,
  markOutboxFailed,
  getStaleOrFailedJobs,
  MAX_ATTEMPTS,
};
