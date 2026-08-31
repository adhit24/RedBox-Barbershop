'use strict';

/**
 * Task 17.3 — Transaction -> Customer Linkage (CRM Integrity Round 4).
 *
 * Single canonical authority for determining transaction ownership by a CRM customer.
 *
 * Core Business & Technical Contract:
 *   1. TRANSACTION INGESTION MUST FAIL OPEN: Revenue and transaction records are always
 *      saved regardless of whether customer attribution succeeds.
 *   2. CUSTOMER IDENTITY MUST FAIL CLOSED: customer_id is assigned NULL whenever identity
 *      cannot be proven uniquely (ambiguous, missing, invalid, or lookup failure).
 *   3. NO AMBIGUITY OVERWRITE: Duplicate moka_customer_id or duplicate phone numbers in DB
 *      must produce ambiguous status and customer_id = NULL. No arbitrary tie-breakers.
 *   4. PROVENANCE AWARENESS: Existing customer_id on a transaction is preserved only if
 *      backed by `verified_redbox_fk` provenance (e.g. from an authenticated web booking).
 *   5. ZERO PII LOGGING: Telemetry is strictly privacy-minimized.
 */

const { resolveCustomerIdentity } = require('./customerIdentityResolver');
const { logTransactionLinkageEvent } = require('../orchestrator/telemetry');
const { normalizePhoneNumber } = require('../identity/phoneNormalization');

const STATUS = Object.freeze({
  ALREADY_LINKED_AUTHORITATIVE: 'linked_existing_authoritative',
  LINKED_UNIQUE_MOKA: 'linked_unique_moka',
  LINKED_UNIQUE_PHONE: 'linked_unique_phone',
  SAFE_CREATED_CUSTOMER: 'linked_created_customer',
  AMBIGUOUS_MOKA: 'ambiguous_moka',
  AMBIGUOUS_PHONE: 'ambiguous_phone',
  NOT_FOUND: 'not_found',
  INVALID: 'invalid',
  LOOKUP_FAILED: 'lookup_failed',
});

const PROVENANCE = Object.freeze({
  VERIFIED_REDBOX_FK: 'verified_redbox_fk',
  CREATED_AFTER_CANONICAL_NOT_FOUND: 'created_after_canonical_not_found',
  UNVERIFIED_LEGACY_RESOLUTION: 'unverified_legacy_resolution',
  NONE: 'none',
});

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function buildPlan({ status, transactionId = null, currentCustomerId = null, proposedCustomerId = null, authoritySource = 'none', candidatesCount = 0, reason }) {
  const safeToLink = (
    status === STATUS.ALREADY_LINKED_AUTHORITATIVE ||
    status === STATUS.LINKED_UNIQUE_MOKA ||
    status === STATUS.LINKED_UNIQUE_PHONE ||
    status === STATUS.SAFE_CREATED_CUSTOMER
  );

  const finalCustomerId = safeToLink
    ? (proposedCustomerId || currentCustomerId || null)
    : null;

  return Object.freeze({
    status,
    transaction_id: transactionId,
    current_customer_id: isNonEmptyString(currentCustomerId) ? currentCustomerId : null,
    proposed_customer_id: safeToLink ? finalCustomerId : null,
    customer_id: finalCustomerId,
    authority_source: authoritySource,
    candidates_count: Number.isInteger(candidatesCount) ? candidatesCount : 0,
    safe_to_link: safeToLink,
    reason,
  });
}


/**
 * Pure classification planner. Zero DB access.
 *
 * Evaluates bounded identity evidence and returns a structured linkage plan.
 *
 * @param {object} params
 * @param {object} [params.transaction] - { id, customer_id }
 * @param {string} [params.provenance] - 'verified_redbox_fk' | 'unverified_legacy_resolution' | 'none'
 * @param {object|null} [params.mokaResolverResult] - { status, customer_id, candidates_count }
 * @param {object|null} [params.phoneResolverResult] - { status, customer_id, candidates_count, match_basis }
 * @returns {Readonly<{status, transaction_id, current_customer_id, proposed_customer_id, customer_id, authority_source, candidates_count, safe_to_link, reason}>}
 */
