'use strict';

/**
 * REDBOX COMMAND CENTER — Task 2.2: Revenue Sharing Service
 *
 * Ground truth & canonical authority:
 *   - Calculations are strictly derived from `moka_transaction_items` (canonical line items)
 *   - Only items with classification = 'NON_STOCK_SERVICE', is_deleted = false, and non-null barber_id
 *     are eligible for barber service commission.
 *   - Retail (STOCK_PRODUCT) and F&B/membership (NON_STOCK_MISC) are excluded from the commission base.
 *   - Rate authority is `barber_commission_rates` (historical) with fallback to `barbers.commission_rate`.
 *   - Zero fallback rate: if rate is null, status is MISSING_RATE and calculated_commission is null.
 *   - Never reads moka_barber_services.revenue_share.
 */

const STATUS = Object.freeze({
  READY: 'READY',
  MISSING_RATE: 'MISSING_RATE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  PARTIAL: 'PARTIAL',
});

const CLASSIFICATION = Object.freeze({
  STOCK_PRODUCT: 'STOCK_PRODUCT',
  NON_STOCK_SERVICE: 'NON_STOCK_SERVICE',
  NON_STOCK_MISC: 'NON_STOCK_MISC',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

function round(num) {
  if (num == null || !Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function dayBefore(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure function to resolve the effective rate for a barber on a given transaction date.
 *
 * @param {Array} historyRows Array of { barber_id, rate, effective_from, effective_to }
 * @param {string|null} barberFallbackRate Value from barbers.commission_rate
 * @param {string} txDate YYYY-MM-DD
 * @returns {{ rate: number|null, rate_source: string, effective_from: string|null }}
 */
function resolveBarberRateForDate(historyRows = [], barberFallbackRate = null, txDate) {
  const targetDate = formatDate(txDate);
  if (!targetDate) {
    return { rate: null, rate_source: 'missing', effective_from: null };
  }

  // Filter matching effective intervals
  const matching = historyRows
    .filter((row) => {
      const from = formatDate(row.effective_from);
      const to = row.effective_to ? formatDate(row.effective_to) : null;
      if (!from || from > targetDate) return false;
      if (to && to < targetDate) return false;
      return true;
    })
    .sort((a, b) => formatDate(b.effective_from).localeCompare(formatDate(a.effective_from)));

  if (matching.length > 0) {
    const active = matching[0];
    const rateNum = Number(active.rate);
    if (Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 1) {
      return {
        rate: rateNum,
        rate_source: 'barber_commission_rates',
        effective_from: formatDate(active.effective_from),
      };
    }
  }

  // Fallback to barbers.commission_rate if present
  if (barberFallbackRate != null) {
    const fallbackNum = Number(barberFallbackRate);
    if (Number.isFinite(fallbackNum) && fallbackNum >= 0 && fallbackNum <= 1) {
      return {
        rate: fallbackNum,
        rate_source: 'barbers',
        effective_from: null,
      };
    }
  }

  return { rate: null, rate_source: 'missing', effective_from: null };
}

/**
 * Fetch rate history for a list of barber IDs from database.
 */
async function fetchBarberRateHistory(supabase, barberIds = []) {
  if (!barberIds.length) return [];
  try {
    const { data, error } = await supabase
      .from('barber_commission_rates')
      .select('id, barber_id, rate, effective_from, effective_to, created_by, created_at')
      .in('barber_id', barberIds)
      .order('effective_from', { ascending: false });

    if (error) {
      // Table might not exist yet if migration is pending
      if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
        return [];
      }
      console.warn('[RevenueSharing] Error fetching barber_commission_rates:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[RevenueSharing] Exception fetching barber_commission_rates:', err.message);
    return [];
  }
}

/**
 * Set/update barber commission rate with history protection.
 * Requires Owner privileges.
 */
async function setBarberCommissionRate(supabase, { barberId, rate, effectiveFrom, createdBy }) {
  if (!barberId) throw new Error('barber_id is required');
  const rateNum = Number(rate);
  if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 1) {
    throw new Error('Rate must be a decimal fraction between 0.00 and 1.00 (e.g. 0.35)');
  }
  const effFrom = formatDate(effectiveFrom);
  if (!effFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effFrom)) {
    throw new Error('effective_from must be a valid date formatted YYYY-MM-DD');
  }

  // 1. Fetch current history for this barber
  const { data: existingRows, error: fetchErr } = await supabase
    .from('barber_commission_rates')
    .select('id, barber_id, rate, effective_from, effective_to')
    .eq('barber_id', barberId)
    .order('effective_from', { ascending: true });

  if (fetchErr) {
    throw new Error(`Failed to query existing rates: ${fetchErr.message}`);
  }

  // 2. Prevent overlapping / invalid collisions
  // Look for any existing rate with the exact same effective_from
  const exactMatch = (existingRows || []).find((r) => formatDate(r.effective_from) === effFrom);
  if (exactMatch) {
    // Update the existing entry for this exact effective_from date
    const { data: updated, error: updateErr } = await supabase
      .from('barber_commission_rates')
      .update({
        rate: rateNum,
        created_by: createdBy || 'owner',
        updated_at: new Date().toISOString(),
      })
      .eq('id', exactMatch.id)
      .select()
      .single();

    if (updateErr) throw new Error(`Failed to update rate: ${updateErr.message}`);

    // Update convenience column on barbers if effective now
    const today = new Date().toISOString().slice(0, 10);
    if (effFrom <= today) {
      await supabase.from('barbers').update({ commission_rate: rateNum }).eq('id', barberId);
    }

    return updated;
  }

  // Close any open-ended rate that started before new effective_from
  const openRates = (existingRows || []).filter(
    (r) => formatDate(r.effective_from) < effFrom && (!r.effective_to || formatDate(r.effective_to) >= effFrom)
  );

  const prevEffectiveTo = dayBefore(effFrom);
  for (const openRate of openRates) {
    await supabase
      .from('barber_commission_rates')
      .update({
        effective_to: prevEffectiveTo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', openRate.id);
  }

  // 3. Insert new rate row
  const { data: inserted, error: insertErr } = await supabase
    .from('barber_commission_rates')
    .insert({
      barber_id: barberId,
      rate: rateNum,
      effective_from: effFrom,
      effective_to: null,
      created_by: createdBy || 'owner',
    })
    .select()
    .single();

  if (insertErr) throw new Error(`Failed to insert commission rate: ${insertErr.message}`);

  // 4. Update convenience cache column on barbers if currently active
  const today = new Date().toISOString().slice(0, 10);
  if (effFrom <= today) {
    await supabase.from('barbers').update({ commission_rate: rateNum }).eq('id', barberId);
  }

  return inserted;
}

/**
 * Pure calculation function for Revenue Sharing Preview.
 * Takes raw items, barbers list, and rate history rows and computes preview aggregates.
 */
function calculateRevenueSharingPreview({
  items = [],
  barbers = [],
  rateHistory = [],
  dateFrom,
  dateTo,
  branchFilter = null,
  barberFilter = null,
  statusFilter = null,
}) {
  // Pre-index rate history by barber_id
  const historyByBarber = new Map();
  for (const row of rateHistory) {
    if (!historyByBarber.has(row.barber_id)) {
      historyByBarber.set(row.barber_id, []);
    }
    historyByBarber.get(row.barber_id).push(row);
  }

  // Filter barbers by branch or barber ID if requested
  let targetBarbers = barbers;
  if (branchFilter && branchFilter !== 'all') {
    targetBarbers = targetBarbers.filter(
      (b) => b.branch === branchFilter || b.outlet_slug === branchFilter
    );
  }
  if (barberFilter && barberFilter !== 'all') {
    targetBarbers = targetBarbers.filter((b) => b.id === barberFilter);
  }

  // Group transaction items by barber_id
  const itemsByBarber = new Map();
  const unassignedServiceItems = [];
  const unassignedReviewItems = [];

  for (const item of items) {
    const bId = item.barber_id;
    if (!bId) {
      if (item.classification === CLASSIFICATION.NON_STOCK_SERVICE) {
        unassignedServiceItems.push(item);
      } else if (item.classification === CLASSIFICATION.REVIEW_REQUIRED) {
        unassignedReviewItems.push(item);
      }
      continue;
    }
    if (!itemsByBarber.has(bId)) {
      itemsByBarber.set(bId, []);
    }
    itemsByBarber.get(bId).push(item);
  }

  const barberSummaries = [];

  for (const barber of targetBarbers) {
    const barberItems = itemsByBarber.get(barber.id) || [];
    const barberHistory = historyByBarber.get(barber.id) || [];

    let grossServiceRevenue = 0;
    let discountTotal = 0;
    let netServiceRevenue = 0;
    let serviceItemCount = 0;
    let reviewRequiredCount = 0;
    let missingRateCount = 0;
    let calculatedCommission = 0;
    const receiptsSet = new Set();
    const ratesUsedSet = new Set();

    // Check rate on dateTo (or current date) for general display
    const latestRateRes = resolveBarberRateForDate(
      barberHistory,
      barber.commission_rate,
      dateTo || new Date().toISOString().slice(0, 10)
    );

    for (const item of barberItems) {
      if (item.is_deleted) continue;

      if (item.classification === CLASSIFICATION.REVIEW_REQUIRED) {
        reviewRequiredCount++;
        continue;
      }

      if (item.classification === CLASSIFICATION.NON_STOCK_SERVICE) {
        const qty = Number(item.quantity) || 1;
        const refunded = Number(item.refunded_quantity) || 0;
        const effectiveQty = Math.max(0, qty - refunded);

        // If completely refunded, skip from commissionable base
        if (effectiveQty <= 0) continue;

        const gross = Number(item.gross_amount) || 0;
        const disc = Number(item.discount_amount) || 0;
        const net = item.net_amount != null ? Number(item.net_amount) : (gross - disc);

        grossServiceRevenue += gross;
        discountTotal += disc;
        netServiceRevenue += net;
        serviceItemCount += effectiveQty;
        if (item.receipt_number) receiptsSet.add(item.receipt_number);

        // Resolve rate for this item's specific transaction date
        const rateRes = resolveBarberRateForDate(
          barberHistory,
          barber.commission_rate,
          item.tx_date
        );

        if (rateRes.rate == null) {
          missingRateCount++;
        } else {
          ratesUsedSet.add(rateRes.rate);
          calculatedCommission += net * rateRes.rate;
        }
      }
    }

    // Determine barber status
    let status = STATUS.READY;
    let finalCommission = round(calculatedCommission);

    if (missingRateCount > 0 || latestRateRes.rate == null) {
      status = STATUS.MISSING_RATE;
      finalCommission = null; // NEVER silently calculate or guess commission without a rate
    } else if (reviewRequiredCount > 0) {
      status = STATUS.REVIEW_REQUIRED;
    } else if (serviceItemCount === 0) {
      status = STATUS.READY;
    }

    // Representative commission rate to display
    let displayRate = latestRateRes.rate;
    if (ratesUsedSet.size === 1) {
      displayRate = [...ratesUsedSet][0];
    } else if (ratesUsedSet.size > 1) {
      // Rates varied across the period
      displayRate = latestRateRes.rate;
    }

    barberSummaries.push({
      barber_id: barber.id,
      barber_name: barber.name,
      outlet_id: barber.outlet_id || barber.branch || null,
      outlet_slug: barber.branch || barber.outlet_slug || 'unknown',
      outlet_name: barber.branch_name || barber.branch || 'Redbox Barbershop',
      date_from: dateFrom,
      date_to: dateTo,
      service_transaction_count: receiptsSet.size,
      service_item_count: serviceItemCount,
      customer_count_if_reliably_available: receiptsSet.size,
      gross_service_revenue: round(grossServiceRevenue),
      discount_total: round(discountTotal),
      net_service_revenue: round(netServiceRevenue),
      commission_rate: displayRate,
      rate_source: latestRateRes.rate_source,
      effective_from: latestRateRes.effective_from,
      calculated_commission: finalCommission,
      review_required_count: reviewRequiredCount,
      missing_rate_count: missingRateCount,
      status,
    });
  }

  // Sort by branch then barber name
  barberSummaries.sort((a, b) => {
    const branchComp = (a.outlet_slug || '').localeCompare(b.outlet_slug || '');
    if (branchComp !== 0) return branchComp;
    return a.barber_name.localeCompare(b.barber_name, 'id', { sensitivity: 'base' });
  });

  // Apply optional status filter
  let filteredSummaries = barberSummaries;
  if (statusFilter && statusFilter !== 'all') {
    filteredSummaries = barberSummaries.filter((b) => b.status === statusFilter);
  }

  // Top level summary metrics
  const totalNetServiceRevenue = round(
    barberSummaries.reduce((sum, b) => sum + (b.net_service_revenue || 0), 0)
  );
  const totalEstimatedCommission = round(
    barberSummaries.reduce((sum, b) => sum + (b.calculated_commission || 0), 0)
  );
  const kapsterReadyCount = barberSummaries.filter((b) => b.status === STATUS.READY && b.service_item_count > 0).length;
  const needReviewCount = barberSummaries.filter(
    (b) => b.status === STATUS.REVIEW_REQUIRED || b.status === STATUS.MISSING_RATE
  ).length;
  const missingRateCountTotal = barberSummaries.filter((b) => b.status === STATUS.MISSING_RATE).length;

  return {
    summary: {
      total_net_service_revenue: totalNetServiceRevenue,
      total_estimated_commission: totalEstimatedCommission,
      kapster_ready_count: kapsterReadyCount,
      need_review_count: needReviewCount,
      missing_rate_count: missingRateCountTotal,
      unassigned_service_items_count: unassignedServiceItems.length,
      unassigned_review_items_count: unassignedReviewItems.length,
    },
    barbers: filteredSummaries,
    unassigned: {
      service_items_count: unassignedServiceItems.length,
      review_items_count: unassignedReviewItems.length,
      sample_unassigned: unassignedServiceItems.slice(0, 10).map((i) => ({
        receipt_number: i.receipt_number,
        item_name: i.item_name,
        net_amount: i.net_amount,
        tx_date: i.tx_date,
      })),
    },
  };
}

/**
 * Backend service function to retrieve Revenue Sharing Preview from database.
 */
async function getRevenueSharingPreview(supabase, {
  dateFrom,
  dateTo,
  branch = null,
  barberId = null,
  status = null,
  auth = null,
}) {
  // Enforce server-side authorization: Manager cannot access branches outside their own
  let effectiveBranch = branch;
  if (auth && auth.role !== 'owner') {
    if (!auth.branch) {
      throw new Error('Access denied: Staff has no assigned branch');
    }
    if (branch && branch !== 'all' && branch !== auth.branch) {
      const err = new Error(`Forbidden: Staff is restricted to branch ${auth.branch}`);
      err.status = 403;
      throw err;
    }
    effectiveBranch = auth.branch;
  }

  // 1. Fetch active barbers for this branch / all branches
  let barberQuery = supabase
    .from('barbers')
    .select('id, name, branch, commission_rate, is_active')
    .eq('is_active', true);

  if (effectiveBranch && effectiveBranch !== 'all') {
    barberQuery = barberQuery.eq('branch', effectiveBranch);
  }
  if (barberId && barberId !== 'all') {
    barberQuery = barberQuery.eq('id', barberId);
  }

  const { data: barbers, error: barberErr } = await barberQuery;
  if (barberErr) {
    throw new Error(`Failed to load barbers: ${barberErr.message}`);
  }

  const barberIds = (barbers || []).map((b) => b.id);

  // 2. Fetch rate history for these barbers
  const rateHistory = await fetchBarberRateHistory(supabase, barberIds);

  // 3. Fetch canonical moka_transaction_items
  let itemsQuery = supabase
    .from('moka_transaction_items')
    .select(`
      id, receipt_number, source_line_key, outlet_slug, tx_date, tx_time,
      item_name, variant_name, category_name, quantity, gross_amount, discount_amount,
      net_amount, classification, barber_id, barber_name_raw, is_deleted, refunded_quantity
    `)
    .eq('is_deleted', false);

  if (dateFrom) itemsQuery = itemsQuery.gte('tx_date', dateFrom);
  if (dateTo) itemsQuery = itemsQuery.lte('tx_date', dateTo);
  if (effectiveBranch && effectiveBranch !== 'all') {
    itemsQuery = itemsQuery.eq('outlet_slug', effectiveBranch);
  }
  if (barberId && barberId !== 'all') {
    itemsQuery = itemsQuery.eq('barber_id', barberId);
  }

  const { data: items, error: itemsErr } = await itemsQuery;
  if (itemsErr) {
    throw new Error(`Failed to load transaction items: ${itemsErr.message}`);
  }

  return calculateRevenueSharingPreview({
    items: items || [],
    barbers: barbers || [],
    rateHistory,
    dateFrom,
    dateTo,
    branchFilter: effectiveBranch,
    barberFilter: barberId,
    statusFilter: status,
  });
}

/**
 * Backend service function to get item-level drill-down for a selected barber.
 */
async function getBarberRevenueDetail(supabase, {
  barberId,
  dateFrom,
  dateTo,
  auth = null,
}) {
  if (!barberId) throw new Error('barberId is required');

  // 1. Fetch barber
  const { data: barber, error: bErr } = await supabase
    .from('barbers')
    .select('id, name, branch, commission_rate, is_active')
    .eq('id', barberId)
    .single();

  if (bErr || !barber) {
    throw new Error(`Barber not found: ${bErr?.message || barberId}`);
  }

  // Branch check for Manager
  if (auth && auth.role !== 'owner' && auth.branch && barber.branch !== auth.branch) {
    const err = new Error(`Forbidden: You cannot view barber details for branch ${barber.branch}`);
    err.status = 403;
    throw err;
  }

  // 2. Fetch rate history
  const rateHistory = await fetchBarberRateHistory(supabase, [barberId]);

  // 3. Fetch all transaction items in date range for this barber
  let query = supabase
    .from('moka_transaction_items')
    .select(`
      id, receipt_number, source_line_key, outlet_slug, tx_date, tx_time,
      item_name, variant_name, category_name, quantity, gross_amount, discount_amount,
      net_amount, classification, classification_reason, barber_id, barber_name_raw,
      is_deleted, refunded_quantity
    `)
    .eq('barber_id', barberId)
    .eq('is_deleted', false)
    .order('tx_date', { ascending: false });

  if (dateFrom) query = query.gte('tx_date', dateFrom);
  if (dateTo) query = query.lte('tx_date', dateTo);

  const { data: rawItems, error: iErr } = await query;
  if (iErr) {
    throw new Error(`Failed to load barber transaction items: ${iErr.message}`);
  }

  const items = rawItems || [];

  const serviceItems = [];
  const excludedItems = [];
  const reviewItems = [];

  let totalGross = 0;
  let totalDiscount = 0;
  let totalNet = 0;
  let totalCommission = 0;
  let missingRateCount = 0;

  for (const item of items) {
    const gross = Number(item.gross_amount) || 0;
    const disc = Number(item.discount_amount) || 0;
    const net = item.net_amount != null ? Number(item.net_amount) : (gross - disc);
    const qty = Number(item.quantity) || 1;
    const refunded = Number(item.refunded_quantity) || 0;
    const effectiveQty = Math.max(0, qty - refunded);

    if (item.classification === CLASSIFICATION.NON_STOCK_SERVICE) {
      if (effectiveQty <= 0) continue; // skip refunded

      const rateRes = resolveBarberRateForDate(rateHistory, barber.commission_rate, item.tx_date);
      let itemComm = null;

      if (rateRes.rate == null) {
        missingRateCount++;
      } else {
        itemComm = round(net * rateRes.rate);
        totalCommission += itemComm;
      }

      totalGross += gross;
      totalDiscount += disc;
      totalNet += net;

      serviceItems.push({
        id: item.id,
        receipt_number: item.receipt_number,
        tx_date: item.tx_date,
        tx_time: item.tx_time,
        item_name: item.item_name,
        variant_name: item.variant_name,
        quantity: effectiveQty,
        gross_amount: gross,
        discount_amount: disc,
        net_amount: net,
        rate_used: rateRes.rate,
        rate_source: rateRes.rate_source,
        effective_from: rateRes.effective_from,
        calculated_commission: itemComm,
        status: rateRes.rate == null ? STATUS.MISSING_RATE : STATUS.READY,
      });
    } else if (
      item.classification === CLASSIFICATION.STOCK_PRODUCT ||
      item.classification === CLASSIFICATION.NON_STOCK_MISC
    ) {
      excludedItems.push({
        id: item.id,
        receipt_number: item.receipt_number,
        tx_date: item.tx_date,
        item_name: item.item_name,
        variant_name: item.variant_name,
        classification: item.classification,
        reason: item.classification === CLASSIFICATION.STOCK_PRODUCT
          ? 'Produk Retail (Non-Komisi Servis)'
          : 'F&B / Membership / Non-Servis',
        net_amount: net,
      });
    } else {
      reviewItems.push({
        id: item.id,
        receipt_number: item.receipt_number,
        tx_date: item.tx_date,
        item_name: item.item_name,
        classification: item.classification,
        classification_reason: item.classification_reason || 'Klasifikasi perlu dikonfirmasi',
        net_amount: net,
      });
    }
  }

  const latestRate = resolveBarberRateForDate(
    rateHistory,
    barber.commission_rate,
    dateTo || new Date().toISOString().slice(0, 10)
  );

  return {
    barber: {
      id: barber.id,
      name: barber.name,
      branch: barber.branch,
      commission_rate: latestRate.rate,
      rate_source: latestRate.rate_source,
      effective_from: latestRate.effective_from,
    },
    summary: {
      service_item_count: serviceItems.length,
      excluded_item_count: excludedItems.length,
      review_item_count: reviewItems.length,
      gross_service_revenue: round(totalGross),
      discount_total: round(totalDiscount),
      net_service_revenue: round(totalNet),
      estimated_commission: missingRateCount > 0 ? null : round(totalCommission),
      missing_rate_count: missingRateCount,
      status: missingRateCount > 0
        ? STATUS.MISSING_RATE
        : reviewItems.length > 0
        ? STATUS.REVIEW_REQUIRED
        : STATUS.READY,
    },
    service_items: serviceItems,
    excluded_items: excludedItems,
    review_items: reviewItems,
    rate_history: rateHistory,
  };
}

module.exports = {
  STATUS,
  CLASSIFICATION,
  round,
  formatDate,
  dayBefore,
  resolveBarberRateForDate,
  fetchBarberRateHistory,
  setBarberCommissionRate,
  calculateRevenueSharingPreview,
  getRevenueSharingPreview,
  getBarberRevenueDetail,
};
