'use strict';

/**
 * Task 17.3.1 — Moka Customer ID Duplicate Reconciliation Dry-Run Planner CLI Script.
 *
 * READ ONLY ONLY — ZERO DATABASE WRITES / MUTATIONS PERMITTED.
 *
 * Evaluates duplicate moka_customer_id customer rows against canonical reconciliation rules
 * and outputs structured classification metrics and reference counts.
 *
 * CLI Arguments:
 *   --limit=N           Limit maximum duplicate groups processed
 *   --moka-id=ID        Process single specific moka_customer_id
 *   --classification=X  Filter output by classification (e.g. SAFE_AUTO_RECONCILE)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneNumber } = require('../identity/phoneNormalization');
const {
  CLASSIFICATION,
  planMokaCustomerGroupReconciliation,
} = require('../services/mokaCustomerDuplicateReconciliation');

function normalizePhoneSafe(raw) {
  if (typeof raw !== 'string') return null;
  const digits = normalizePhoneNumber(raw);
  return digits ? `+${digits}` : null;
}

function loadEnvFile() {
  const envPaths = ['.env.local', '.env.prod.local', '.env'];
  for (const envFile of envPaths) {
    const fullPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (val && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null,
    mokaId: null,
    classification: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (Number.isInteger(parsed) && parsed > 0) options.limit = parsed;
    } else if (arg.startsWith('--moka-id=')) {
      options.mokaId = arg.split('=')[1].trim();
    } else if (arg.startsWith('--classification=')) {
      options.classification = arg.split('=')[1].trim().toUpperCase();
    }
  }
  return options;
}

async function runDryRunPlanner() {
  loadEnvFile();
  const cliOpts = parseCliArgs();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('AUDIT_NOT_EXECUTED: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
    return { status: 'AUDIT_NOT_EXECUTED' };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('==================================================');
  console.log('TASK 17.3.1 — MOKA CUSTOMER DUPLICATE RECONCILIATION DRY-RUN PLANNER');
  console.log('Target DB:', supabaseUrl);
  console.log('Mode: READ ONLY (ZERO DB WRITES)');
  console.log('==================================================\n');

  // 1. Fetch all customer rows with non-null moka_customer_id
  let query = supabase.from('customers').select('id, name, wa, phone_e164, created_at, updated_at, moka_customer_id').not('moka_customer_id', 'is', null);

  if (cliOpts.mokaId) {
    query = query.eq('moka_customer_id', cliOpts.mokaId);
  }

  const { data: customerRows, error: custErr } = await query;
  if (custErr) {
    console.error('Error querying customers:', custErr.message);
    return { status: 'LOOKUP_FAILED' };
  }

  // Group customer rows by moka_customer_id
  const mokaGroupsMap = new Map();
  for (const row of customerRows || []) {
    const mId = String(row.moka_customer_id).trim();
    if (!mId) continue;
    if (!mokaGroupsMap.has(mId)) mokaGroupsMap.set(mId, []);
    mokaGroupsMap.get(mId).push(row);
  }

  // Filter only duplicate groups (>= 2 candidates)
  const duplicateMokaEntries = Array.from(mokaGroupsMap.entries()).filter(([_, rows]) => rows.length >= 2);

  if (cliOpts.limit) {
    duplicateMokaEntries.splice(cliOpts.limit);
  }

  const allCandidateIds = duplicateMokaEntries.flatMap(([_, rows]) => rows.map(r => r.id));

  // 2. Fetch related evidence records for all candidates in bulk with explicit error inspection
  const lookupStatus = {
    transactions: 'ok',
    bookings: 'ok',
    schedules: 'ok',
    membership: 'ok',
  };

  let txRows = [];
  let bookingRows = [];
  let scheduleRows = [];
  let memberEvidenceRows = [];

  if (allCandidateIds.length > 0) {
    const { data: txs, error: txErr } = await supabase.from('transactions').select('id, customer_id, status, total_amount').in('customer_id', allCandidateIds);
    if (txErr) lookupStatus.transactions = 'failed';
    else txRows = txs || [];

    const { data: bks, error: bkErr } = await supabase.from('bookings').select('id, customer_id, status').in('customer_id', allCandidateIds);
    if (bkErr) lookupStatus.bookings = 'failed';
    else bookingRows = bks || [];

    const { data: schs, error: schErr } = await supabase.from('schedules').select('id, customer_id, status, source').in('customer_id', allCandidateIds);
    if (schErr) lookupStatus.schedules = 'failed';
    else scheduleRows = schs || [];

    const { data: mps, error: mpErr } = await supabase.from('member_profiles').select('id, phone, membership_status, membership_activated_at');
    if (mpErr) lookupStatus.membership = 'failed';
    else memberEvidenceRows = mps || [];
  }

  // 3. Process each group
  const metrics = {
    duplicate_moka_values_global: duplicateMokaEntries.length,
    customer_rows_in_duplicate_moka_global: duplicateMokaEntries.reduce((sum, [_, rows]) => sum + rows.length, 0),

    groups_2_rows: 0,
    groups_3_rows: 0,
    groups_4plus_rows: 0,

    groups_same_normalized_phone: 0,
    groups_multiple_distinct_normalized_phone: 0,
    groups_no_valid_phone: 0,

    groups_single_transaction_owner: 0,
    groups_multiple_transaction_owner: 0,
    groups_no_transaction_owner: 0,

    groups_single_booking_owner: 0,
    groups_multiple_booking_owner: 0,
    groups_no_booking_owner: 0,

    groups_single_trusted_web_schedule_owner: 0,
    groups_multiple_trusted_web_schedule_owner: 0,
    groups_no_trusted_web_schedule_owner: 0,
    groups_moka_schedule_evidence: 0,

    groups_membership_unique: 0,
    groups_membership_multiple: 0,
    groups_membership_unresolved: 0,
    groups_membership_none: 0,

    safe_auto_reconcile: 0,
    deterministic_reconciliation: 0,
    manual_review: 0,
    invalid_data: 0,
    lookup_failed: 0,

    potential_transaction_refs_to_move: 0,
    potential_booking_refs_to_move: 0,
    potential_schedule_refs_to_move: 0,
    potential_membership_refs_to_move: 0,
    potential_customer_rows_to_retire: 0,
  };

  const plans = [];

  for (const [mId, candidateRows] of duplicateMokaEntries) {
    // Group size metrics
    if (candidateRows.length === 2) metrics.groups_2_rows++;
    else if (candidateRows.length === 3) metrics.groups_3_rows++;
    else if (candidateRows.length >= 4) metrics.groups_4plus_rows++;

    // Normalized phone distribution metrics
    const normPhones = new Set(candidateRows.map(c => normalizePhoneSafe(c.phone_e164 || c.wa || c.phone)).filter(Boolean));
    if (normPhones.size === 0) metrics.groups_no_valid_phone++;
    else if (normPhones.size === 1) metrics.groups_same_normalized_phone++;
    else metrics.groups_multiple_distinct_normalized_phone++;

    // Sub-queries for group
    const candidateIdSet = new Set(candidateRows.map(c => c.id));
    const grpTxs = txRows.filter(t => candidateIdSet.has(t.customer_id));
    const grpBks = bookingRows.filter(b => candidateIdSet.has(b.customer_id));
    const grpSchs = scheduleRows.filter(s => candidateIdSet.has(s.customer_id));

    // Tx distribution
    const txOwners = new Set(grpTxs.filter(t => (t.status === 'completed' || t.status === 'paid') && (t.total_amount > 0 || t.price > 0)).map(t => t.customer_id));
    if (txOwners.size === 0) metrics.groups_no_transaction_owner++;
    else if (txOwners.size === 1) metrics.groups_single_transaction_owner++;
    else metrics.groups_multiple_transaction_owner++;

    // Booking distribution
    const bkOwners = new Set(grpBks.map(b => b.customer_id));
    if (bkOwners.size === 0) metrics.groups_no_booking_owner++;
    else if (bkOwners.size === 1) metrics.groups_single_booking_owner++;
    else metrics.groups_multiple_booking_owner++;

    // Schedule evidence distribution (trusted web vs moka)
    const webSchOwners = new Set(grpSchs.filter(s => s.source === 'web').map(s => s.customer_id));
    if (webSchOwners.size === 0) metrics.groups_no_trusted_web_schedule_owner++;
    else if (webSchOwners.size === 1) metrics.groups_single_trusted_web_schedule_owner++;
    else metrics.groups_multiple_trusted_web_schedule_owner++;

    if (grpSchs.some(s => s.source === 'moka')) {
      metrics.groups_moka_schedule_evidence++;
    }

    // Run canonical classification
    const plan = planMokaCustomerGroupReconciliation({
      mokaId: mId,
      candidateRows,
      transactionRows: grpTxs,
      bookingRows: grpBks,
      scheduleRows: grpSchs,
      memberEvidenceRows,
      lookupStatus,
    });

    if (cliOpts.classification && plan.classification !== cliOpts.classification) {
      continue;
    }

    // Increment exactly ONE membership category per group based on plan.membership_status
    if (plan.membership_status === 'membership_unique_candidate') metrics.groups_membership_unique++;
    else if (plan.membership_status === 'membership_multiple_candidates') metrics.groups_membership_multiple++;
    else if (plan.membership_status === 'membership_unresolved') metrics.groups_membership_unresolved++;
    else metrics.groups_membership_none++;

    plans.push(plan);

    if (plan.classification === CLASSIFICATION.SAFE_AUTO_RECONCILE) metrics.safe_auto_reconcile++;
    else if (plan.classification === CLASSIFICATION.DETERMINISTIC_RECONCILIATION) metrics.deterministic_reconciliation++;
    else if (plan.classification === CLASSIFICATION.MANUAL_REVIEW) metrics.manual_review++;
    else if (plan.classification === CLASSIFICATION.INVALID_DATA) metrics.invalid_data++;
    else if (plan.classification === CLASSIFICATION.LOOKUP_FAILED) metrics.lookup_failed++;

    metrics.potential_transaction_refs_to_move += plan.transaction_refs_to_move;
    metrics.potential_booking_refs_to_move += plan.booking_refs_to_move;
    metrics.potential_schedule_refs_to_move += plan.schedule_refs_to_move;
    metrics.potential_membership_refs_to_move += plan.member_profile_refs_to_move;
    metrics.potential_customer_rows_to_retire += plan.duplicate_rows_to_retire.length;
  }

  console.log('--- RECONCILIATION CLASSIFICATION SUMMARY ---');
  console.log(`Global duplicate moka_customer_id values:           ${metrics.duplicate_moka_values_global}`);
  console.log(`Global customer rows involved in duplicates:        ${metrics.customer_rows_in_duplicate_moka_global}`);
  console.log(`Groups of 2 rows:                                    ${metrics.groups_2_rows}`);
  console.log(`Groups of 3 rows:                                    ${metrics.groups_3_rows}`);
  console.log(`Groups of 4+ rows:                                   ${metrics.groups_4plus_rows}\n`);

  console.log('--- NORMALIZED PHONE DISTRIBUTION ---');
  console.log(`  groups_same_normalized_phone:                ${metrics.groups_same_normalized_phone}`);
  console.log(`  groups_multiple_distinct_normalized_phone:  ${metrics.groups_multiple_distinct_normalized_phone}`);
  console.log(`  groups_no_valid_phone:                       ${metrics.groups_no_valid_phone}\n`);

  console.log('--- SCHEDULE EVIDENCE DISTRIBUTION ---');
  console.log(`  groups_single_trusted_web_schedule_owner:   ${metrics.groups_single_trusted_web_schedule_owner}`);
  console.log(`  groups_multiple_trusted_web_schedule_owner: ${metrics.groups_multiple_trusted_web_schedule_owner}`);
  console.log(`  groups_no_trusted_web_schedule_owner:       ${metrics.groups_no_trusted_web_schedule_owner}`);
  console.log(`  groups_moka_schedule_evidence:              ${metrics.groups_moka_schedule_evidence}\n`);

  console.log('--- MEMBERSHIP DISTRIBUTION ---');
  console.log(`  groups_membership_unique:       ${metrics.groups_membership_unique}`);
  console.log(`  groups_membership_multiple:     ${metrics.groups_membership_multiple}`);
  console.log(`  groups_membership_unresolved:   ${metrics.groups_membership_unresolved}`);
  console.log(`  groups_membership_none:         ${metrics.groups_membership_none}\n`);

  console.log('--- CLASSIFICATION COUNTS ---');
  console.log(`  SAFE_AUTO_RECONCILE:            ${metrics.safe_auto_reconcile}`);
  console.log(`  DETERMINISTIC_RECONCILIATION:   ${metrics.deterministic_reconciliation}`);
  console.log(`  MANUAL_REVIEW:                  ${metrics.manual_review}`);
  console.log(`  INVALID_DATA:                   ${metrics.invalid_data}`);
  console.log(`  LOOKUP_FAILED:                  ${metrics.lookup_failed}\n`);

  console.log('--- POTENTIAL REFS TO MOVE / RETIRE ---');
  console.log(`  Potential transaction refs to move:  ${metrics.potential_transaction_refs_to_move}`);
  console.log(`  Potential booking refs to move:      ${metrics.potential_booking_refs_to_move}`);
  console.log(`  Potential schedule refs to move:     ${metrics.potential_schedule_refs_to_move}`);
  console.log(`  Potential membership refs to move:   ${metrics.potential_membership_refs_to_move}`);
  console.log(`  Potential customer rows to retire:   ${metrics.potential_customer_rows_to_retire}\n`);

  console.log('==================================================');
  console.log('DRY-RUN PLANNER COMPLETE — ZERO WRITES PERFORMED');
  console.log('==================================================');

  return { status: 'SUCCESS', metrics, plans };
}

if (require.main === module) {
  runDryRunPlanner().catch(err => {
    console.error('Dry-run planner fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runDryRunPlanner };
