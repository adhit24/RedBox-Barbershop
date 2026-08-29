'use strict';

/**
 * CRM Integrity Round 1 — canonical customer identity resolver contract.
 *
 * This is a thin wrapper around the existing, already fail-closed
 * server/crm/customerIdentity.js#resolveCustomerIdentity — it does NOT
 * reimplement identity resolution. It exists to:
 *   1. Expose a small, stable, PII-free result shape
 *      ({status, customer_id, match_basis, candidates_count, confidence})
 *      that callers (starting with the CRM/Reddy customer-self path) can
 *      depend on without reaching into the richer internal resolver shape.
 *   2. Add a moka_customer_id fast path — safe because customers
 *      .moka_customer_id is DB-UNIQUE, so a match against it can never be
 *      ambiguous by construction.
 *   3. Emit observer-only Task16 telemetry (see server/orchestrator/
 *      telemetry.js#logCrmIdentityEvent) for every resolution attempt, so
 *      ambiguous/duplicate identity is visible in the existing evaluation
 *      table instead of only ever reaching a console.log.
 *
 * This module does NOT merge, mutate, or create customer rows. It does NOT
 * replace resolveCustomerIdentity's existing callers (e.g.
 * customer360Service.js), which need the richer shape (alias_customer_ids,
 * customer_row, member_profile_row) this wrapper deliberately omits.
 *
 * "If identity is ambiguous: AMBIGUOUS must remain AMBIGUOUS." This wrapper
 * never collapses an ambiguous or not-found result into a guessed
 * customer_id.
 */

const { resolveCustomerIdentity: resolveIdentityCore } = require('../crm/customerIdentity');
const { logCrmIdentityEvent } = require('../orchestrator/telemetry');

const RESOLUTION_TO_STATUS = {
  direct_id_match: 'resolved',
  phone_match: 'resolved',
  member_profile_match: 'resolved',
  not_found: 'not_found',
  missing_input: 'invalid',
  invalid_phone_format: 'invalid',
  ambiguous: 'ambiguous',
  db_error: 'lookup_failed',
};

const RESOLUTION_TO_MATCH_BASIS = {
  direct_id_match: 'customer_id',
  phone_match: 'normalized_phone',
  member_profile_match: 'member_profile',
};

function confidenceForStatus(status) {
  if (status === 'resolved') return 'verified';
  if (status === 'ambiguous') return 'ambiguous';
  return null;
}

function emit(source, status, matchBasis, candidatesCount, normalizedInputPresent) {
  try {
    if (status === 'lookup_failed') {
      logCrmIdentityEvent({ event_type: 'crm_identity_lookup_failed', source, match_basis: matchBasis || null, candidates_count: candidatesCount, normalized_input_present: normalizedInputPresent });
    } else if (status === 'ambiguous') {
      logCrmIdentityEvent({ event_type: 'crm_identity_ambiguous', source, match_basis: matchBasis || null, candidates_count: candidatesCount, normalized_input_present: normalizedInputPresent });
      if (Number.isInteger(candidatesCount) && candidatesCount > 1) {
        logCrmIdentityEvent({ event_type: 'crm_duplicate_identity_detected', source, match_basis: matchBasis || null, candidates_count: candidatesCount, normalized_input_present: normalizedInputPresent });
      }
    } else if (status === 'not_found') {
      logCrmIdentityEvent({ event_type: 'crm_identity_not_found', source, match_basis: matchBasis || null, candidates_count: candidatesCount, normalized_input_present: normalizedInputPresent });
    } else if (status === 'resolved') {
      logCrmIdentityEvent({ event_type: 'crm_identity_resolved', source, match_basis: matchBasis || null, candidates_count: candidatesCount, normalized_input_present: normalizedInputPresent });
    }
  } catch {
    // Observer-only: never let telemetry failure affect identity resolution.
  }
}

/**
 * @param {object} supabase - Supabase client instance
 * @param {object} input - { customer_id, phone, user_key, moka_customer_id }
 * @param {object} [options]
 * @param {string} [options.source] - caller tag for telemetry, e.g. 'crm_customer_self'
 * @returns {Promise<{status:string, customer_id:string|null, match_basis:string|null, candidates_count:number|null, confidence:string|null}>}
 */
async function resolveCustomerIdentity(supabase, input = {}, options = {}) {
  const source = typeof options.source === 'string' ? options.source : 'unknown';
  const normalizedInputPresent = Boolean(input.phone || input.user_key || input.customer_id || input.moka_customer_id);
  const mokaId = typeof input.moka_customer_id === 'string' ? input.moka_customer_id.trim() : null;

  if (mokaId) {
    let mokaRow = null;
    let mokaError = null;
    try {
      const result = await supabase
        .from('customers')
        .select('id')
        .eq('moka_customer_id', mokaId)
        .maybeSingle();
      mokaRow = result.data;
      mokaError = result.error;
    } catch (error) {
      mokaError = error;
    }

    if (mokaError) {
      const result = {
        status: 'lookup_failed',
        customer_id: null,
        match_basis: null,
        candidates_count: null,
        confidence: null,
      };
      emit(source, result.status, result.match_basis, result.candidates_count, normalizedInputPresent);
      return result;
    }

    if (mokaRow) {
      const result = {
        status: 'resolved',
        customer_id: mokaRow.id,
        match_basis: 'moka_customer_id',
        candidates_count: 1,
        confidence: 'verified',
      };
      emit(source, result.status, result.match_basis, result.candidates_count, normalizedInputPresent);
      return result;
    }
    // Not found via moka_customer_id — fall through to phone/id resolution below.
  }

  const core = await resolveIdentityCore(supabase, {
    customer_id: input.customer_id,
    phone: input.phone,
    user_key: input.user_key,
  });

  const status = RESOLUTION_TO_STATUS[core.resolution] || 'invalid';
  const matchBasis = status === 'resolved' ? (RESOLUTION_TO_MATCH_BASIS[core.resolution] || null) : null;
  const candidatesCount = Number.isInteger(core.candidates_count) ? core.candidates_count : null;

  const result = {
    status,
    customer_id: status === 'resolved' ? (core.customer_id || null) : null,
    match_basis: matchBasis,
    candidates_count: candidatesCount,
    confidence: confidenceForStatus(status),
  };

  if (status !== 'invalid') {
    emit(source, status, matchBasis, candidatesCount, normalizedInputPresent);
  }

  return result;
}

module.exports = {
  resolveCustomerIdentity,
};