function planTransactionCustomerLinkage({
  transaction = {},
  provenance = PROVENANCE.NONE,
  mokaResolverResult = null,
  phoneResolverResult = null,
} = {}) {
  const txId = transaction?.id || null;
  const currentCustomerId = isNonEmptyString(transaction?.customer_id) ? transaction.customer_id : null;

  // 1. Authoritative Existing FK (verified Redbox business flow)
  if (currentCustomerId && provenance === PROVENANCE.VERIFIED_REDBOX_FK) {
    return buildPlan({
      status: STATUS.ALREADY_LINKED_AUTHORITATIVE,
      transactionId: txId,
      currentCustomerId,
      proposedCustomerId: currentCustomerId,
      authoritySource: 'verified_redbox_fk',
      candidatesCount: 1,
      reason: 'existing_customer_id_is_authoritative_redbox_fk',
    });
  }

  // 2. Moka Customer ID Evidence
  if (mokaResolverResult) {
    if (mokaResolverResult.status === 'lookup_failed') {
      return buildPlan({
        status: STATUS.LOOKUP_FAILED,
        transactionId: txId,
        currentCustomerId,
        authoritySource: 'explicit_moka_customer_id',
        candidatesCount: 0,
        reason: 'moka_customer_id_lookup_failed',
      });
    }

    if (mokaResolverResult.status === 'ambiguous' || (mokaResolverResult.candidates_count && mokaResolverResult.candidates_count > 1)) {
      return buildPlan({
        status: STATUS.AMBIGUOUS_MOKA,
        transactionId: txId,
        currentCustomerId,
        authoritySource: 'explicit_moka_customer_id',
        candidatesCount: mokaResolverResult.candidates_count || 2,
        reason: 'moka_customer_id_matched_multiple_customer_rows',
      });
    }

    if (mokaResolverResult.status === 'resolved' && isNonEmptyString(mokaResolverResult.customer_id) && mokaResolverResult.candidates_count === 1) {
      return buildPlan({
        status: STATUS.LINKED_UNIQUE_MOKA,
        transactionId: txId,
        currentCustomerId,
        proposedCustomerId: mokaResolverResult.customer_id,
        authoritySource: 'explicit_moka_customer_id',
        candidatesCount: 1,
        reason: 'moka_customer_id_matched_unique_customer_row',
      });
    }
  }

  // 3. Normalized Phone Evidence
  if (phoneResolverResult) {
    if (phoneResolverResult.status === 'lookup_failed') {
      return buildPlan({
        status: STATUS.LOOKUP_FAILED,
        transactionId: txId,
        currentCustomerId,
        authoritySource: 'normalized_phone',
        candidatesCount: 0,
        reason: 'phone_lookup_failed',
      });
    }

    if (phoneResolverResult.status === 'ambiguous' || (phoneResolverResult.candidates_count && phoneResolverResult.candidates_count > 1)) {
      return buildPlan({
        status: STATUS.AMBIGUOUS_PHONE,
        transactionId: txId,
        currentCustomerId,
        authoritySource: 'normalized_phone',
        candidatesCount: phoneResolverResult.candidates_count || 2,
        reason: 'phone_matched_multiple_customer_rows',
      });
    }

    if (phoneResolverResult.status === 'resolved' && isNonEmptyString(phoneResolverResult.customer_id) && phoneResolverResult.candidates_count === 1) {
      return buildPlan({
        status: STATUS.LINKED_UNIQUE_PHONE,
        transactionId: txId,
        currentCustomerId,
        proposedCustomerId: phoneResolverResult.customer_id,
        authoritySource: 'normalized_phone',
        candidatesCount: 1,
        reason: 'phone_matched_unique_customer_row',
      });
    }

    if (phoneResolverResult.status === 'invalid') {
      return buildPlan({
        status: STATUS.INVALID,
        transactionId: txId,
        currentCustomerId,
        authoritySource: 'normalized_phone',
        candidatesCount: 0,
        reason: 'phone_identity_input_invalid',
      });
    }
  }

  // 4. Default Not Found / Missing Evidence
  return buildPlan({
    status: STATUS.NOT_FOUND,
    transactionId: txId,
    currentCustomerId,
    authoritySource: 'none',
    candidatesCount: 0,
    reason: 'no_matching_customer_found',
  });
}

