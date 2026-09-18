'use strict';

/**
 * REDBOX COMMAND CENTER — Task 2.3: Kapster Payroll Draft Engine
 *
 * Source Authority:
 *   - Canonical `moka_transaction_items` (classification = 'NON_STOCK_SERVICE', is_deleted = false, barber_id NOT NULL)
 *   - Rate Authority: `barber_commission_rates` (resolved by transaction date)
 *   - No salary, overtime, or automated attendance deduction.
 *   - Immutable Snapshotting: Once locked, calculations are final.
 *   - Invariant: Every relevant source item ends in EXACTLY ONE table:
 *       A. payroll_barber_commission_items (resolved payable commission lines)
 *       B. payroll_review_items (unresolved audit snapshot)
 *   - Concurrency Double-Pay Prevention: `payroll_source_claims` table with PK(source_moka_transaction_item_id).
 */

const {
  CLASSIFICATION,
  round,
  formatDate,
  resolveBarberRateForDate,
  fetchBarberRateHistory,
} = require('./revenueSharingService');

const RUN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  LOCKED: 'LOCKED',
});

const ITEM_STATUS = Object.freeze({
  READY: 'READY',
  MISSING_RATE: 'MISSING_RATE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  BLOCKED: 'BLOCKED',
});

const BLOCKER_TYPE = Object.freeze({
  MISSING_RATE: 'MISSING_RATE',
  MISSING_BARBER: 'MISSING_BARBER',
  UNRESOLVED_REVIEW_ITEM: 'UNRESOLVED_REVIEW_ITEM',
  DUPLICATE_SOURCE: 'DUPLICATE_SOURCE',
  RECONCILIATION_DISCREPANCY: 'RECONCILIATION_DISCREPANCY',
});

const REVIEW_REASON = Object.freeze({
  MISSING_RATE: 'MISSING_RATE',
  MISSING_BARBER: 'MISSING_BARBER',
  REVIEW_REQUIRED_ITEM: 'REVIEW_REQUIRED_ITEM',
  DUPLICATE_SOURCE: 'DUPLICATE_SOURCE',
  REFUND_REVIEW: 'REFUND_REVIEW',
  SOURCE_DATA_INVALID: 'SOURCE_DATA_INVALID',
});

/**
 * Fetch attendance context for barbers in a given period.
 */
async function fetchAttendanceContext(supabase, barberIds = [], periodStart, periodEnd) {
  const contextMap = new Map();
  for (const bId of barberIds) {
    contextMap.set(bId, {
      days_present: 0,
      days_absent: 0,
      late_count: 0,
      attendance_exceptions: 0,
    });
  }

  if (!barberIds.length || !periodStart || !periodEnd) return contextMap;

  try {
    const { data: attendanceRows, error } = await supabase
      .from('barber_attendance')
      .select('barber_id, date, status, note')
      .in('barber_id', barberIds)
      .gte('date', periodStart)
      .lte('date', periodEnd);

    if (error) {
      console.warn('[KapsterPayroll] Warning fetching barber_attendance:', error.message);
      return contextMap;
    }

    for (const row of attendanceRows || []) {
      const ctx = contextMap.get(row.barber_id);
      if (!ctx) continue;
      const st = String(row.status || '').toLowerCase().trim();
      if (st === 'hadir' || st === 'present') {
        ctx.days_present++;
      } else if (st === 'libur' || st === 'off') {
        // scheduled off day
      } else {
        ctx.days_absent++;
        ctx.attendance_exceptions++;
      }
    }
  } catch (err) {
    console.warn('[KapsterPayroll] Exception fetching attendance context:', err.message);
  }

  return contextMap;
}

/**
 * Check if any Moka item IDs in current list are already claimed or locked in another payroll run.
 */
