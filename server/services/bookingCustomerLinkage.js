'use strict';

/**
 * Task 17.2 — Booking -> Customer Linkage (CRM Integrity Round 3).
 *
 * Two layers in this file:
 *   1. planBookingCustomerLinkage — PURE classification logic, NO DATABASE
 *      ACCESS of any kind. Callers resolve identity first (via
 *      server/services/customerIdentityResolver.js's `resolveCustomerIdentity`,
 *      the ONLY sanctioned identity authority — see that module's own doc
 *      header) and pass the already-computed result in; this function only
 *      decides what that result means for ONE booking row and whether it is
 *      safe to persist. It never calls mergeCustomerRows (that is a
 *      display/aggregation helper for duplicate customer rows, not an
 *      identity authority — see server/member-identity.js) and never guesses
 *      an identity from name/visit/spend/branch/barber similarity. Used by
 *      both booking creation and the historical backfill dry-run planner.
 *   2. linkNewlyCreatedBooking — the one orchestration helper that DOES touch
 *      the database (resolve -> plan -> conditional write -> telemetry), so
 *      both booking-creation call sites (server/index.js POST /api/bookings,
 *      server/routes/adminCrm.js POST /booking/walkin) share one
 *      implementation instead of duplicating it. Never called by the
 *      historical backfill planner, which stays read-only/dry-run by design.
 */

const { resolveCustomerIdentity } = require('./customerIdentityResolver');
const { logBookingLinkageEvent } = require('../orchestrator/telemetry');

const STATUS = Object.freeze({
  ALREADY_LINKED: 'already_linked',
  SAFE_LINK: 'safe_link',
  AMBIGUOUS_IDENTITY: 'ambiguous_identity',
  NOT_FOUND: 'not_found',
  INVALID_IDENTITY: 'invalid_identity',
  LINK_CONFLICT: 'link_conflict',
  LOOKUP_FAILED: 'lookup_failed',
});

// Maps a plan status to a bounded, PII-free telemetry issue code (Step 8).
// null where the outcome needs no "issue" label (already linked / safely linked).
const ISSUE_CODE_BY_STATUS = Object.freeze({
  [STATUS.ALREADY_LINKED]: null,
  [STATUS.SAFE_LINK]: null,
  [STATUS.AMBIGUOUS_IDENTITY]: 'ambiguous_phone',
  [STATUS.NOT_FOUND]: 'no_matching_customer',
  [STATUS.INVALID_IDENTITY]: 'missing_identity',
  [STATUS.LINK_CONFLICT]: 'conflicting_stronger_identity',
  [STATUS.LOOKUP_FAILED]: 'resolver_error',
});

function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function plan({ status, booking, proposedCustomerId = null, matchBasis = null, confidence = null, reason }) {
  return Object.freeze({
    status,
    booking_id: booking?.id ?? null,
    current_customer_id: isNonEmptyId(booking?.customer_id) ? booking.customer_id : null,
    proposed_customer_id: isNonEmptyId(proposedCustomerId) ? proposedCustomerId : null,
    match_basis: matchBasis || null,
    confidence: confidence || null,
    safe_to_link: status === STATUS.SAFE_LINK,
    reason,
  });
}

/**
 * @param {object} params
 * @param {object} params.booking - { id, customer_id } — the booking row's
 *   identity-relevant fields only. `customer_id` may be null/undefined/''.
 * @param {object|null} [params.resolverResult] - the exact return value of
 *   customerIdentityResolver.js#resolveCustomerIdentity for THIS booking's
 *   own identity evidence (e.g. its `wa` phone), or null/undefined if no
 *   resolver call could even be attempted (no usable identity field at all).
 * @param {object|null} [params.strongerIdentity] - an INDEPENDENTLY verified
 *   resolver result (same shape as resolverResult) that a caller wants
 *   cross-checked against an EXISTING booking.customer_id — e.g. a direct
 *   moka_customer_id match discovered separately from the booking's own
 *   phone. Only meaningful when booking.customer_id is already set. Omit
 *   when there is nothing stronger to check against.
 * @returns {{status, booking_id, current_customer_id, proposed_customer_id, match_basis, confidence, safe_to_link, reason}}
 */