/**
 * Orchestrator helper: queries DB for evidence, executes planner, emits telemetry.
 *
 * @param {object} supabase - Supabase client
 * @param {object} evidence - Identity evidence bundle:
 *   {
 *     transaction: { id, customer_id },
 *     provenance: 'verified_redbox_fk' | 'unverified_legacy_resolution' | 'none',
 *     mokaCustomerId: string|null,
 *     phone: string|null,
 *     sourceSystem: string,
 *     branch: string|null,
 *   }
 * @param {object} [options]
 * @returns {Promise<Readonly<{status, transaction_id, current_customer_id, proposed_customer_id, customer_id, authority_source, candidates_count, safe_to_link, reason}>>}
 */
async function resolveTransactionCustomerLinkage(supabase, evidence = {}, options = {}) {
  const transaction = evidence.transaction || {};
  const provenance = evidence.provenance || PROVENANCE.NONE;
  const mokaCustomerId = isNonEmptyString(evidence.mokaCustomerId) ? evidence.mokaCustomerId.trim() : null;
  const rawPhone = isNonEmptyString(evidence.phone) ? evidence.phone.trim() : null;
  const sourceSystem = evidence.sourceSystem || options.source || 'moka_sync';
  const branch = evidence.branch || null;

  // Shortcut 1: Authoritative Redbox FK
  if (isNonEmptyString(transaction.customer_id) && provenance === PROVENANCE.VERIFIED_REDBOX_FK) {
    const plan = planTransactionCustomerLinkage({ transaction, provenance });
    emitTelemetry(plan, sourceSystem, branch);
    return plan;
  }

  let mokaResolverResult = null;
  // Step 1: Check Moka Customer ID directly without assuming uniqueness
  if (mokaCustomerId) {
    try {
      const { data: rows, error } = await supabase
        .from('customers')
        .select('id')
        .eq('moka_customer_id', mokaCustomerId);

      if (error) {
        mokaResolverResult = { status: 'lookup_failed', customer_id: null, candidates_count: 0 };
      } else if (!rows || rows.length === 0) {
        mokaResolverResult = { status: 'not_found', customer_id: null, candidates_count: 0 };
      } else if (rows.length === 1) {
        mokaResolverResult = { status: 'resolved', customer_id: rows[0].id, candidates_count: 1 };
      } else {
        // Ambiguous duplicate moka_customer_id in DB!
        mokaResolverResult = { status: 'ambiguous', customer_id: null, candidates_count: rows.length };
      }
    } catch (_) {
      mokaResolverResult = { status: 'lookup_failed', customer_id: null, candidates_count: 0 };
    }

    // If Moka ID match is resolved or ambiguous, evaluate plan immediately
    if (mokaResolverResult.status === 'resolved' || mokaResolverResult.status === 'ambiguous' || mokaResolverResult.status === 'lookup_failed') {
      const plan = planTransactionCustomerLinkage({
        transaction,
        provenance,
        mokaResolverResult,
      });
      emitTelemetry(plan, sourceSystem, branch);
      return plan;
    }
  }

  let phoneResolverResult = null;
  // Step 2: Check Phone via canonical customerIdentityResolver
  if (rawPhone) {
    try {
      const res = await resolveCustomerIdentity(supabase, { phone: rawPhone }, { source: sourceSystem });
      phoneResolverResult = {
        status: res.status,
        customer_id: res.customer_id,
        candidates_count: res.candidates_count,
        match_basis: res.match_basis,
      };
    } catch (_) {
      phoneResolverResult = { status: 'lookup_failed', customer_id: null, candidates_count: 0 };
    }
  }

  const plan = planTransactionCustomerLinkage({
    transaction,
    provenance,
    mokaResolverResult,
    phoneResolverResult,
  });

  emitTelemetry(plan, sourceSystem, branch);
  return plan;
}

function emitTelemetry(plan, sourceSystem, branch) {
  try {
    logTransactionLinkageEvent({
      status: plan.status,
      authority_source: plan.authority_source,
      source_system: sourceSystem,
      branch: branch || 'unknown',
      linkage_attempted: true,
      linked: plan.safe_to_link,
      reason_code: plan.reason,
    });
  } catch (_) {
    // Fail silent for telemetry
  }
}