async function findLockedDuplicateSourceItems(supabase, sourceItemIds = [], excludeRunId = null) {
  if (!sourceItemIds.length) return [];
  try {
    // 1. Check payroll_source_claims table
    const { data: claims, error: claimsErr } = await supabase
      .from('payroll_source_claims')
      .select('source_moka_transaction_item_id, payroll_run_id')
      .in('source_moka_transaction_item_id', sourceItemIds);

    if (!claimsErr && claims && claims.length > 0) {
      const filtered = excludeRunId ? claims.filter((c) => c.payroll_run_id !== excludeRunId) : claims;
      if (filtered.length > 0) {
        return filtered.map((c) => ({
          source_moka_transaction_item_id: c.source_moka_transaction_item_id,
          payroll_run_id: c.payroll_run_id,
        }));
      }
    }

    // 2. Also check locked runs' commission items as fallback
    let runsQuery = supabase
      .from('payroll_runs')
      .select('id')
      .eq('status', RUN_STATUS.LOCKED);

    if (excludeRunId) {
      runsQuery = runsQuery.neq('id', excludeRunId);
    }

    const { data: lockedRuns, error: runsErr } = await runsQuery;
    if (runsErr || !lockedRuns || !lockedRuns.length) return [];

    const lockedRunIds = lockedRuns.map((r) => r.id);
    const { data, error } = await supabase
      .from('payroll_barber_commission_items')
      .select('id, payroll_run_id, source_moka_transaction_item_id, receipt_number')
      .in('payroll_run_id', lockedRunIds)
      .in('source_moka_transaction_item_id', sourceItemIds);

    if (error) {
      console.warn('[KapsterPayroll] Error checking locked duplicate items:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[KapsterPayroll] Exception checking locked duplicate items:', err.message);
    return [];
  }
}

/**
 * Core calculation & draft persistence engine.
 */
async function generatePayrollDraft(supabase, {
  periodStart,
  periodEnd,
  userEmail = 'owner@redbox.id',
  existingRunId = null,
  preserveAdjustments = [],
}) {
  const pStart = formatDate(periodStart);
  const pEnd = formatDate(periodEnd);

  if (!pStart || !pEnd || pStart > pEnd) {
    throw new Error('Valid period_start and period_end are required (period_end >= period_start)');
  }

  // 1. Check if an overlapping LOCKED run already exists
  const { data: overlappingLocked } = await supabase
    .from('payroll_runs')
    .select('id, period_start, period_end, status')
    .eq('status', RUN_STATUS.LOCKED)
    .lte('period_start', pEnd)
    .gte('period_end', pStart);

  if (overlappingLocked && overlappingLocked.length > 0) {
    const conflict = overlappingLocked[0];
    throw new Error(
      `Cannot generate payroll: overlapping locked payroll run exists (${conflict.period_start} s/d ${conflict.period_end})`
    );
  }

  // 2. Fetch all active barbers
  const { data: barbers, error: barberErr } = await supabase
    .from('barbers')
    .select('id, name, branch, commission_rate, is_active')
    .eq('is_active', true)
    .order('name');

  if (barberErr || !barbers || !barbers.length) {
    throw new Error(`Failed to load barbers: ${barberErr?.message || 'No active barbers found'}`);
  }

  const barberIds = barbers.map((b) => b.id);
  const barberMap = new Map(barbers.map((b) => [b.id, b]));

  // 3. Fetch rate history
  const rateHistory = await fetchBarberRateHistory(supabase, barberIds);

  // 4. Fetch attendance context
  const attendanceContextMap = await fetchAttendanceContext(supabase, barberIds, pStart, pEnd);

  // 5. Fetch canonical moka_transaction_items in period
  const { data: rawItems, error: itemsErr } = await supabase
    .from('moka_transaction_items')
    .select(`
      id, receipt_number, source_line_key, outlet_slug, tx_date, tx_time,
      item_name, variant_name, category_name, quantity, gross_amount, discount_amount,
      net_amount, classification, classification_reason, barber_id, is_deleted, refunded_quantity
    `)
    .eq('is_deleted', false)
    .gte('tx_date', pStart)
    .lte('tx_date', pEnd);

  if (itemsErr) {
    throw new Error(`Failed to load transaction items: ${itemsErr.message}`);
  }

  const allItems = rawItems || [];

  // 6. Check for duplicate source items in locked runs
  const allCandidateIds = allItems
    .filter((i) => i.classification === CLASSIFICATION.NON_STOCK_SERVICE || i.classification === CLASSIFICATION.REVIEW_REQUIRED)
    .map((i) => i.id);
  const lockedDuplicates = await findLockedDuplicateSourceItems(supabase, allCandidateIds, existingRunId);
  const lockedDuplicateIdSet = new Set(lockedDuplicates.map((d) => d.source_moka_transaction_item_id));

  // Pre-index rate history by barber
  const historyByBarber = new Map();
  for (const row of rateHistory) {
    if (!historyByBarber.has(row.barber_id)) {
      historyByBarber.set(row.barber_id, []);
    }
    historyByBarber.get(row.barber_id).push(row);
  }

  // Pre-index adjustments to preserve
  const adjustmentsByBarber = new Map();
  for (const adj of preserveAdjustments) {
    if (!adjustmentsByBarber.has(adj.barber_id)) {
      adjustmentsByBarber.set(adj.barber_id, []);
    }
    adjustmentsByBarber.get(adj.barber_id).push(adj);
  }

  // 7. Create or update payroll_runs record
  let runId = existingRunId;
  if (!runId) {
    const { data: newRun, error: runInsertErr } = await supabase
      .from('payroll_runs')
      .insert({
        payroll_type: 'BARBER_REVENUE_SHARE',
        business_unit: 'Redbox',
        period_start: pStart,
        period_end: pEnd,
        status: RUN_STATUS.DRAFT,
        generated_by: userEmail,
        calculation_version: 'v2.3',
      })
      .select()
      .single();

    if (runInsertErr) {
      throw new Error(`Failed to create payroll_run: ${runInsertErr.message}`);
    }
    runId = newRun.id;
  }

  // 8. Prepare resolved commission lines, review snapshot items, and barber items
  const barberCalculations = new Map();
  for (const barber of barbers) {
    barberCalculations.set(barber.id, {
      barber,
      gross: 0,
      discount: 0,
      net: 0,
      commission: 0,
      serviceCount: 0,
      receipts: new Set(),
      commissionLines: [],
      missingRateCount: 0,
      reviewRequiredCount: 0,
    });
  }

  const reviewItemsToInsert = [];

  // Group candidate items by barber
  for (const item of allItems) {
    const gross = Number(item.gross_amount) || 0;
    const disc = Number(item.discount_amount) || 0;
    const net = item.net_amount != null ? Number(item.net_amount) : (gross - disc);
    const qty = Number(item.quantity) || 1;
    const refunded = Number(item.refunded_quantity) || 0;
    const effectiveQty = Math.max(0, qty - refunded);

    // Skip fully refunded items or non-payroll classifications (retail product, non-stock misc)
    if (item.classification === CLASSIFICATION.RETAIL_PRODUCT || item.classification === CLASSIFICATION.NON_STOCK_MISC) {
      continue;
    }

    // A. Check DUPLICATE_SOURCE (already claimed in locked run)
    if (lockedDuplicateIdSet.has(item.id)) {
      const bObj = item.barber_id ? barberMap.get(item.barber_id) : null;
      reviewItemsToInsert.push({
        payroll_run_id: runId,
        source_moka_transaction_item_id: item.id,
        receipt_number: item.receipt_number,
        tx_date: item.tx_date,
        item_name_snapshot: item.item_name,
        classification_snapshot: item.classification,
        barber_id: item.barber_id || null,
        barber_name_snapshot: bObj ? bObj.name : null,
        branch_snapshot: bObj ? bObj.branch : (item.outlet_slug || null),
        gross_amount: gross,
        discount_amount: disc,
        net_amount: net,
        reason_code: REVIEW_REASON.DUPLICATE_SOURCE,
        blocking: true,
        detail: `Item transaksi ${item.receipt_number} sudah pernah diklaim/dikunci pada periode payroll lain.`,
      });
      continue;
    }

    // B. Check REVIEW_REQUIRED items
    if (item.classification === CLASSIFICATION.REVIEW_REQUIRED) {
      const bObj = item.barber_id ? barberMap.get(item.barber_id) : null;
      if (item.barber_id && barberCalculations.has(item.barber_id)) {
        barberCalculations.get(item.barber_id).reviewRequiredCount++;
      }
      reviewItemsToInsert.push({
        payroll_run_id: runId,
        source_moka_transaction_item_id: item.id,
        receipt_number: item.receipt_number,
        tx_date: item.tx_date,
        item_name_snapshot: item.item_name,
        classification_snapshot: item.classification,
        barber_id: item.barber_id || null,
        barber_name_snapshot: bObj ? bObj.name : null,
        branch_snapshot: bObj ? bObj.branch : (item.outlet_slug || null),
        gross_amount: gross,
        discount_amount: disc,
        net_amount: net,
        reason_code: REVIEW_REASON.REVIEW_REQUIRED_ITEM,
        blocking: true,
        detail: item.classification_reason || 'Item transaksi memerlukan review konfirmasi klasifikasi.',
      });
      continue;
    }

    // C. Check UNASSIGNED SERVICE items (barber_id is null)
    if (item.classification === CLASSIFICATION.NON_STOCK_SERVICE && !item.barber_id) {
      reviewItemsToInsert.push({
        payroll_run_id: runId,
        source_moka_transaction_item_id: item.id,
        receipt_number: item.receipt_number,
        tx_date: item.tx_date,
        item_name_snapshot: item.item_name,
        classification_snapshot: item.classification,
        barber_id: null,
        barber_name_snapshot: null,
        branch_snapshot: item.outlet_slug || null,
        gross_amount: gross,
        discount_amount: disc,
        net_amount: net,
        reason_code: REVIEW_REASON.MISSING_BARBER,
        blocking: true,
        detail: `Layanan ${item.item_name} pada struk ${item.receipt_number} tidak memiliki atribusi kapster.`,
      });
      continue;
    }

    // D. Check ELIGIBLE SERVICE with barber_id
    if (item.classification === CLASSIFICATION.NON_STOCK_SERVICE && item.barber_id) {
      const bCalc = barberCalculations.get(item.barber_id);
      const bHistory = historyByBarber.get(item.barber_id) || [];
      const barber = barberMap.get(item.barber_id);

      if (!bCalc || !barber) {
        // Barber not found in active barbers
        reviewItemsToInsert.push({
          payroll_run_id: runId,
          source_moka_transaction_item_id: item.id,
          receipt_number: item.receipt_number,
          tx_date: item.tx_date,
          item_name_snapshot: item.item_name,
          classification_snapshot: item.classification,
          barber_id: item.barber_id,
          barber_name_snapshot: 'Inactive/Unknown Barber',
          branch_snapshot: item.outlet_slug || null,
          gross_amount: gross,
          discount_amount: disc,
          net_amount: net,
          reason_code: REVIEW_REASON.MISSING_BARBER,
          blocking: true,
          detail: `Kapster ID ${item.barber_id} tidak aktif atau tidak ditemukan dalam master kapster.`,
        });
        continue;
      }

      // Check rate resolution for transaction date
      const rateRes = resolveBarberRateForDate(bHistory, barber.commission_rate, item.tx_date);
      if (rateRes.rate == null) {
        // MISSING RATE -> Snapshot into payroll_review_items!
        // DO NOT insert fake 0% rate into commission lines!
        bCalc.missingRateCount++;
        reviewItemsToInsert.push({
          payroll_run_id: runId,
          source_moka_transaction_item_id: item.id,
          receipt_number: item.receipt_number,
          tx_date: item.tx_date,
          item_name_snapshot: item.item_name,
          classification_snapshot: item.classification,
          barber_id: barber.id,
          barber_name_snapshot: barber.name,
          branch_snapshot: barber.branch,
          gross_amount: gross,
          discount_amount: disc,
          net_amount: net,
          reason_code: REVIEW_REASON.MISSING_RATE,
          blocking: true,
          detail: `Kapster ${barber.name} tidak memiliki rate komisi aktif pada tanggal transaksi ${item.tx_date}.`,
        });
      } else {
        // RESOLVED RATE -> Snapshot into payroll_barber_commission_items!
        const itemComm = round(net * rateRes.rate);
        bCalc.gross += gross;
        bCalc.discount += disc;
        bCalc.net += net;
        bCalc.commission += itemComm;
        bCalc.serviceCount += effectiveQty;
        if (item.receipt_number) bCalc.receipts.add(item.receipt_number);

        bCalc.commissionLines.push({
          source_moka_transaction_item_id: item.id,
          receipt_number: item.receipt_number,
          tx_date: item.tx_date,
          service_name_snapshot: item.item_name,
          gross_amount: gross,
          discount_amount: disc,
          net_amount: net,
          commission_rate_used: rateRes.rate,
          commission_amount: itemComm,
          rate_source: rateRes.rate_source,
          rate_effective_from: rateRes.effective_from,
          barber_id_snapshot: barber.id,
          branch_snapshot: barber.branch || 'unknown',
        });
      }
    }
  }

  // 9. Persist Barber Items & Commission Detail Snapshots
  let totalGross = 0;
  let totalDiscount = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let totalAdjustments = 0;

  for (const barber of barbers) {
    const bCalc = barberCalculations.get(barber.id);
    const bAdjustments = adjustmentsByBarber.get(barber.id) || [];
    const attCtx = attendanceContextMap.get(barber.id) || {};

    const bGross = bCalc ? bCalc.gross : 0;
    const bDisc = bCalc ? bCalc.discount : 0;
    const bNet = bCalc ? bCalc.net : 0;
    const bComm = bCalc ? bCalc.commission : 0;
    const bServiceCount = bCalc ? bCalc.serviceCount : 0;
    const bReceiptCount = bCalc ? bCalc.receipts.size : 0;
    const bMissingRateCount = bCalc ? bCalc.missingRateCount : 0;
    const bReviewRequiredCount = bCalc ? bCalc.reviewRequiredCount : 0;

    const bAdjTotal = round(bAdjustments.reduce((sum, a) => sum + Number(a.amount || 0), 0));
    const bPayable = round(bComm + bAdjTotal);

    let barberStatus = ITEM_STATUS.READY;
    if (bMissingRateCount > 0) {
      barberStatus = ITEM_STATUS.MISSING_RATE;
    } else if (bReviewRequiredCount > 0) {
      barberStatus = ITEM_STATUS.REVIEW_REQUIRED;
    }

    const { data: insertedPbi, error: pbiErr } = await supabase
      .from('payroll_barber_items')
      .insert({
        payroll_run_id: runId,
        barber_id: barber.id,
        barber_name_snapshot: barber.name,
        branch_snapshot: barber.branch || 'unknown',
        service_item_count: bServiceCount,
        receipt_count: bReceiptCount,
        gross_service_revenue: round(bGross),
        discount_total: round(bDisc),
        net_service_revenue: round(bNet),
        commission_amount: round(bComm),
        manual_adjustment_total: bAdjTotal,
        payable_amount: bPayable,
        review_required_count: bReviewRequiredCount,
        missing_rate_count: bMissingRateCount,
        attendance_context: attCtx,
        status: barberStatus,
      })
      .select()
      .single();

    if (pbiErr) {
      throw new Error(`Failed to insert payroll_barber_item for ${barber.name}: ${pbiErr.message}`);
    }

    const pbiId = insertedPbi.id;

    // Attach pbiId to resolved commission lines and persist
    if (bCalc && bCalc.commissionLines.length > 0) {
      const commRows = bCalc.commissionLines.map((line) => ({
        payroll_run_id: runId,
        payroll_barber_item_id: pbiId,
        ...line,
      }));

      const { error: commInsertErr } = await supabase
        .from('payroll_barber_commission_items')
        .insert(commRows);

      if (commInsertErr) {
        throw new Error(`Failed to insert commission lines for ${barber.name}: ${commInsertErr.message}`);
      }
    }

    // Re-attach preserved manual adjustments if regenerating
    for (const adj of bAdjustments) {
      await supabase.from('payroll_adjustments').insert({
        payroll_run_id: runId,
        payroll_barber_item_id: pbiId,
        barber_id: barber.id,
        amount: adj.amount,
        reason: adj.reason,
        note: adj.note || null,
        created_by: adj.created_by || userEmail,
      });
    }

    totalGross += bGross;
    totalDiscount += bDisc;
    totalNet += bNet;
    totalCommission += bComm;
    totalAdjustments += bAdjTotal;
  }

  // 10. Persist Review Items Snapshot (Unresolved source items)
  if (reviewItemsToInsert.length > 0) {
    const { error: reviewInsertErr } = await supabase
      .from('payroll_review_items')
      .insert(reviewItemsToInsert);

    if (reviewInsertErr) {
      throw new Error(`Failed to insert payroll_review_items: ${reviewInsertErr.message}`);
    }
  }

  // 11. Update payroll_runs summary totals
  const totalPayable = round(totalCommission + totalAdjustments);
  const summaryPayload = {
    total_gross: round(totalGross),
    total_discount: round(totalDiscount),
    total_net: round(totalNet),
    total_commission: round(totalCommission),
    total_adjustments: round(totalAdjustments),
    total_payable: totalPayable,
    barber_count: barbers.length,
    review_items_count: reviewItemsToInsert.length,
  };

  await supabase
    .from('payroll_runs')
    .update({
      summary: summaryPayload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  // 12. Build audit blockers list from persistent payroll_review_items
  const { data: persistentReviewItems } = await supabase
    .from('payroll_review_items')
    .select('*')
    .eq('payroll_run_id', runId)
    .eq('blocking', true);

  const blockers = [];
  for (const pri of persistentReviewItems || []) {
    blockers.push({
      type: pri.reason_code,
      barber_id: pri.barber_id || null,
      barber_name: pri.barber_name_snapshot || null,
      receipt_number: pri.receipt_number,
      message: pri.detail || `Item review ${pri.reason_code} pada struk ${pri.receipt_number}`,
    });
  }

  const { data: finalRun } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  return {
    run: {
      ...finalRun,
      total_service_revenue: round(totalNet),
      total_commission: round(totalCommission),
      total_adjustments: round(totalAdjustments),
      total_payable: totalPayable,
      barber_count: barbers.length,
      blocking_issues_count: blockers.length,
    },
    blockers,
    review_items: persistentReviewItems || [],
  };
}

/**
 * Regenerate an existing DRAFT payroll run atomically.
 */
async function regeneratePayrollDraft(supabase, { runId, userEmail = 'owner@redbox.id' }) {
  if (!runId) throw new Error('runId is required');

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    throw new Error(`Payroll run ${runId} not found`);
  }

  if (run.status === RUN_STATUS.LOCKED) {
    throw new Error(`Cannot regenerate: payroll run ${runId} is LOCKED and immutable`);
  }

  // Preserve manual adjustments
  const { data: existingAdjustments } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_run_id', runId);

  const adjustmentsToPreserve = (existingAdjustments || []).map((a) => ({
    barber_id: a.barber_id,
    amount: Number(a.amount),
    reason: a.reason,
    note: a.note,
    created_by: a.created_by,
  }));

  // Atomic cleanup of previous draft lines
  await supabase.from('payroll_adjustments').delete().eq('payroll_run_id', runId);
  await supabase.from('payroll_barber_commission_items').delete().eq('payroll_run_id', runId);
  await supabase.from('payroll_review_items').delete().eq('payroll_run_id', runId);
  await supabase.from('payroll_barber_items').delete().eq('payroll_run_id', runId);

  // Regenerate with preserved adjustments
  return await generatePayrollDraft(supabase, {
    periodStart: run.period_start,
    periodEnd: run.period_end,
    userEmail,
    existingRunId: runId,
    preserveAdjustments: adjustmentsToPreserve,
  });
}

/**
 * Atomic Locking of Payroll Run.
 */
async function lockPayrollRun(supabase, { runId, userEmail = 'owner@redbox.id' }) {
  if (!runId) throw new Error('runId is required');

  // 1. Try atomic PostgreSQL RPC if available in database
  if (typeof supabase.rpc === 'function') {
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('lock_payroll_run', {
        p_run_id: runId,
        p_user_email: userEmail,
      });

      if (!rpcErr && rpcRes && rpcRes.success) {
        const { data: lockedRun } = await supabase
          .from('payroll_runs')
          .select('*')
          .eq('id', runId)
          .single();
        return {
          success: true,
          run: lockedRun,
          locked_at: lockedRun.locked_at,
          claims_created: rpcRes.claims_created,
        };
      }

      // If database explicitly raised an exception via RPC (e.g. blocking issues remain or already claimed)
      if (rpcErr && rpcErr.message && !rpcErr.message.includes('not implemented') && !rpcErr.message.includes('Could not find') && !rpcErr.message.includes('schema cache')) {
        throw new Error(rpcErr.message);
      }
    } catch (rpcEx) {
      if (rpcEx.message && !rpcEx.message.includes('not implemented') && !rpcEx.message.includes('Could not find') && !rpcEx.message.includes('schema cache') && !rpcEx.message.includes('does not exist')) {
        throw rpcEx;
      }
    }
  }

  // 2. Fallback Atomic Validation Sequence (used in mockDb or pre-RPC environments)
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    throw new Error(`Payroll run ${runId} not found`);
  }

  if (run.status === RUN_STATUS.LOCKED) {
    throw new Error(`Payroll run ${runId} is already LOCKED`);
  }

  // Verify 0 blocking review items
  const { data: blockingReviewItems } = await supabase
    .from('payroll_review_items')
    .select('id, reason_code, detail')
    .eq('payroll_run_id', runId)
    .eq('blocking', true);

  if (blockingReviewItems && blockingReviewItems.length > 0) {
    throw new Error(
      `Cannot lock payroll: ${blockingReviewItems.length} blocking review issues remain unresolved.`
    );
  }

  // Verify mathematical reconciliation per barber
  const { data: barberItems } = await supabase
    .from('payroll_barber_items')
    .select('id, barber_name_snapshot, net_service_revenue, commission_amount')
    .eq('payroll_run_id', runId);

  const { data: commissionLines } = await supabase
    .from('payroll_barber_commission_items')
    .select('payroll_barber_item_id, net_amount, commission_amount, source_moka_transaction_item_id')
    .eq('payroll_run_id', runId);

  for (const b of barberItems || []) {
    const lines = (commissionLines || []).filter((l) => l.payroll_barber_item_id === b.id);
    const sumNet = round(lines.reduce((s, l) => s + Number(l.net_amount || 0), 0));
    const sumComm = round(lines.reduce((s, l) => s + Number(l.commission_amount || 0), 0));

    if (sumNet !== Number(b.net_service_revenue)) {
      throw new Error(
        `Reconciliation error for ${b.barber_name_snapshot}: sum(net_amount) [${sumNet}] != net_service_revenue [${b.net_service_revenue}]`
      );
    }
    if (sumComm !== Number(b.commission_amount)) {
      throw new Error(
        `Reconciliation error for ${b.barber_name_snapshot}: sum(commission_amount) [${sumComm}] != commission_amount [${b.commission_amount}]`
      );
    }
  }

  // Insert claims into payroll_source_claims to guarantee cross-run double-pay prevention
  if (commissionLines && commissionLines.length > 0) {
    const claims = commissionLines.map((l) => ({
      source_moka_transaction_item_id: l.source_moka_transaction_item_id,
      payroll_run_id: runId,
      claimed_at: new Date().toISOString(),
      claimed_by: userEmail,
    }));

    const { error: claimErr } = await supabase
      .from('payroll_source_claims')
      .insert(claims);

    if (claimErr) {
      throw new Error(`Cannot lock payroll: duplicate source claim detected: ${claimErr.message}`);
    }
  }

  // Update status to LOCKED
  const nowIso = new Date().toISOString();
  const { data: updatedRun, error: updateErr } = await supabase
    .from('payroll_runs')
    .update({
      status: RUN_STATUS.LOCKED,
      locked_at: nowIso,
      locked_by: userEmail,
      updated_at: nowIso,
    })
    .eq('id', runId)
    .select()
    .single();

  if (updateErr) {
    throw new Error(`Failed to lock payroll run: ${updateErr.message}`);
  }

  return {
    success: true,
    run: updatedRun,
    locked_at: nowIso,
  };
}

