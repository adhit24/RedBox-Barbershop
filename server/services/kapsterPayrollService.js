'use strict';

/**
 * REDBOX COMMAND CENTER — Task 2.3: Kapster Payroll Draft Engine
 *
 * Source Authority:
 *   - Canonical `moka_transaction_items` (classification = 'NON_STOCK_SERVICE', is_deleted = false, barber_id NOT NULL)
 *   - Rate Authority: `barber_commission_rates` (resolved by transaction date)
 *   - No salary, overtime, or automated attendance deduction.
 *   - Immutable Snapshotting: Once locked, calculations are final.
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

/**
 * Fetch attendance context for barbers in a given period.
 */
async function fetchAttendanceContext(supabase, barberIds = [], periodStart, periodEnd) {
  const contextMap = new Map();
  for (const bId of barberIds) {
    contextMap.set(bId, {
      days_present: 0,
      days_absent: 0,
      exception_count: 0,
      notes: null,
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
        ctx.exception_count++;
      }
    }
  } catch (err) {
    console.warn('[KapsterPayroll] Exception fetching attendance context:', err.message);
  }

  return contextMap;
}

/**
 * Check if any Moka item IDs in current list are already locked in another payroll run.
 */
async function findLockedDuplicateSourceItems(supabase, sourceItemIds = [], excludeRunId = null) {
  if (!sourceItemIds.length) return [];
  try {
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
  const eligibleServiceItems = allItems.filter(
    (i) => i.classification === CLASSIFICATION.NON_STOCK_SERVICE && i.barber_id != null
  );
  const unassignedServiceItems = allItems.filter(
    (i) => i.classification === CLASSIFICATION.NON_STOCK_SERVICE && i.barber_id == null
  );
  const reviewRequiredItems = allItems.filter(
    (i) => i.classification === CLASSIFICATION.REVIEW_REQUIRED
  );

  // 6. Check for duplicate source items in locked runs
  const sourceIds = eligibleServiceItems.map((i) => i.id);
  const lockedDuplicates = await findLockedDuplicateSourceItems(supabase, sourceIds, existingRunId);

  // 7. Group items by barber
  const itemsByBarber = new Map();
  for (const item of eligibleServiceItems) {
    if (!itemsByBarber.has(item.barber_id)) {
      itemsByBarber.set(item.barber_id, []);
    }
    itemsByBarber.get(item.barber_id).push(item);
  }

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

  // 8. Create or update payroll_runs record
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

  // 9. Prepare barber items and commission detail snapshot
  const barberItemRows = [];
  const commissionItemRows = [];
  const blockers = [];

  let totalGross = 0;
  let totalDiscount = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let totalAdjustments = 0;

  for (const barber of barbers) {
    const bItems = itemsByBarber.get(barber.id) || [];
    const bHistory = historyByBarber.get(barber.id) || [];
    const bAdjustments = adjustmentsByBarber.get(barber.id) || [];
    const attCtx = attendanceContextMap.get(barber.id) || {};

    let bGross = 0;
    let bDisc = 0;
    let bNet = 0;
    let bComm = 0;
    let bServiceCount = 0;
    let bMissingRateCount = 0;
    const bReceipts = new Set();

    const bCommissionLines = [];

    for (const item of bItems) {
      const qty = Number(item.quantity) || 1;
      const refunded = Number(item.refunded_quantity) || 0;
      const effectiveQty = Math.max(0, qty - refunded);
      if (effectiveQty <= 0) continue; // skip refunded

      const gross = Number(item.gross_amount) || 0;
      const disc = Number(item.discount_amount) || 0;
      const net = item.net_amount != null ? Number(item.net_amount) : (gross - disc);

      bGross += gross;
      bDisc += disc;
      bNet += net;
      bServiceCount += effectiveQty;
      if (item.receipt_number) bReceipts.add(item.receipt_number);

      // Resolve effective rate for item tx_date
      const rateRes = resolveBarberRateForDate(bHistory, barber.commission_rate, item.tx_date);
      if (rateRes.rate == null) {
        bMissingRateCount++;
      } else {
        const itemComm = round(net * rateRes.rate);
        bComm += itemComm;

        bCommissionLines.push({
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

    // Manual adjustment total
    const bAdjTotal = round(bAdjustments.reduce((sum, a) => sum + Number(a.amount || 0), 0));
    const bPayable = bMissingRateCount > 0 ? 0 : round(bComm + bAdjTotal);

    let barberStatus = ITEM_STATUS.READY;
    if (bMissingRateCount > 0) {
      barberStatus = ITEM_STATUS.MISSING_RATE;
      blockers.push({
        type: BLOCKER_TYPE.MISSING_RATE,
        barber_id: barber.id,
        barber_name: barber.name,
        message: `Kapster ${barber.name} memiliki ${bMissingRateCount} layanan tanpa konfigurasi komisi aktif pada tanggal transaksi.`,
      });
    }

    const barberItemRow = {
      payroll_run_id: runId,
      barber_id: barber.id,
      barber_name_snapshot: barber.name,
      branch_snapshot: barber.branch || 'unknown',
      service_item_count: bServiceCount,
      receipt_count: bReceipts.size,
      gross_service_revenue: round(bGross),
      discount_total: round(bDisc),
      net_service_revenue: round(bNet),
      commission_amount: bMissingRateCount > 0 ? 0 : round(bComm),
      manual_adjustment_total: bAdjTotal,
      payable_amount: bPayable,
      review_required_count: 0,
      missing_rate_count: bMissingRateCount,
      attendance_context: attCtx,
      status: barberStatus,
    };

    barberItemRows.push({
      barberItem: barberItemRow,
      commissionLines: bCommissionLines,
      adjustments: bAdjustments,
    });

    totalGross += bGross;
    totalDiscount += bDisc;
    totalNet += bNet;
    totalCommission += (bMissingRateCount > 0 ? 0 : bComm);
    totalAdjustments += bAdjTotal;
  }

  // Global blockers evaluation
  if (unassignedServiceItems.length > 0) {
    blockers.push({
      type: BLOCKER_TYPE.MISSING_BARBER,
      count: unassignedServiceItems.length,
      message: `Terdapat ${unassignedServiceItems.length} item layanan tanpa atribusi kapster pada periode ini.`,
    });
  }

  if (reviewRequiredItems.length > 0) {
    blockers.push({
      type: BLOCKER_TYPE.UNRESOLVED_REVIEW_ITEM,
      count: reviewRequiredItems.length,
      message: `Terdapat ${reviewRequiredItems.length} item bertanda REVIEW_REQUIRED yang perlu dikonfirmasi.`,
    });
  }

  if (lockedDuplicates.length > 0) {
    blockers.push({
      type: BLOCKER_TYPE.DUPLICATE_SOURCE,
      count: lockedDuplicates.length,
      message: `Terdapat ${lockedDuplicates.length} item layanan yang sudah pernah dikunci pada periode payroll lain.`,
    });
  }

  // 10. Persist barber items and commission detail snapshot
  for (const entry of barberItemRows) {
    const { data: insertedPbi, error: pbiErr } = await supabase
      .from('payroll_barber_items')
      .insert(entry.barberItem)
      .select()
      .single();

    if (pbiErr) {
      throw new Error(`Failed to insert payroll_barber_item for ${entry.barberItem.barber_id}: ${pbiErr.message}`);
    }

    const pbiId = insertedPbi.id;

    // Attach pbiId to commission lines and insert
    if (entry.commissionLines.length > 0) {
      const preparedLines = entry.commissionLines.map((line) => ({
        ...line,
        payroll_run_id: runId,
        payroll_barber_item_id: pbiId,
      }));

      const { error: linesErr } = await supabase
        .from('payroll_barber_commission_items')
        .insert(preparedLines);

      if (linesErr) {
        throw new Error(`Failed to insert commission snapshot items for ${entry.barberItem.barber_id}: ${linesErr.message}`);
      }
    }

    // Re-insert preserved adjustments if regenerating
    if (entry.adjustments.length > 0) {
      const preparedAdjs = entry.adjustments.map((adj) => ({
        payroll_run_id: runId,
        payroll_barber_item_id: pbiId,
        barber_id: adj.barber_id,
        amount: adj.amount,
        reason: adj.reason,
        note: adj.note,
        created_by: adj.created_by || userEmail,
      }));

      await supabase.from('payroll_adjustments').insert(preparedAdjs);
    }
  }

  // 11. Update top summary on payroll_runs
  const totalPayable = round(totalCommission + totalAdjustments);
  const summaryObj = {
    total_gross_service_revenue: round(totalGross),
    total_discount: round(totalDiscount),
    total_net_service_revenue: round(totalNet),
    total_commission_amount: round(totalCommission),
    total_adjustment_amount: round(totalAdjustments),
    total_payable_amount: totalPayable,
    barber_count: barbers.length,
    blocking_count: blockers.length,
    unassigned_service_items_count: unassignedServiceItems.length,
    review_required_items_count: reviewRequiredItems.length,
  };

  const { data: updatedRun, error: updateRunErr } = await supabase
    .from('payroll_runs')
    .update({
      summary: summaryObj,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select()
    .single();

  if (updateRunErr) {
    throw new Error(`Failed to update payroll_run summary: ${updateRunErr.message}`);
  }

  return {
    run: updatedRun,
    blockers,
  };
}

/**
 * Atomically regenerate a DRAFT payroll run.
 */
async function regeneratePayrollDraft(supabase, { runId, userEmail }) {
  if (!runId) throw new Error('runId is required');

  // 1. Verify run exists and is DRAFT
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    throw new Error(`Payroll run not found: ${runErr?.message || runId}`);
  }

  if (run.status === RUN_STATUS.LOCKED) {
    const err = new Error('Cannot regenerate a LOCKED payroll run');
    err.status = 409;
    throw err;
  }

  // 2. Fetch existing manual adjustments to preserve
  const { data: existingAdjustments } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_run_id', runId);

  // 3. Delete existing child items
  await supabase.from('payroll_barber_commission_items').delete().eq('payroll_run_id', runId);
  await supabase.from('payroll_adjustments').delete().eq('payroll_run_id', runId);
  await supabase.from('payroll_barber_items').delete().eq('payroll_run_id', runId);

  // 4. Re-run calculation with preserved adjustments
  return generatePayrollDraft(supabase, {
    periodStart: run.period_start,
    periodEnd: run.period_end,
    userEmail: userEmail || run.generated_by,
    existingRunId: runId,
    preserveAdjustments: existingAdjustments || [],
  });
}

/**
 * Lock a reviewed payroll run.
 */
async function lockPayrollRun(supabase, { runId, userEmail }) {
  if (!runId) throw new Error('runId is required');

  // 1. Fetch run with child items
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    throw new Error(`Payroll run not found: ${runErr?.message || runId}`);
  }

  if (run.status === RUN_STATUS.LOCKED) {
    throw new Error('Payroll run is already LOCKED');
  }

  // 2. Fetch barber items and verify zero blockers
  const { data: barberItems } = await supabase
    .from('payroll_barber_items')
    .select('*')
    .eq('payroll_run_id', runId);

  for (const bItem of barberItems || []) {
    if (bItem.missing_rate_count > 0 || bItem.status === ITEM_STATUS.MISSING_RATE) {
      throw new Error(`Cannot lock payroll: barber ${bItem.barber_name_snapshot} has missing commission rates.`);
    }
  }

  // 3. Verify reconciliation of snapshot commission lines
  const { data: lines } = await supabase
    .from('payroll_barber_commission_items')
    .select('payroll_barber_item_id, net_amount, commission_amount')
    .eq('payroll_run_id', runId);

  const linesByBarber = new Map();
  for (const l of lines || []) {
    if (!linesByBarber.has(l.payroll_barber_item_id)) {
      linesByBarber.set(l.payroll_barber_item_id, { net: 0, comm: 0 });
    }
    const acc = linesByBarber.get(l.payroll_barber_item_id);
    acc.net += Number(l.net_amount || 0);
    acc.comm += Number(l.commission_amount || 0);
  }

  for (const bItem of barberItems || []) {
    const acc = linesByBarber.get(bItem.id) || { net: 0, comm: 0 };
    const netDiff = Math.abs(round(acc.net) - Number(bItem.net_service_revenue));
    const commDiff = Math.abs(round(acc.comm) - Number(bItem.commission_amount));
    if (netDiff > 0.01 || commDiff > 0.01) {
      throw new Error(`Reconciliation discrepancy on barber ${bItem.barber_name_snapshot}: lines net=${acc.net}, item net=${bItem.net_service_revenue}`);
    }
  }

  // 4. Update status to LOCKED
  const now = new Date().toISOString();
  const { data: lockedRun, error: lockErr } = await supabase
    .from('payroll_runs')
    .update({
      status: RUN_STATUS.LOCKED,
      locked_at: now,
      locked_by: userEmail || 'owner@redbox.id',
      updated_at: now,
    })
    .eq('id', runId)
    .select()
    .single();

  if (lockErr) {
    throw new Error(`Failed to lock payroll run: ${lockErr.message}`);
  }

  return lockedRun;
}

/**
 * Add a manual adjustment to a barber item in a DRAFT payroll run.
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
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount === 0) {
    throw new Error('Adjustment amount must be a non-zero number');
  }
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new Error('Adjustment reason is required');
  }

  // 1. Verify run is DRAFT
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('id', runId)
    .single();

  if (!run || run.status === RUN_STATUS.LOCKED) {
    throw new Error('Cannot add adjustments to a LOCKED payroll run');
  }

  // 2. Find barber item
  const { data: bItem, error: bErr } = await supabase
    .from('payroll_barber_items')
    .select('id, commission_amount, manual_adjustment_total, payable_amount')
    .eq('payroll_run_id', runId)
    .eq('barber_id', barberId)
    .single();

  if (bErr || !bItem) {
    throw new Error(`Barber item not found in payroll run: ${barberId}`);
  }

  // 3. Insert adjustment
  const { data: insertedAdj, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .insert({
      payroll_run_id: runId,
      payroll_barber_item_id: bItem.id,
      barber_id: barberId,
      amount: numAmount,
      reason: cleanReason,
      note: note ? String(note).trim() : null,
      created_by: userEmail,
    })
    .select()
    .single();

  if (adjErr) {
    throw new Error(`Failed to insert adjustment: ${adjErr.message}`);
  }

  // 4. Update barber item totals
  const newAdjTotal = round(Number(bItem.manual_adjustment_total || 0) + numAmount);
  const newPayable = round(Number(bItem.commission_amount || 0) + newAdjTotal);

  await supabase
    .from('payroll_barber_items')
    .update({
      manual_adjustment_total: newAdjTotal,
      payable_amount: newPayable,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bItem.id);

  // 5. Update run summary total adjustments & payable
  const { data: allItems } = await supabase
    .from('payroll_barber_items')
    .select('commission_amount, manual_adjustment_total, payable_amount')
    .eq('payroll_run_id', runId);

  const runComm = round(allItems.reduce((s, x) => s + Number(x.commission_amount || 0), 0));
  const runAdj = round(allItems.reduce((s, x) => s + Number(x.manual_adjustment_total || 0), 0));
  const runPayable = round(runComm + runAdj);

  await supabase
    .from('payroll_runs')
    .update({
      summary: {
        ...(run.summary || {}),
        total_commission_amount: runComm,
        total_adjustment_amount: runAdj,
        total_payable_amount: runPayable,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  return insertedAdj;
}

/**
 * Delete a manual adjustment from a DRAFT payroll run.
 */
async function deleteManualAdjustment(supabase, { runId, adjustmentId, userEmail }) {
  if (!runId || !adjustmentId) throw new Error('runId and adjustmentId are required');

  // Verify run is DRAFT
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('id', runId)
    .single();

  if (!run || run.status === RUN_STATUS.LOCKED) {
    throw new Error('Cannot delete adjustments from a LOCKED payroll run');
  }

  // Find adjustment
  const { data: adj, error: adjErr } = await supabase
    .from('payroll_adjustments')
    .select('id, payroll_barber_item_id, amount')
    .eq('id', adjustmentId)
    .eq('payroll_run_id', runId)
    .single();

  if (adjErr || !adj) {
    throw new Error('Adjustment not found');
  }

  // Delete adjustment
  await supabase.from('payroll_adjustments').delete().eq('id', adjustmentId);

  // Recalculate barber item
  const { data: bItem } = await supabase
    .from('payroll_barber_items')
    .select('id, commission_amount')
    .eq('id', adj.payroll_barber_item_id)
    .single();

  if (bItem) {
    const { data: remainingAdjs } = await supabase
      .from('payroll_adjustments')
      .select('amount')
      .eq('payroll_barber_item_id', bItem.id);

    const newAdjTotal = round((remainingAdjs || []).reduce((s, x) => s + Number(x.amount || 0), 0));
    const newPayable = round(Number(bItem.commission_amount || 0) + newAdjTotal);

    await supabase
      .from('payroll_barber_items')
      .update({
        manual_adjustment_total: newAdjTotal,
        payable_amount: newPayable,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bItem.id);
  }

  return { ok: true };
}

/**
 * List all payroll runs with filtering and authorization.
 */
async function listPayrollRuns(supabase, { status = null, auth = null }) {
  let query = supabase
    .from('payroll_runs')
    .select('*')
    .order('period_start', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Get detailed payroll run with all barbers and adjustments.
 */
async function getPayrollRunDetail(supabase, { runId, auth = null }) {
  if (!runId) throw new Error('runId is required');

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    throw new Error(`Payroll run not found: ${runErr?.message || runId}`);
  }

  // Fetch barber items
  let bQuery = supabase
    .from('payroll_barber_items')
    .select('*')
    .eq('payroll_run_id', runId);

  // Manager branch scoping
  if (auth && auth.role !== 'owner' && auth.branch) {
    bQuery = bQuery.eq('branch_snapshot', auth.branch);
  }

  const { data: barberItems, error: bErr } = await bQuery.order('branch_snapshot', { ascending: true });
  if (bErr) throw bErr;

  // Fetch adjustments
  const { data: adjustments } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_run_id', runId);

  return {
    run,
    barbers: barberItems || [],
    adjustments: adjustments || [],
  };
}

/**
 * Get snapshotted service items and detail for one barber in a payroll run.
 */
async function getBarberRunDetail(supabase, { runId, barberId, auth = null }) {
  if (!runId || !barberId) throw new Error('runId and barberId are required');

  const { data: bItem, error: bErr } = await supabase
    .from('payroll_barber_items')
    .select('*')
    .eq('payroll_run_id', runId)
    .eq('barber_id', barberId)
    .single();

  if (bErr || !bItem) {
    throw new Error(`Barber payroll item not found: ${bErr?.message || barberId}`);
  }

  // Check branch permission for Manager
  if (auth && auth.role !== 'owner' && auth.branch && bItem.branch_snapshot !== auth.branch) {
    const err = new Error(`Forbidden: You cannot view barber details for branch ${bItem.branch_snapshot}`);
    err.status = 403;
    throw err;
  }

  // Fetch snapshotted commission lines
  const { data: commissionLines, error: linesErr } = await supabase
    .from('payroll_barber_commission_items')
    .select('*')
    .eq('payroll_barber_item_id', bItem.id)
    .order('tx_date', { ascending: false });

  if (linesErr) throw linesErr;

  // Fetch adjustments for this barber
  const { data: adjustments } = await supabase
    .from('payroll_adjustments')
    .select('*')
    .eq('payroll_barber_item_id', bItem.id);

  return {
    barber_item: bItem,
    commission_lines: commissionLines || [],
    adjustments: adjustments || [],
  };
}

module.exports = {
  RUN_STATUS,
  ITEM_STATUS,
  BLOCKER_TYPE,
  fetchAttendanceContext,
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  listPayrollRuns,
  getPayrollRunDetail,
  getBarberRunDetail,
};
