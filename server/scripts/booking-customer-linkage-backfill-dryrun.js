'use strict';

/**
 * Task 17.2 — Historical Booking -> Customer Linkage: DRY-RUN ONLY.
 *
 * Classifies every currently-unlinked (`customer_id IS NULL`) `bookings` row
 * using the exact same canonical resolver + pure planner that future booking
 * creation uses (server/services/customerIdentityResolver.js,
 * server/services/bookingCustomerLinkage.js) — no separate/duplicated
 * matching logic, so this report can never drift from what the live linkage
 * path actually does.
 *
 * THIS SCRIPT NEVER WRITES TO THE DATABASE. It only:
 *   - SELECTs from `bookings`, `customers`, `member_profiles` (via the
 *     resolver, which is itself a pure read)
 *   - prints an aggregate summary (counts only — no phone numbers, no
 *     customer names, no raw booking payloads)
 *   - optionally writes a LOCAL JSON file (never a DB write) listing only
 *     { booking_id, proposed_customer_id } pairs for status=safe_link rows,
 *     as the "future execution design" input for a SEPARATE, human-reviewed
 *     mutation script that does not exist yet and is out of scope here.
 *
 * Usage:
 *   node server/scripts/booking-customer-linkage-backfill-dryrun.js [--out <path>]
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment (or a
 * server/.env file dotenv can load) — read-only credentials are sufficient;
 * this script never calls .insert/.update/.upsert/.delete.
 */

const path = require('path');
const fs = require('fs');

const { createClient } = require('@supabase/supabase-js');
const { resolveCustomerIdentity } = require('../services/customerIdentityResolver');
const { planBookingCustomerLinkage, issueCodeForStatus, STATUS } = require('../services/bookingCustomerLinkage');

const PAGE_SIZE = 500;
const CONCURRENCY = 20; // bounded parallel READS only — no write ever happens here.

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
      if ((index + 1) % 100 === 0) {
        console.error(`[booking-customer-linkage-backfill-dryrun] classified ${index + 1}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchAllUnlinkedBookings(supabase) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, wa, location, status, created_at')
      .is('customer_id', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch unlinked bookings failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function classifyBooking(supabase, booking) {
  const phone = typeof booking.wa === 'string' ? booking.wa.trim() : '';
  let resolverResult = null;
  if (phone) {
    try {
      resolverResult = await resolveCustomerIdentity(supabase, { phone }, { source: 'historical_backfill_dry_run' });
    } catch (_error) {
      resolverResult = { status: 'lookup_failed', customer_id: null, match_basis: null, candidates_count: null, confidence: null };
    }
  }
  return planBookingCustomerLinkage({
    booking: { id: booking.id, customer_id: null },
    resolverResult,
  });
}

async function run({ outPath } = {}) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not configured — refusing to run (no fallback, no guessing).');
  }
  const supabase = createClient(url, key);

  const bookings = await fetchAllUnlinkedBookings(supabase);

  const counts = {
    total_unlinked: bookings.length,
    [STATUS.SAFE_LINK]: 0,
    [STATUS.AMBIGUOUS_IDENTITY]: 0,
    [STATUS.NOT_FOUND]: 0,
    [STATUS.INVALID_IDENTITY]: 0,
    [STATUS.LOOKUP_FAILED]: 0,
  };
  const byBranch = {};
  const byIssueCode = {};
  const safeLinkPairs = []; // { booking_id, proposed_customer_id } — UUIDs only, never PII

  // Bounded-concurrency READS only (classifyBooking -> resolveCustomerIdentity
  // never writes) — order-independent, so parallelizing is safe and does not
  // change the classification of any individual booking.
  const plans = await mapWithConcurrency(bookings, CONCURRENCY, (booking) => classifyBooking(supabase, booking));

  bookings.forEach((booking, i) => {
    const plan = plans[i];
    counts[plan.status] = (counts[plan.status] || 0) + 1;

    const branch = typeof booking.location === 'string' ? booking.location : 'unknown';
    byBranch[branch] = byBranch[branch] || { total: 0 };
    byBranch[branch].total += 1;
    byBranch[branch][plan.status] = (byBranch[branch][plan.status] || 0) + 1;

    const issueCode = issueCodeForStatus(plan.status);
    if (issueCode) byIssueCode[issueCode] = (byIssueCode[issueCode] || 0) + 1;

    if (plan.status === STATUS.SAFE_LINK) {
      safeLinkPairs.push({ booking_id: plan.booking_id, proposed_customer_id: plan.proposed_customer_id });
    }
  });

  const summary = { generated_at: new Date().toISOString(), counts, by_branch: byBranch, by_issue_code: byIssueCode };
  console.log(JSON.stringify(summary, null, 2));

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ summary, safe_link_pairs: safeLinkPairs }, null, 2));
    console.log(`\nWrote ${safeLinkPairs.length} safe_link (booking_id, proposed_customer_id) pairs to ${outPath}`);
  }

  return summary;
}

/**
 * Documents, but does NOT execute, the future conditional-mutation design
 * for a safe_link pair (Step 7 requirement). A separate script — not this
 * one — would need to implement this exactly, including all 7 numbered
 * safeguards, before any real UPDATE runs against production.
 */
const FUTURE_EXECUTION_DESIGN = `
For each { booking_id, proposed_customer_id } pair this dry-run classified as safe_link:
  1. Re-read the booking row by id (fresh, not the cached dry-run snapshot).
  2. Re-read its current identity evidence (wa).
  3. Run resolveCustomerIdentity again with that fresh evidence.
  4. Ensure status is STILL 'resolved' and the customer_id STILL matches the
     dry-run's proposed_customer_id (both the booking and the customer graph
     may have changed since the dry-run ran).
  5. Execute exactly this conditional statement (never a bulk/blind UPDATE):
       UPDATE bookings
       SET customer_id = $freshly_resolved_customer_id
       WHERE id = $booking_id
         AND customer_id IS NULL
  6. Verify exactly ONE row was affected (rowCount === 1). Zero means someone
     else already linked or unlinked it since step 1 — do nothing further,
     do not retry blindly. More than one is impossible (id is a PK) but would
     be treated as a fatal invariant violation if it ever happened.
  7. Log the outcome (booking_id, status, whether the row was actually
     updated) via logBookingLinkageEvent — no phone/name in the log line.
This script intentionally stops at the dry-run report. No UPDATE statement is
ever issued here.
`;

module.exports = { run, FUTURE_EXECUTION_DESIGN };

if (require.main === module) {
  const outFlagIndex = process.argv.indexOf('--out');
  const outPath = outFlagIndex !== -1 ? process.argv[outFlagIndex + 1] : null;
  run({ outPath }).catch((error) => {
    console.error('[booking-customer-linkage-backfill-dryrun] failed:', error.message);
    process.exitCode = 1;
  });
}
