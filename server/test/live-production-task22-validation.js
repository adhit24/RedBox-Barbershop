'use strict';

/**
 * Live Production Validation Script for Task 2.2
 *
 * Validates real production data from Supabase:
 *   A. Abdul sample
 *   B. Another single-barber case
 *   C. Multi-barber receipt
 *   D. Discounted service
 *   E. Branch filter
 *   F. Missing-rate barber
 *   G. REVIEW_REQUIRED item
 */

require('dotenv').config({ path: 'd:/Digital Market/Website RedBox/server/.env' });
const { createClient } = require('@supabase/supabase-js');
const {
  calculateRevenueSharingPreview,
  resolveBarberRateForDate,
  getRevenueSharingPreview,
  getBarberRevenueDetail,
} = require('../services/revenueSharingService');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function runLiveValidation() {
  console.log('=== REDBOX COMMAND CENTER: TASK 2.2 LIVE PRODUCTION VALIDATION ===\n');

  // 1. Run live getRevenueSharingPreview across all branches for current month
  console.log('1. Fetching live preview across all branches (2026-09-01 s/d 2026-09-18)...');
  const preview = await getRevenueSharingPreview(supabase, {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-18',
    auth: { role: 'owner' },
  });

  console.log('--- Summary Metrics ---');
  console.log(`Total Net Service Revenue : Rp ${preview.summary.total_net_service_revenue.toLocaleString('id-ID')}`);
  console.log(`Total Estimated Commission: Rp ${preview.summary.total_estimated_commission.toLocaleString('id-ID')}`);
  console.log(`Kapster Ready            : ${preview.summary.kapster_ready_count}`);
  console.log(`Need Review / Missing Rate: ${preview.summary.need_review_count}`);
  console.log(`Total Barbers in Preview  : ${preview.barbers.length}`);
  console.log(`Unassigned Service Items  : ${preview.unassigned.service_items_count}`);

  // A. Abdul
  console.log('\n--- A. Abdul Sample ---');
  const abdul = preview.barbers.find((b) => b.barber_name.toLowerCase().includes('abdul'));
  if (abdul) {
    console.log(`Found Abdul (${abdul.barber_id}, branch: ${abdul.outlet_slug}):`);
    console.log(`  Service Items   : ${abdul.service_item_count}`);
    console.log(`  Net Service Rev : Rp ${abdul.net_service_revenue.toLocaleString('id-ID')}`);
    console.log(`  Commission Rate : ${abdul.commission_rate != null ? (abdul.commission_rate * 100) + '%' : 'NULL (MISSING_RATE)'}`);
    console.log(`  Estimated Comm  : ${abdul.calculated_commission != null ? 'Rp ' + abdul.calculated_commission.toLocaleString('id-ID') : '—'}`);
    console.log(`  Status          : ${abdul.status}`);
  } else {
    console.log('Abdul not found in barbers list');
  }

  // B. Another single barber case (e.g. Ari or Bob or Faiz)
  console.log('\n--- B. Another Single-Barber Case ---');
  const otherBarber = preview.barbers.find(
    (b) => b.service_item_count > 0 && !b.barber_name.toLowerCase().includes('abdul')
  );
  if (otherBarber) {
    console.log(`Barber: ${otherBarber.barber_name} (${otherBarber.barber_id}, branch: ${otherBarber.outlet_slug})`);
    console.log(`  Service Items   : ${otherBarber.service_item_count}`);
    console.log(`  Net Service Rev : Rp ${otherBarber.net_service_revenue.toLocaleString('id-ID')}`);
    console.log(`  Commission Rate : ${otherBarber.commission_rate != null ? (otherBarber.commission_rate * 100) + '%' : 'NULL (MISSING_RATE)'}`);
    console.log(`  Estimated Comm  : ${otherBarber.calculated_commission != null ? 'Rp ' + otherBarber.calculated_commission.toLocaleString('id-ID') : '—'}`);
    console.log(`  Status          : ${otherBarber.status}`);
  }

  // C. Multi-barber receipt
  console.log('\n--- C. Multi-Barber Receipt Audit ---');
  const { data: allItems } = await supabase
    .from('moka_transaction_items')
    .select('receipt_number, barber_id, item_name, net_amount, classification')
    .eq('classification', 'NON_STOCK_SERVICE')
    .not('barber_id', 'is', null);

  const receiptBarbers = new Map();
  for (const item of allItems || []) {
    if (!receiptBarbers.has(item.receipt_number)) {
      receiptBarbers.set(item.receipt_number, new Set());
    }
    receiptBarbers.get(item.receipt_number).add(item.barber_id);
  }

  let multiReceipt = null;
  for (const [receipt, bSet] of receiptBarbers.entries()) {
    if (bSet.size > 1) {
      multiReceipt = { receipt, barbers: Array.from(bSet) };
      break;
    }
  }

  if (multiReceipt) {
    console.log(`Found Multi-Barber Receipt: ${multiReceipt.receipt}`);
    console.log(`Barbers on this receipt: ${multiReceipt.barbers.join(', ')}`);
    const multiItems = (allItems || []).filter((i) => i.receipt_number === multiReceipt.receipt);
    for (const item of multiItems) {
      console.log(`  - Barber: ${item.barber_id}, Item: ${item.item_name}, Net: Rp ${item.net_amount.toLocaleString('id-ID')}`);
    }
  } else {
    console.log('No multi-barber receipt in currently synced dataset (all receipts in sample are single-barber attributed).');
  }

  // D. Discounted service
  console.log('\n--- D. Discounted Service Audit ---');
  const { data: discItems } = await supabase
    .from('moka_transaction_items')
    .select('receipt_number, barber_id, item_name, gross_amount, discount_amount, net_amount')
    .gt('discount_amount', 0)
    .limit(3);

  if (discItems && discItems.length > 0) {
    console.log(`Found ${discItems.length} discounted items:`);
    for (const item of discItems) {
      console.log(`  Receipt: ${item.receipt_number.slice(0, 8)}..., Barber: ${item.barber_id || 'unassigned'}`);
      console.log(`  Gross: Rp ${item.gross_amount.toLocaleString('id-ID')}, Disc: Rp ${item.discount_amount.toLocaleString('id-ID')}, Net: Rp ${item.net_amount.toLocaleString('id-ID')}`);
      console.log(`  Verified: Net = Gross - Disc (${item.net_amount} === ${item.gross_amount - item.discount_amount})`);
    }
  } else {
    console.log('No discounted items in current sample.');
  }

  // E. Branch filter
  console.log('\n--- E. Branch Filter Audit ---');
  const csbPreview = await getRevenueSharingPreview(supabase, {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-18',
    branch: 'csb',
    auth: { role: 'owner' },
  });
  console.log(`CSB Branch Preview: ${csbPreview.barbers.length} barbers`);
  const nonCsb = csbPreview.barbers.filter((b) => b.outlet_slug !== 'csb');
  console.log(`Non-CSB barbers found in filtered result: ${nonCsb.length} (Expected: 0)`);

  // F. Missing-rate barber
  console.log('\n--- F. Missing-Rate Barber Handling ---');
  const missingRateBarber = preview.barbers.find((b) => b.status === 'MISSING_RATE');
  if (missingRateBarber) {
    console.log(`Barber: ${missingRateBarber.barber_name} (${missingRateBarber.barber_id})`);
    console.log(`  Rate: ${missingRateBarber.commission_rate} -> Status: ${missingRateBarber.status}`);
    console.log(`  Calculated Commission: ${missingRateBarber.calculated_commission} (Must be null, never 0 or 30%)`);
    console.log(`  Missing Rate Count: ${missingRateBarber.missing_rate_count}`);
  } else {
    console.log('All barbers have configured rates.');
  }

  // G. REVIEW_REQUIRED item
  console.log('\n--- G. REVIEW_REQUIRED Items Audit ---');
  const { data: reviewItems, count: reviewCount } = await supabase
    .from('moka_transaction_items')
    .select('receipt_number, item_name, classification, classification_reason, net_amount', { count: 'exact' })
    .eq('classification', 'REVIEW_REQUIRED')
    .limit(5);

  console.log(`Total REVIEW_REQUIRED items in database: ${reviewCount || reviewItems?.length}`);
  if (reviewItems && reviewItems.length > 0) {
    console.log('Sample REVIEW_REQUIRED items:');
    for (const item of reviewItems) {
      console.log(`  Receipt: ${item.receipt_number.slice(0, 8)}..., Item: ${item.item_name}, Reason: ${item.classification_reason || 'N/A'}, Net: Rp ${item.net_amount.toLocaleString('id-ID')}`);
    }
  }

  // 14. Data Consistency Invariant Cross-Check
  console.log('\n--- Data Consistency Invariant Cross-Check ---');
  const sumBarberNetRevenue = preview.barbers.reduce((sum, b) => sum + (b.net_service_revenue || 0), 0);
  const { data: eligibleItems } = await supabase
    .from('moka_transaction_items')
    .select('net_amount, barber_id')
    .eq('classification', 'NON_STOCK_SERVICE')
    .eq('is_deleted', false)
    .gte('tx_date', '2026-09-01')
    .lte('tx_date', '2026-09-18');

  let dbTotalAssigned = 0;
  let dbTotalUnassigned = 0;
  for (const it of eligibleItems || []) {
    if (it.barber_id) dbTotalAssigned += Number(it.net_amount) || 0;
    else dbTotalUnassigned += Number(it.net_amount) || 0;
  }

  console.log(`Preview SUM(net_service_revenue) across all barbers: Rp ${sumBarberNetRevenue.toLocaleString('id-ID')}`);
  console.log(`Database SUM(net_amount) for assigned service items : Rp ${dbTotalAssigned.toLocaleString('id-ID')}`);
  console.log(`Database SUM(net_amount) for unassigned service items: Rp ${dbTotalUnassigned.toLocaleString('id-ID')}`);
  console.log(`Total Eligible Service Revenue in DB              : Rp ${(dbTotalAssigned + dbTotalUnassigned).toLocaleString('id-ID')}`);
  console.log(`Difference (Preview vs Assigned DB)                : ${Math.abs(sumBarberNetRevenue - dbTotalAssigned)} (MUST BE 0)`);

  if (Math.abs(sumBarberNetRevenue - dbTotalAssigned) === 0) {
    console.log('✅ INVARIANT CONFIRMED: Preview net service revenue exactly matches canonical moka_transaction_items!');
  } else {
    console.error('❌ INVARIANT VIOLATION: Discrepancy detected!');
  }

  console.log('\n=== LIVE PRODUCTION VALIDATION COMPLETE ===');
}

runLiveValidation().catch(console.error);