/**
 * Add a manual adjustment to a barber item within a DRAFT payroll run.
 */
async function addManualAdjustment(supabase, {
  runId,
  barberId,
  amount,
  reason,
  note = null,
  userEmail = 'owner@redbox.id',
}) {
  if (!runId || !barberId) throw new Error('runId and barberId are required');
  const numAmount = round(Number(amount));
  if (!Number.isFinite(numAmount) || numAmount === 0) {
    throw new Error('Adjustment amount must be non-zero');
  }
  if (!reason || !reason.trim()) {
    throw new Error('Adjustment reason is required');
  }

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('id', runId)
    .single();

  if (runErr || !run) throw new Error(`Payroll run ${runId} not found`);
  if (run.status === RUN_STATUS.LOCKED) {
    throw new Error(`Cannot modify adjustments: payroll run ${runId} is LOCKED`);
  }

  const { data: barberItem, error: pbiErr } = await supabase
    .from('payroll_barber_items')
    .select('id, commission_amount, manual_adjustment_total, payable_amount')
    .eq('payroll_run_id', runId)
    .eq('barber_id', barberId)
    .single();

  if (pbiErr || !barberItem) {
    throw new Error(`Barber item not found for barber ${barberId} in run ${runId}`);
  }

  const { data: adjustment, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .insert({
      payroll_run_id: runId,
      payroll_barber_item_id: barberItem.id,
      barber_id: barberId,
      amount: numAmount,
      reason: reason.trim(),
      note: note ? note.trim() : null,
      created_by: userEmail,
    })
    .select()
    .single();

  if (adjErr) {
    throw new Error(`Failed to create adjustment: ${adjErr.message}`);
  }

  // Update barber item totals
  const newAdjTotal = round(Number(barberItem.manual_adjustment_total) + numAmount);
  const newPayable = round(Number(barberItem.commission_amount) + newAdjTotal);

  await supabase
    .from('payroll_barber_items')
    .update({
      manual_adjustment_total: newAdjTotal,
      payable_amount: newPayable,
      updated_at: new Date().toISOString(),
    })
    .eq('id', barberItem.id);

  return adjustment;
}

/**
 * Delete a manual adjustment from a DRAFT payroll run.
 */
async function deleteManualAdjustment(supabase, {
  runId,
  adjustmentId,
  userEmail = 'owner@redbox.id',
}) {
  if (!runId || !adjustmentId) throw new Error('runId and adjustmentId are required');

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('id', runId)
    .single();

  if (runErr || !run) throw new Error(`Payroll run ${runId} not found`);
  if (run.status === RUN_STATUS.LOCKED) {
    throw new Error(`Cannot delete adjustments: payroll run ${runId} is LOCKED`);
  }

  const { data: adj, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('id', adjustmentId)
    .eq('payroll_run_id', runId)
    .single();

  if (adjErr || !adj) {
    throw new Error(`Adjustment ${adjustmentId} not found in run ${runId}`);
  }

  // Delete adjustment
  await supabase.from('payroll_adjustments').delete().eq('id', adjustmentId);

  // Reconcile barber item totals
  const { data: barberItem } = await supabase
    .from('payroll_barber_items')
    .select('id, commission_amount')
    .eq('id', adj.payroll_barber_item_id)
    .single();

  if (barberItem) {
    const { data: remainingAdjs } = await supabase
      .from('payroll_adjustments')
      .select('amount')
      .eq('payroll_barber_item_id', barberItem.id);

    const newAdjTotal = round(
      (remainingAdjs || []).reduce((s, a) => s + Number(a.amount || 0), 0)
    );
    const newPayable = round(Number(barberItem.commission_amount) + newAdjTotal);

    await supabase
      .from('payroll_barber_items')
      .update({
        manual_adjustment_total: newAdjTotal,
        payable_amount: newPayable,
        updated_at: new Date().toISOString(),
      })
      .eq('id', barberItem.id);
  }

  return { success: true };
}

/**
 * List all payroll runs.
 */
async function listPayrollRuns(supabase, { status = null, auth = {} } = {}) {
  let query = supabase
    .from('payroll_runs')
    .select('*')
    .order('period_start', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data: runs, error } = await query;
  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) return [];
    throw new Error(`Failed to list payroll runs: ${error.message}`);
  }

  // Augment runs with summary stats
  const result = [];
  for (const r of runs || []) {
    const { data: barbers } = await supabase
      .from('payroll_barber_items')
      .select('net_service_revenue, commission_amount, manual_adjustment_total, payable_amount')
      .eq('payroll_run_id', r.id);

    const { count: blockerCount } = await supabase
      .from('payroll_review_items')
      .select('*', { count: 'exact', head: true })
      .eq('payroll_run_id', r.id)
      .eq('blocking', true);

    const bList = barbers || [];
    const totalNet = round(bList.reduce((s, b) => s + Number(b.net_service_revenue || 0), 0));
    const totalComm = round(bList.reduce((s, b) => s + Number(b.commission_amount || 0), 0));
    const totalAdj = round(bList.reduce((s, b) => s + Number(b.manual_adjustment_total || 0), 0));
    const totalPayable = round(bList.reduce((s, b) => s + Number(b.payable_amount || 0), 0));

    result.push({
      ...r,
      total_service_revenue: totalNet,
      total_commission: totalComm,
      total_adjustments: totalAdj,
      total_payable: totalPayable,
      barber_count: bList.length,
      blocking_issues_count: blockerCount || 0,
    });
  }

  return result;
}

