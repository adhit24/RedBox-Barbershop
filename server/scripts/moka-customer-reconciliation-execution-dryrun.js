'use strict';

/**
 * Task 17.3.2 — Moka Customer Reconciliation Execution Dry-Run Planner CLI Script.
 *
 * READ ONLY ONLY — ZERO DATABASE WRITES / MUTATIONS PERMITTED.
 *
 * Evaluates duplicate moka_customer_id groups, generates execution plans,
 * computes fingerprints, validates drift checks, and renders rollback snapshot previews.
 *
 * CLI Arguments:
 *   --moka-id=ID           Process single specific moka_customer_id
 *   --reconciliation-key=K Process single specific key
 *   --limit=N              Limit maximum duplicate groups processed
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { planMokaCustomerGroupReconciliation } = require('../services/mokaCustomerDuplicateReconciliation');
const {
  buildExecutionPlan,
  validateExecutionPlan,
  isExecutionKillSwitchEnabled,
} = require('../services/mokaCustomerReconciliationExecutor');

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
    mokaId: null,
    reconciliationKey: null,
    limit: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--moka-id=')) {
      options.mokaId = arg.split('=')[1].trim();
    } else if (arg.startsWith('--reconciliation-key=')) {
      options.reconciliationKey = arg.split('=')[1].trim();
    } else if (arg.startsWith('--limit=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (Number.isInteger(parsed) && parsed > 0) options.limit = parsed;
    }
  }
  return options;
}

async function runExecutionDryRunPlanner() {
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
  console.log('TASK 17.3.2 — RECONCILIATION EXECUTION DRY-RUN PLANNER');
  console.log('Target DB:', supabaseUrl);
  console.log('Kill Switch Enabled:', isExecutionKillSwitchEnabled());
  console.log('Mode: READ ONLY (ZERO DB WRITES)');
  console.log('==================================================\n');

  // Fetch duplicate customer rows
  let query = supabase.from('customers').select('id, name, wa, phone_e164, created_at, updated_at, moka_customer_id').not('moka_customer_id', 'is', null);

  if (cliOpts.mokaId) {
    query = query.eq('moka_customer_id', cliOpts.mokaId);
  }

  const { data: customerRows, error: custErr } = await query;
  if (custErr) {
    console.error('Error querying customers:', custErr.message);
    return { status: 'LOOKUP_FAILED' };
  }

  const mokaGroupsMap = new Map();
  for (const row of customerRows || []) {
    const mId = String(row.moka_customer_id).trim();
    if (!mId) continue;
    if (!mokaGroupsMap.has(mId)) mokaGroupsMap.set(mId, []);
    mokaGroupsMap.get(mId).push(row);
  }

  const duplicateMokaEntries = Array.from(mokaGroupsMap.entries()).filter(([_, rows]) => rows.length >= 2);

  if (cliOpts.limit) {
    duplicateMokaEntries.splice(cliOpts.limit);
  }

  const allCandidateIds = duplicateMokaEntries.flatMap(([_, rows]) => rows.map(r => r.id));

  // Bulk query evidence
  let txRows = [];
  let bookingRows = [];
  let scheduleRows = [];
  let memberEvidenceRows = [];

  if (allCandidateIds.length > 0) {
    const { data: txs } = await supabase.from('transactions').select('id, customer_id, status, total_amount').in('customer_id', allCandidateIds);
    txRows = txs || [];

    const { data: bks } = await supabase.from('bookings').select('id, customer_id, status').in('customer_id', allCandidateIds);
    bookingRows = bks || [];

    const { data: schs } = await supabase.from('schedules').select('id, customer_id, status, source').in('customer_id', allCandidateIds);
    scheduleRows = schs || [];

    const { data: mps } = await supabase.from('member_profiles').select('id, phone, membership_status, membership_activated_at');
    memberEvidenceRows = mps || [];
  }

  const summary = {
    total_duplicate_groups: duplicateMokaEntries.length,
    eligible_safe_auto_reconcile: 0,
    approval_required_deterministic: 0,
    rejected_manual_review: 0,
    would_retire_customer_rows: 0,
    planned_tx_moves: 0,
    planned_booking_moves: 0,
    planned_schedule_moves: 0,
    execution_plans: [],
  };

  for (const [mId, candidateRows] of duplicateMokaEntries) {
    const candidateIdSet = new Set(candidateRows.map(c => c.id));
    const grpTxs = txRows.filter(t => candidateIdSet.has(t.customer_id));
    const grpBks = bookingRows.filter(b => candidateIdSet.has(b.customer_id));
    const grpSchs = scheduleRows.filter(s => candidateIdSet.has(s.customer_id));

    const groupPlan = planMokaCustomerGroupReconciliation({
      mokaId: mId,
      candidateRows,
      transactionRows: grpTxs,
      bookingRows: grpBks,
      scheduleRows: grpSchs,
      memberEvidenceRows,
    });

    const evidenceSnapshot = {
      candidateRows,
      transactionRows: grpTxs,
      bookingRows: grpBks,
      scheduleRows: grpSchs,
      memberEvidenceRows,
    };

    const executionPlan = buildExecutionPlan(groupPlan, evidenceSnapshot);
    const validation = validateExecutionPlan(executionPlan, evidenceSnapshot, groupPlan);

    if (cliOpts.reconciliationKey && executionPlan.reconciliation_key !== cliOpts.reconciliationKey) {
      continue;
    }

    if (groupPlan.classification === 'SAFE_AUTO_RECONCILE') summary.eligible_safe_auto_reconcile++;
    else if (groupPlan.classification === 'DETERMINISTIC_RECONCILIATION') summary.approval_required_deterministic++;
    else summary.rejected_manual_review++;

    summary.would_retire_customer_rows += executionPlan.duplicate_customer_ids.length;
    summary.planned_tx_moves += executionPlan.planned_transaction_refs;
    summary.planned_booking_moves += executionPlan.planned_booking_refs;
    summary.planned_schedule_moves += executionPlan.planned_schedule_refs;

    summary.execution_plans.push({
      reconciliation_key: executionPlan.reconciliation_key,
      classification: executionPlan.classification,
      canonical_customer_id: executionPlan.canonical_customer_id,
      would_retire_count: executionPlan.duplicate_customer_ids.length,
      planned_tx_moves: executionPlan.planned_transaction_refs,
      planned_booking_moves: executionPlan.planned_booking_refs,
      planned_schedule_moves: executionPlan.planned_schedule_refs,
      validation_reason: validation.reason_code,
      fingerprint: executionPlan.plan_fingerprint,
      rollback_snapshot_preview: executionPlan.rollback_snapshot,
    });
  }

  console.log('--- EXECUTION DRY-RUN SUMMARY ---');
  console.log(`Total duplicate Moka groups:           ${summary.total_duplicate_groups}`);
  console.log(`Eligible SAFE_AUTO_RECONCILE groups:   ${summary.eligible_safe_auto_reconcile}`);
  console.log(`Approval-Required DETERMINISTIC:       ${summary.approval_required_deterministic}`);
  console.log(`Rejected MANUAL_REVIEW groups:         ${summary.rejected_manual_review}\n`);

  console.log('--- PLANNED REFERENCE MOVEMENTS ---');
  console.log(`  Planned transaction moves:  ${summary.planned_tx_moves}`);
  console.log(`  Planned booking moves:      ${summary.planned_booking_moves}`);
  console.log(`  Planned schedule moves:     ${summary.planned_schedule_moves}`);
  console.log(`  Customer rows to retire:    ${summary.would_retire_customer_rows}\n`);

  console.log('==================================================');
  console.log('EXECUTION DRY-RUN PLANNER COMPLETE — ZERO WRITES');
  console.log('==================================================');

  return { status: 'SUCCESS', summary };
}

if (require.main === module) {
  runExecutionDryRunPlanner().catch(err => {
    console.error('Execution dry-run planner fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runExecutionDryRunPlanner };