/**
 * Safe customer maintenance helper.
 *
 * Gated explicitly behind canonical identity resolution plan:
 *   1. NEVER creates or mutates customer rows on AMBIGUOUS, LOOKUP_FAILED, or INVALID plans.
 *   2. Backfills moka_customer_id ONLY when plan is LINKED_UNIQUE_PHONE and moka_customer_id is un-duplicated.
 *   3. Creates a new customer row ONLY when plan is NOT_FOUND and identity input is valid, with zero conflicting rows.
 *
 * @param {object} supabase
 * @param {object} customerData - { phone, customer_phone, id, moka_customer_id, customer_id, name, customer_name, email }
 * @param {object} canonicalPlan - Resolution plan returned by resolveTransactionCustomerLinkage / planTransactionCustomerLinkage
 * @returns {Promise<{ action: string, customer_id: string|null, reason?: string }>}
 */
async function maintainCustomerRecordSafely(supabase, customerData = {}, canonicalPlan = {}) {
  if (!customerData) return { action: 'none', customer_id: null };

  const rawPhone = customerData.phone || customerData.customer_phone || customerData.phone_number || null;
  const normalizedDigits = typeof rawPhone === 'string' ? normalizePhoneNumber(rawPhone) : null;
  const phoneE164 = normalizedDigits ? `+${normalizedDigits}` : null;
  const rawMokaId = customerData.id || customerData.moka_customer_id || customerData.customer_id || null;
  const mokaId = isNonEmptyString(rawMokaId) ? String(rawMokaId).trim() : null;
  const name = customerData.name || customerData.customer_name || 'Moka Customer';
  const email = customerData.email || null;

  // 1. NEVER mutate/create customer on ambiguous, lookup_failed, or invalid
  if (
    canonicalPlan.status === STATUS.AMBIGUOUS_MOKA ||
    canonicalPlan.status === STATUS.AMBIGUOUS_PHONE ||
    canonicalPlan.status === STATUS.LOOKUP_FAILED ||
    canonicalPlan.status === STATUS.INVALID
  ) {
    return { action: 'none', customer_id: null, reason: 'canonical_plan_is_ambiguous_or_failed' };
  }

  // 2. Safe Backfill Moka ID onto an existing uniquely linked phone customer
  if (canonicalPlan.status === STATUS.LINKED_UNIQUE_PHONE && isNonEmptyString(canonicalPlan.customer_id) && mokaId) {
    const { data: existingMokaRows } = await supabase
      .from('customers')
      .select('id')
      .eq('moka_customer_id', mokaId);

    if (!existingMokaRows || existingMokaRows.length === 0) {
      await supabase
        .from('customers')
        .update({ moka_customer_id: mokaId })
        .eq('id', canonicalPlan.customer_id);
      return { action: 'moka_id_backfilled', customer_id: canonicalPlan.customer_id };
    } else {
      return { action: 'backfill_skipped_duplicate_moka_id', customer_id: canonicalPlan.customer_id };
    }
  }

  // 3. Safe Customer Creation: ONLY when canonical plan is NOT_FOUND
  if (canonicalPlan.status === STATUS.NOT_FOUND) {
    if (!phoneE164 && !email && !mokaId) {
      return { action: 'none', customer_id: null, reason: 'insufficient_identity_input' };
    }

    // Verify no conflicting moka_customer_id exists
    if (mokaId) {
      const { data: mokaCheck } = await supabase
        .from('customers')
        .select('id')
        .eq('moka_customer_id', mokaId);
      if (mokaCheck && mokaCheck.length > 0) {
        return { action: 'creation_blocked_conflicting_moka_id', customer_id: null };
      }
    }

    // Verify no conflicting phone exists
    if (phoneE164) {
      const { data: phoneCheck } = await supabase
        .from('customers')
        .select('id')
        .eq('phone_e164', phoneE164);
      if (phoneCheck && phoneCheck.length > 0) {
        return { action: 'creation_blocked_conflicting_phone', customer_id: null };
      }
    }

    // Safely insert new customer row
    const { data: newCust, error: insertErr } = await supabase
      .from('customers')
      .insert({
        name,
        wa: phoneE164 || '',
        phone_e164: phoneE164 || null,
        email,
        source: 'moka',
        moka_customer_id: mokaId || null,
      })
      .select('id')
      .single();

    if (insertErr || !newCust) {
      return { action: 'creation_failed', customer_id: null };
    }

    return { action: 'customer_created', customer_id: newCust.id };
  }

  return { action: 'none', customer_id: canonicalPlan.customer_id || null };
}

module.exports = {
  STATUS,
  PROVENANCE,
  planTransactionCustomerLinkage,
  resolveTransactionCustomerLinkage,
  maintainCustomerRecordSafely,
};