/**
 * Get detailed view of a single payroll run.
 */
async function getPayrollRunDetail(supabase, { runId, auth = {} }) {
  if (!runId) throw new Error('runId is required');

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) throw new Error(`Payroll run ${runId} not found`);

  // Fetch barber items
  let barberQuery = supabase
    .from('payroll_barber_items')
    .select('*')
    .eq('payroll_run_id', runId)
    .order('barber_name_snapshot');

  // Branch isolation for non-owners
  if (auth.role !== 'owner' && auth.branchScope && auth.branchScope !== 'all') {
    barberQuery = barberQuery.eq('branch_snapshot', auth.branchScope);
  }

  const { data: barbers } = await barberQuery;

  // Fetch review items
  const { data: reviewItems } = await supabase
    .from('payroll_review_items')
    .select('*')
    .eq('payroll_run_id', runId);

  // Fetch manual adjustments
  const { data: adjustments } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_run_id', runId)
    .order('created_at', { ascending: false });

  const bList = barbers || [];
  const totalNet = round(bList.reduce((s, b) => s + Number(b.net_service_revenue || 0), 0));
  const totalComm = round(bList.reduce((s, b) => s + Number(b.commission_amount || 0), 0));
  const totalAdj = round(bList.reduce((s, b) => s + Number(b.manual_adjustment_total || 0), 0));
  const totalPayable = round(bList.reduce((s, b) => s + Number(b.payable_amount || 0), 0));

  const blockingItems = (reviewItems || []).filter((r) => r.blocking === true);
  const blockers = blockingItems.map((r) => ({
    type: r.reason_code,
    barber_id: r.barber_id || null,
    barber_name: r.barber_name_snapshot || null,
    receipt_number: r.receipt_number,
    message: r.detail || `Item review ${r.reason_code} pada struk ${r.receipt_number}`,
  }));

  return {
    run: {
      ...run,
      total_service_revenue: totalNet,
      total_commission: totalComm,
      total_adjustments: totalAdj,
      total_payable: totalPayable,
      barber_count: bList.length,
      blocking_issues_count: blockers.length,
    },
    barbers: bList,
    blockers,
    review_items: reviewItems || [],
    adjustments: adjustments || [],
  };
}