function planBookingCustomerLinkage({ booking, resolverResult = null, strongerIdentity = null } = {}) {
  if (!booking || !isNonEmptyId(booking.id)) {
    // Not a real classification of any booking — fail closed the same way a
    // lookup failure would, so a caller can never accidentally treat this as
    // "safe to link".
    return plan({
      status: STATUS.LOOKUP_FAILED, booking: booking || {}, reason: 'missing_booking_reference',
    });
  }

  const hasExistingLink = isNonEmptyId(booking.customer_id);

  if (hasExistingLink) {
    // link_conflict: only when a SEPARATELY, INDEPENDENTLY verified stronger
    // identity resolved to a DIFFERENT customer than the one already on the
    // booking. A booking's own resolverResult disagreeing with itself is not
    // possible (same input); only `strongerIdentity` can trigger this.
    if (strongerIdentity && strongerIdentity.status === 'resolved'
      && isNonEmptyId(strongerIdentity.customer_id)
      && strongerIdentity.customer_id !== booking.customer_id) {
      return plan({
        status: STATUS.LINK_CONFLICT, booking, proposedCustomerId: null,
        matchBasis: strongerIdentity.match_basis, confidence: strongerIdentity.confidence,
        reason: 'existing_customer_id_disagrees_with_independently_verified_identity',
      });
    }
    // Existing link stands — never rewritten automatically, and not
    // contradicted by anything stronger we were given.
    return plan({
      status: STATUS.ALREADY_LINKED, booking, proposedCustomerId: booking.customer_id,
      reason: 'booking_already_has_a_customer_id',
    });
  }

  // No existing link. Nothing to classify without a resolver attempt at all
  // (e.g. the booking's phone field was empty/unusable before a resolver
  // call could even be made).
  if (!resolverResult) {
    return plan({
      status: STATUS.INVALID_IDENTITY, booking, reason: 'no_identity_evidence_available',
    });
  }

  switch (resolverResult.status) {
    case 'resolved': {
      if (!isNonEmptyId(resolverResult.customer_id)) {
        // Defensive: a "resolved" status must always carry a customer_id.
        // Treat a malformed resolver result as a failure, never a guess.
        return plan({
          status: STATUS.LOOKUP_FAILED, booking, reason: 'resolver_reported_resolved_without_customer_id',
        });
      }
      // Two independently-resolved sources disagreeing on a booking that has
      // no existing customer_id yet is conflicting evidence, not a safe pick
      // between them — do not guess which one is right.
      if (strongerIdentity && strongerIdentity.status === 'resolved'
        && isNonEmptyId(strongerIdentity.customer_id)
        && strongerIdentity.customer_id !== resolverResult.customer_id) {
        return plan({
          status: STATUS.AMBIGUOUS_IDENTITY, booking,
          matchBasis: resolverResult.match_basis, confidence: resolverResult.confidence,
          reason: 'resolver_and_independently_verified_identity_disagree',
        });
      }
      return plan({
        status: STATUS.SAFE_LINK, booking, proposedCustomerId: resolverResult.customer_id,
        matchBasis: resolverResult.match_basis, confidence: resolverResult.confidence,
        reason: 'canonical_resolver_returned_exactly_one_verified_customer',
      });
    }
    case 'ambiguous':
      return plan({
        status: STATUS.AMBIGUOUS_IDENTITY, booking,
        matchBasis: resolverResult.match_basis, confidence: resolverResult.confidence,
        reason: 'identity_matches_more_than_one_customer',
      });
    case 'not_found':
      return plan({
        status: STATUS.NOT_FOUND, booking,
        matchBasis: resolverResult.match_basis, confidence: resolverResult.confidence,
        reason: 'usable_identity_matched_no_customer',
      });
    case 'invalid':
      return plan({
        status: STATUS.INVALID_IDENTITY, booking, reason: 'identity_input_missing_or_malformed',
      });
    case 'lookup_failed':
      return plan({
        status: STATUS.LOOKUP_FAILED, booking, reason: 'resolver_lookup_error',
      });
    default:
      // Unknown/unrecognized resolver status — fail closed rather than
      // silently treating it as safe.
      return plan({
        status: STATUS.LOOKUP_FAILED, booking, reason: 'unrecognized_resolver_status',
      });
  }
}

function issueCodeForStatus(status) {
  return Object.hasOwn(ISSUE_CODE_BY_STATUS, status) ? ISSUE_CODE_BY_STATUS[status] : null;
}

// Correction Round 1, Blocker 3: the PURE plan's `status`/`safe_to_link`
// describe the classification BEFORE any write is attempted — they must stay
// exactly as planBookingCustomerLinkage computed them (semantic distinction
// the correction explicitly requires). This separate, bounded outcome
// describes what actually happened to the conditional UPDATE itself, so a
// caller/telemetry consumer can never mistake "classified as safe_link" for
// "actually persisted."
const PERSISTENCE_STATUS = Object.freeze({
  NOT_ATTEMPTED: 'not_attempted', // status was not safe_link, so no write was ever tried
  PERSISTED: 'persisted', // exactly one row updated, and it carries the proposed customer_id
  WRITE_FAILED: 'write_failed', // Supabase returned an error, or an impossible/unexpected result shape
  CONDITIONAL_WRITE_SKIPPED: 'conditional_write_skipped', // zero rows matched WHERE customer_id IS NULL — someone else linked/unlinked it first
});

