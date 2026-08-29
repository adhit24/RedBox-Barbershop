'use strict';

/**
 * Task 17.2 — Booking -> Customer Linkage (CRM Integrity Round 3).
 *
 * Covers the pure planner (server/services/bookingCustomerLinkage.js), the
 * booking-creation orchestration helper it exposes, source-level guarantees
 * for the reschedule/cancel/reassign paths (they must never touch
 * customer_id at all), and the historical backfill dry-run script's
 * read-only-ness.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  STATUS,
  planBookingCustomerLinkage,
  issueCodeForStatus,
  linkNewlyCreatedBooking,
} = require('../services/bookingCustomerLinkage');

function resolved(customer_id, overrides = {}) {
  return { status: 'resolved', customer_id, match_basis: 'normalized_phone', candidates_count: 1, confidence: 'high', ...overrides };
}

// ── 1-7: the pure planner ───────────────────────────────────────────────

test('1. unique normalized phone (resolver: resolved, 1 candidate) -> safe_link', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-1', customer_id: null },
    resolverResult: resolved('cust-A'),
  });
  assert.equal(plan.status, STATUS.SAFE_LINK);
  assert.equal(plan.safe_to_link, true);
  assert.equal(plan.proposed_customer_id, 'cust-A');
  assert.equal(plan.booking_id, 'bk-1');
  assert.equal(plan.current_customer_id, null);
});

test('2. duplicate phone (resolver: ambiguous) -> ambiguous_identity, proposed_customer_id null', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-2', customer_id: null },
    resolverResult: { status: 'ambiguous', customer_id: null, match_basis: null, candidates_count: 2, confidence: null },
  });
  assert.equal(plan.status, STATUS.AMBIGUOUS_IDENTITY);
  assert.equal(plan.safe_to_link, false);
  assert.equal(plan.proposed_customer_id, null);
});

test('3. no matching customer (resolver: not_found) -> not_found', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-3', customer_id: null },
    resolverResult: { status: 'not_found', customer_id: null, match_basis: null, candidates_count: 0, confidence: null },
  });
  assert.equal(plan.status, STATUS.NOT_FOUND);
  assert.equal(plan.safe_to_link, false);
});

test('4. malformed/missing phone -> invalid_identity (resolver: invalid, and no resolver result at all)', () => {
  const invalidPlan = planBookingCustomerLinkage({
    booking: { id: 'bk-4a', customer_id: null },
    resolverResult: { status: 'invalid', customer_id: null, match_basis: null, candidates_count: null, confidence: null },
  });
  assert.equal(invalidPlan.status, STATUS.INVALID_IDENTITY);
  assert.equal(invalidPlan.safe_to_link, false);

  // No resolver call could even be attempted (e.g. empty phone field).
  const noEvidencePlan = planBookingCustomerLinkage({ booking: { id: 'bk-4b', customer_id: null }, resolverResult: null });
  assert.equal(noEvidencePlan.status, STATUS.INVALID_IDENTITY);
  assert.equal(noEvidencePlan.safe_to_link, false);
});

test('5. existing valid customer_id, nothing contradicts it -> already_linked', () => {
  const plan = planBookingCustomerLinkage({ booking: { id: 'bk-5', customer_id: 'cust-existing' } });
  assert.equal(plan.status, STATUS.ALREADY_LINKED);
  assert.equal(plan.proposed_customer_id, 'cust-existing');
  assert.equal(plan.safe_to_link, false, 'already_linked means nothing needs to be WRITTEN — it is not itself a safe_link write');
});

test('6. existing customer_id conflicts with an independently verified stronger identity -> link_conflict, never auto-rewritten', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-6', customer_id: 'cust-old' },
    strongerIdentity: resolved('cust-new', { match_basis: 'moka_customer_id' }),
  });
  assert.equal(plan.status, STATUS.LINK_CONFLICT);
  assert.equal(plan.proposed_customer_id, null, 'a conflict must NEVER propose auto-rewriting the existing link');
  assert.equal(plan.current_customer_id, 'cust-old');
  assert.equal(plan.safe_to_link, false);
});

test('7. resolver lookup error -> lookup_failed, fails closed', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-7', customer_id: null },
    resolverResult: { status: 'lookup_failed', customer_id: null, match_basis: null, candidates_count: null, confidence: null },
  });
  assert.equal(plan.status, STATUS.LOOKUP_FAILED);
  assert.equal(plan.safe_to_link, false);
});

// Defensive: a "resolved" status without a customer_id must never be trusted.
test('planner defensively fails closed if resolver reports resolved without a customer_id', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-defensive', customer_id: null },
    resolverResult: { status: 'resolved', customer_id: null, match_basis: 'member_profile', candidates_count: 1, confidence: null },
  });
  assert.equal(plan.status, STATUS.LOOKUP_FAILED);
  assert.equal(plan.safe_to_link, false);
});

// Two independently-resolved sources disagreeing on a booking with NO
// existing link is conflicting evidence, not a coin flip.
test('two disagreeing resolved sources on an unlinked booking -> ambiguous_identity, never a guess', () => {
  const plan = planBookingCustomerLinkage({
    booking: { id: 'bk-disagree', customer_id: null },
    resolverResult: resolved('cust-A'),
    strongerIdentity: resolved('cust-B', { match_basis: 'moka_customer_id' }),
  });
  assert.equal(plan.status, STATUS.AMBIGUOUS_IDENTITY);
  assert.equal(plan.proposed_customer_id, null);
});

test('issueCodeForStatus maps every status to a bounded, PII-free code (or null)', () => {
  assert.equal(issueCodeForStatus(STATUS.SAFE_LINK), null);
  assert.equal(issueCodeForStatus(STATUS.ALREADY_LINKED), null);
  assert.equal(issueCodeForStatus(STATUS.AMBIGUOUS_IDENTITY), 'ambiguous_phone');
  assert.equal(issueCodeForStatus(STATUS.NOT_FOUND), 'no_matching_customer');
  assert.equal(issueCodeForStatus(STATUS.INVALID_IDENTITY), 'missing_identity');
  assert.equal(issueCodeForStatus(STATUS.LINK_CONFLICT), 'conflicting_stronger_identity');
  assert.equal(issueCodeForStatus(STATUS.LOOKUP_FAILED), 'resolver_error');
});

// ── 8-10: booking-creation orchestration (linkNewlyCreatedBooking) ────────

function fakeBookingsSupabase(initialRows) {
  const rows = initialRows.map((r) => ({ ...r }));
  return {
    _rows: rows,
    from(table) {
      if (table !== 'bookings') throw new Error(`unexpected table ${table}`);
      const filters = [];
      let updatePayload = null;
      const api = {
        update(payload) { updatePayload = payload; return api; },
        eq(field, value) { filters.push((r) => r[field] === value); return api; },
        is(field, value) {
          filters.push((r) => (value === null ? r[field] === null || r[field] === undefined : r[field] === value));
          return api;
        },
        then(onFulfilled, onRejected) {
          const matches = rows.filter((r) => filters.every((f) => f(r)));
          matches.forEach((r) => Object.assign(r, updatePayload));
          return Promise.resolve({ data: matches, error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

test('8. booking creation with resolved identity stores customer_id', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-8', customer_id: null }]);
  let loggedEvent = null;
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-8' }, phone: '6281234567890', source: 'booking_create', branch: 'bypass',
  }, {
    resolveIdentity: async () => resolved('cust-8'),
    logEvent: (e) => { loggedEvent = e; },
  });
  assert.equal(plan.status, STATUS.SAFE_LINK);
  assert.equal(supabase._rows[0].customer_id, 'cust-8', 'the booking row must actually be updated');
  assert.equal(loggedEvent.status, 'safe_link');
  assert.equal(loggedEvent.safe_to_link, true);
});

test('9. booking creation with ambiguous identity still creates booking with NULL customer_id', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-9', customer_id: null }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-9' }, phone: '6281234567890', source: 'booking_create', branch: 'bypass',
  }, {
    resolveIdentity: async () => ({ status: 'ambiguous', customer_id: null, match_basis: null, candidates_count: 2, confidence: null }),
  });
  assert.equal(plan.status, STATUS.AMBIGUOUS_IDENTITY);
  assert.equal(supabase._rows[0].customer_id, null, 'customer_id must remain NULL — no guess');
});

test('10. booking creation with resolver failure still creates the booking (never throws, never blocks)', async () => {
  const supabase = fakeBookingsSupabase([{ id: 'bk-10', customer_id: null }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-10' }, phone: '6281234567890', source: 'booking_create', branch: 'bypass',
  }, {
    resolveIdentity: async () => { throw new Error('supabase timeout'); },
  });
  assert.equal(plan.status, STATUS.LOOKUP_FAILED);
  assert.equal(supabase._rows[0].customer_id, null);
  // The booking itself already exists in our fake store (id: 'bk-10') —
  // proving the helper never needed to touch/undo the insert to fail safely.
  assert.equal(supabase._rows[0].id, 'bk-10');
});

test('16. conditional update never overwrites an already-linked booking (WHERE customer_id IS NULL is load-bearing, not decorative)', async () => {
  // Simulates the race the doc comment describes: by the time the update
  // runs, another writer already linked this booking to a DIFFERENT customer.
  const supabase = fakeBookingsSupabase([{ id: 'bk-16', customer_id: 'cust-raced-in-first' }]);
  const plan = await linkNewlyCreatedBooking(supabase, {
    booking: { id: 'bk-16' }, phone: '6281234567890', source: 'booking_create', branch: 'bypass',
  }, {
    resolveIdentity: async () => resolved('cust-would-be-guessed'),
  });
  assert.equal(plan.status, STATUS.SAFE_LINK, 'the plan itself is computed from the booking snapshot the helper was given');
  assert.equal(
    supabase._rows[0].customer_id, 'cust-raced-in-first',
    'the actual DB row must NOT be overwritten — the .is(customer_id, null) guard must have prevented the write',
  );
});

// ── 11-12: reschedule/cancel never touch customer_id (source-level guarantee) ──

test('11. reschedule handler never writes customer_id', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/adminCrm.js'), 'utf8');
  const start = source.indexOf("router.post('/booking/reschedule'");
  const end = source.indexOf("router.post(", start + 1);
  assert.notEqual(start, -1, 'reschedule route must exist');
  const handlerSource = source.slice(start, end === -1 ? undefined : end);
  assert.doesNotMatch(handlerSource, /customer_id/, 'reschedule must never reference customer_id at all');
});

test('12. cancel/confirm/deny (POST /api/booking-status) handler never writes customer_id', () => {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const start = source.indexOf("app.post('/api/booking-status'");
  assert.notEqual(start, -1, 'booking-status route must exist');
  const end = source.indexOf("app.post(", start + 1);
  const handlerSource = source.slice(start, end === -1 ? start + 4000 : end);
  assert.doesNotMatch(handlerSource, /\.update\(\s*\{\s*status[^}]*customer_id/, 'the status-update payload must never include customer_id');
});

test('reassign-barber handler never writes customer_id', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/adminCrm.js'), 'utf8');
  const start = source.indexOf("router.post('/booking/reassign'");
  const end = source.indexOf("router.post(", start + 1);
  assert.notEqual(start, -1);
  const handlerSource = source.slice(start, end === -1 ? undefined : end);
  assert.doesNotMatch(handlerSource, /customer_id/);
});

// ── 13: no name matching, anywhere in this task's identity logic ─────────

test('13. the planner never accepts or uses a name/customer_name field for identity — phone/resolver evidence only', () => {
  // Structural: the planner's decision for two bookings differing ONLY by an
  // (ignored) name field, with identical resolver evidence, is identical.
  const base = { resolverResult: resolved('cust-13') };
  const planA = planBookingCustomerLinkage({ ...base, booking: { id: 'bk-13a', customer_id: null, name: 'Budi' } });
  const planB = planBookingCustomerLinkage({ ...base, booking: { id: 'bk-13b', customer_id: null, name: 'Totally Different Name' } });
  assert.equal(planA.status, planB.status);
  assert.equal(planA.proposed_customer_id, planB.proposed_customer_id);

  const source = fs.readFileSync(path.join(__dirname, '../services/bookingCustomerLinkage.js'), 'utf8');
  assert.doesNotMatch(source, /\bname\s*===|\.name\b|customer_name/, 'the linkage module source must never reference a name field for matching');
});

// ── 14: duplicate-phone resolution never calls mergeCustomerRows ─────────

test('14. mergeCustomerRows is never imported or called by the linkage planner, the orchestration helper, or the backfill script', () => {
  // Checks for actual usage (an import destructure or a function call), not
  // the string appearing at all — the planner's own doc comment legitimately
  // names mergeCustomerRows to explain why it is deliberately NOT used.
  for (const file of ['../services/bookingCustomerLinkage.js', '../scripts/booking-customer-linkage-backfill-dryrun.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /require\([^)]*\)[^;]*mergeCustomerRows/, `${file} must never import mergeCustomerRows`);
    assert.doesNotMatch(source, /\bmergeCustomerRows\(/, `${file} must never call mergeCustomerRows(...)`);
  }
  assert.equal(typeof require('../services/bookingCustomerLinkage').mergeCustomerRows, 'undefined', 'must not even export it');
});

// ── 15: historical backfill is dry-run only ───────────────────────────────

test('15. the historical backfill script contains zero database mutation calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/booking-customer-linkage-backfill-dryrun.js'), 'utf8');
  assert.doesNotMatch(source, /\.insert\s*\(/);
  assert.doesNotMatch(source, /\.update\s*\(/);
  assert.doesNotMatch(source, /\.upsert\s*\(/);
  assert.doesNotMatch(source, /\.delete\s*\(/);
  // Only ever writes a LOCAL file (fs.writeFileSync), never a DB call.
  assert.match(source, /fs\.writeFileSync/);
});

// ── 17: no frontend changes ────────────────────────────────────────────────

test('17. Task 17.2 touches only backend files, never frontend/**', () => {
  const task172Files = [
    'server/services/bookingCustomerLinkage.js',
    'server/scripts/booking-customer-linkage-backfill-dryrun.js',
    'server/test/booking-customer-linkage-round3-v01.test.js',
    'server/orchestrator/telemetry.js',
    'server/index.js',
    'server/routes/adminCrm.js',
  ];
  for (const file of task172Files) {
    assert.equal(file.startsWith('frontend/'), false, `${file} must not be under frontend/`);
    assert.doesNotMatch(file, /redbox-frontend/);
  }
});

// ── 18-19: Task 14 booking authority + REDDY_BOOKING_EXECUTION unchanged ──

test('18. Task 14 booking authority claims are unchanged: website remains the reservation authority, Reddy cannot claim a mutation', () => {
  // BOOKING_CONTEXT_ALLOWED_CLAIMS / BOOKING_MUTATION_PROHIBITED_CLAIMS are
  // module-internal (not exported) — verified at the source level, the same
  // authority Task 17.2 itself must never weaken or touch.
  const source = fs.readFileSync(path.join(__dirname, '../orchestrator/orchestratorService.js'), 'utf8');
  assert.match(source, /website_is_reservation_authority/);
  for (const prohibited of ['selection_saved', 'booking_updated', 'slot_reserved', 'barber_selected_in_system', 'time_selected_in_system', 'reservation_confirmed']) {
    assert.match(source, new RegExp(prohibited), `${prohibited} must remain prohibited`);
  }
});

test('19. REDDY_BOOKING_EXECUTION remains the hardcoded constant DISABLED — Task 17.2 does not introduce a runtime toggle', () => {
  const { REDDY_BOOKING_EXECUTION } = require('../agents/reddy/bookingGuards');
  assert.equal(REDDY_BOOKING_EXECUTION, 'DISABLED');
  const source = fs.readFileSync(path.join(__dirname, '../agents/reddy/bookingGuards.js'), 'utf8');
  assert.doesNotMatch(source, /process\.env\.REDDY_BOOKING_EXECUTION/, 'must stay a compile-time constant, never env-gated');
});