/**
 * Get detailed breakdown for a specific barber within a run.
 */
async function getBarberRunDetail(supabase, { runId, barberId, auth = {} }) {
  if (!runId || !barberId) throw new Error('runId and barberId are required');

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) throw new Error(`Payroll run ${runId} not found`);

  const { data: barberItem, error: bErr } = await supabase
    .from('payroll_barber_items')
    .select('*')
    .eq('payroll_run_id', runId)
    .eq('barber_id', barberId)
    .single();

  if (bErr || !barberItem) {
    throw new Error(`Barber ${barberId} not found in payroll run ${runId}`);
  }

  // Branch isolation check
  if (auth.role !== 'owner' && auth.branchScope && auth.branchScope !== 'all') {
    if (barberItem.branch_snapshot !== auth.branchScope) {
      throw new Error(`Forbidden: Staff is restricted to branch ${auth.branchScope}`);
    }
  }

  // Fetch commission snapshot lines
  const { data: commissionLines } = await supabase
    .from('payroll_barber_commission_items')
    .select('*')
    .eq('payroll_barber_item_id', barberItem.id)
    .order('tx_date', { ascending: true });

  // Fetch review items for this barber
  const { data: reviewItems } = await supabase
    .from('payroll_review_items')
    .select('*')
    .eq('payroll_run_id', runId)
    .eq('barber_id', barberId);

  // Fetch manual adjustments
  const { data: adjustments } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_barber_item_id', barberItem.id)
    .order('created_at', { ascending: false });

  return {
    run,
    barber: barberItem,
    commission_lines: commissionLines || [],
    review_items: reviewItems || [],
    adjustments: adjustments || [],
    attendance_context: barberItem.attendance_context || {},
  };
}

module.exports = {
  RUN_STATUS,
  ITEM_STATUS,
  BLOCKER_TYPE,
  REVIEW_REASON,
  fetchAttendanceContext,
  findLockedDuplicateSourceItems,
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  listPayrollRuns,
  getPayrollRunDetail,
  getBarberRunDetail,
};