/**
 * Orchestration helper for the ONLY case that needs a DB write: a booking
 * that was just created with no customer_id at all (Step 5). NOT part of the
 * pure planner above — this is the single shared place both booking-creation
 * call sites (server/index.js POST /api/bookings, server/routes/adminCrm.js
 * POST /booking/walkin) delegate to, so the resolve -> plan -> conditional
 * write -> telemetry sequence is implemented exactly once.
 *
 * Never throws — any resolver or DB error is caught and reported back as a
 * lookup_failed-shaped plan so the caller's booking response is never put at
 * risk by a CRM-linkage failure (spec: "NEVER break reservation because CRM
 * linkage failed"). Callers are expected to `await` this (Correction Round 1,
 * Blocker 2 — fire-and-forget is not durable enough in a serverless runtime
 * that can kill orphaned promises once the HTTP response ends), but that
 * await can never fail the reservation: every failure mode this function can
 * encounter is absorbed internally and returned as data, never a rejection.
 *
 * @param {object} supabase
 * @param {object} params
 * @param {{id: string}} params.booking - the just-inserted booking (customer_id
 *   is assumed NOT yet set — this helper does not re-check an existing link;
 *   callers only use it at creation time).
 * @param {string} params.phone - the booking's own identity phone (`wa`).
 * @param {'booking_create'|'booking_walkin'} params.source
 * @param {string|null} [params.branch]
 * @param {object} [deps] - test-only override point (production callers omit
 *   this — real resolveCustomerIdentity/logBookingLinkageEvent are used).
 * @returns {Promise<ReturnType<typeof planBookingCustomerLinkage> & {persistence_status: string}>}
 */
async function linkNewlyCreatedBooking(supabase, { booking, phone, source, branch = null } = {}, deps = {}) {
  const { resolveIdentity = resolveCustomerIdentity, logEvent = logBookingLinkageEvent } = deps;
  let resolverResult = null;
  let bookingPlan;
  let persistenceStatus = PERSISTENCE_STATUS.NOT_ATTEMPTED;
  try {
    resolverResult = await resolveIdentity(supabase, { phone }, { source });
    bookingPlan = planBookingCustomerLinkage({ booking: { id: booking?.id, customer_id: null }, resolverResult });

    if (bookingPlan.safe_to_link) {
      // Conditional on customer_id IS NULL: defends against a concurrent
      // writer having linked this exact booking in the moment between our
      // plan and this write (belt-and-suspenders — this helper only ever
      // runs once, immediately after insert, but the WHERE clause is the
      // actual safety guarantee, not the caller's timing assumption).
      // Correction Round 1, Blocker 3: Supabase reports write failures via
      // `{ data, error }`, not by throwing — the result MUST be inspected,
      // never assumed, before a link is ever reported/logged as persisted.
      const { data: updatedRows, error: updateError } = await supabase.from('bookings')
        .update({ customer_id: bookingPlan.proposed_customer_id })
        .eq('id', booking.id)
        .is('customer_id', null)
        .select('id, customer_id');

      if (updateError) {
        persistenceStatus = PERSISTENCE_STATUS.WRITE_FAILED;
      } else if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
        // Someone else already linked (or the row otherwise no longer
        // matched customer_id IS NULL) between our plan and this write —
        // never claim success, and never overwrite whatever is there now.
        persistenceStatus = PERSISTENCE_STATUS.CONDITIONAL_WRITE_SKIPPED;
      } else if (updatedRows.length === 1 && updatedRows[0].customer_id === bookingPlan.proposed_customer_id) {
        persistenceStatus = PERSISTENCE_STATUS.PERSISTED;
      } else {
        // >1 rows (impossible — id is a PK) or a returned row whose
        // customer_id doesn't match what we asked for: an invariant we do
        // not understand just broke. Fail closed, never trust it.
        persistenceStatus = PERSISTENCE_STATUS.WRITE_FAILED;
      }
    }
  } catch (_error) {
    bookingPlan = {
      status: STATUS.LOOKUP_FAILED,
      booking_id: booking?.id ?? null,
      current_customer_id: null,
      proposed_customer_id: null,
      match_basis: null,
      confidence: null,
      safe_to_link: false,
      reason: 'linkage_helper_threw',
    };
    persistenceStatus = PERSISTENCE_STATUS.NOT_ATTEMPTED;
  }

  try {
    logEvent({
      status: bookingPlan.status,
      match_basis: bookingPlan.match_basis,
      source,
      branch,
      candidate_count: resolverResult?.candidates_count ?? null,
      // Telemetry must not imply the link was persisted when it was not —
      // this reflects the ACTUAL write outcome, not just the pre-write plan.
      safe_to_link: persistenceStatus === PERSISTENCE_STATUS.PERSISTED,
      persistence_status: persistenceStatus,
      issue_code: issueCodeForStatus(bookingPlan.status),
    });
  } catch (_telemetryError) { /* observer-only, never blocks the caller */ }

  return { ...bookingPlan, persistence_status: persistenceStatus };
}

module.exports = {
  STATUS,
  PERSISTENCE_STATUS,
  planBookingCustomerLinkage,
  issueCodeForStatus,
  linkNewlyCreatedBooking,
};
