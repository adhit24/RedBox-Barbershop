'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS,
  CLASSIFICATION,
  resolveBarberRateForDate,
  calculateRevenueSharingPreview,
  setBarberCommissionRate,
} = require('../services/revenueSharingService');

test('Task 2.2: Revenue Sharing Service Unit Tests', async (t) => {

  await t.test('A: 30% rate => arithmetic correct (net service revenue * 0.30)', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    const items = [
      {
        receipt_number: 'R01',
        barber_id: 'b1',
        tx_date: '2026-09-15',
        classification: CLASSIFICATION.NON_STOCK_SERVICE,
        quantity: 1,
        gross_amount: 100000,
        discount_amount: 0,
        net_amount: 100000,
        is_deleted: false,
      },
    ];

    const result = calculateRevenueSharingPreview({
      items,
      barbers,
      rateHistory: [],
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    assert.equal(result.barbers.length, 1);
    const abdul = result.barbers[0];
    assert.equal(abdul.status, STATUS.READY);
    assert.equal(abdul.net_service_revenue, 100000);
    assert.equal(abdul.commission_rate, 0.30);
    assert.equal(abdul.calculated_commission, 30000);
    assert.equal(result.summary.total_net_service_revenue, 100000);
    assert.equal(result.summary.total_estimated_commission, 30000);
  });

  await t.test('B: 35% rate => arithmetic correct (net service revenue * 0.35)', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.35 }];
    const items = [
      {
        receipt_number: 'R01',
        barber_id: 'b1',
        tx_date: '2026-09-15',
        classification: CLASSIFICATION.NON_STOCK_SERVICE,
        quantity: 1,
        gross_amount: 100000,
        discount_amount: 0,
        net_amount: 100000,
        is_deleted: false,
      },
    ];

    const result = calculateRevenueSharingPreview({
      items,
      barbers,
      rateHistory: [],
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    const abdul = result.barbers[0];
    assert.equal(abdul.status, STATUS.READY);
    assert.equal(abdul.commission_rate, 0.35);
    assert.equal(abdul.calculated_commission, 35000);
  });

  await t.test('C: missing rate => status MISSING_RATE, calculated_commission null, never silently calculated', () => {
    const barbers = [{ id: 'b2', name: 'Budi', branch: 'csb', commission_rate: null }];
    const items = [
      {
        receipt_number: 'R02',
        barber_id: 'b2',
        tx_date: '2026-09-15',
        classification: CLASSIFICATION.NON_STOCK_SERVICE,
        quantity: 1,
        gross_amount: 80000,
        discount_amount: 0,
        net_amount: 80000,
        is_deleted: false,
      },
    ];

    const result = calculateRevenueSharingPreview({
      items,
      barbers,
      rateHistory: [],
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    const budi = result.barbers[0];
    assert.equal(budi.status, STATUS.MISSING_RATE);
    assert.equal(budi.commission_rate, null);
    assert.equal(budi.calculated_commission, null); // never default to 30% or 0
    assert.equal(budi.missing_rate_count, 1);
    assert.equal(result.summary.missing_rate_count, 1);
  });

  await t.test('D: historical effective rate => resolved based on tx_date, not current rate', () => {
    // Abdul: 2026-09-01 -> 30%, 2026-10-01 -> 35%
    const rateHistory = [
      { barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: '2026-09-30' },
      { barber_id: 'b1', rate: 0.35, effective_from: '2026-10-01', effective_to: null },
    ];

    const sepRes = resolveBarberRateForDate(rateHistory, null, '2026-09-15');
    assert.equal(sepRes.rate, 0.30);
    assert.equal(sepRes.rate_source, 'barber_commission_rates');
    assert.equal(sepRes.effective_from, '2026-09-01');

    const octRes = resolveBarberRateForDate(rateHistory, null, '2026-10-10');
    assert.equal(octRes.rate, 0.35);
    assert.equal(octRes.rate_source, 'barber_commission_rates');
    assert.equal(octRes.effective_from, '2026-10-01');
  });

  await t.test('E: future rate does not affect past transactions', () => {
    // Rate added today with future effective date 2026-11-01
    const rateHistory = [
      { barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: '2026-10-31' },
      { barber_id: 'b1', rate: 0.40, effective_from: '2026-11-01', effective_to: null },
    ];

    // Transaction on 2026-09-15 must use 30%, NOT 40%
    const pastRes = resolveBarberRateForDate(rateHistory, 0.40, '2026-09-15');
    assert.equal(pastRes.rate, 0.30);
    assert.notEqual(pastRes.rate, 0.40);
  });

  await t.test('F: overlapping rate validation in setBarberCommissionRate', async () => {
    const fakeDb = {
      rates: [
        { id: '1', barber_id: 'b1', rate: 0.30, effective_from: '2026-09-01', effective_to: null },
      ],
      from(table) {
        if (table === 'barber_commission_rates') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: fakeDb.rates, error: null }),
              }),
            }),
            update: (vals) => ({
              eq: async (col, id) => {
                const r = fakeDb.rates.find((x) => x.id === id);
                if (r) Object.assign(r, vals);
                return { data: r, error: null };
              },
            }),
            insert: (vals) => ({
              select: () => ({
                single: async () => {
                  const inserted = { id: 'new-id', ...vals };
                  fakeDb.rates.push(inserted);
                  return { data: inserted, error: null };
                },
              }),
            }),
          };
        }
        if (table === 'barbers') {
          return {
            update: () => ({ eq: async () => ({}) }),
          };
        }
      },
    };

    // Invalid rate out of bounds
    await assert.rejects(
      () => setBarberCommissionRate(fakeDb, { barberId: 'b1', rate: 1.5, effectiveFrom: '2026-10-01' }),
      /between 0.00 and 1.00/
    );

    // Negative rate
    await assert.rejects(
      () => setBarberCommissionRate(fakeDb, { barberId: 'b1', rate: -0.1, effectiveFrom: '2026-10-01' }),
      /between 0.00 and 1.00/
    );

    // Missing effectiveFrom
    await assert.rejects(
      () => setBarberCommissionRate(fakeDb, { barberId: 'b1', rate: 0.35, effectiveFrom: '' }),
      /effective_from must be a valid date/
    );

    // Setting new rate for 2026-10-01 closes previous active rate with effective_to = 2026-09-30
    await setBarberCommissionRate(fakeDb, {
      barberId: 'b1',
      rate: 0.35,
      effectiveFrom: '2026-10-01',
      createdBy: 'owner@redbox.id',
    });

    const oldRate = fakeDb.rates.find((r) => r.id === '1');
    assert.equal(oldRate.effective_to, '2026-09-30');
    const newRate = fakeDb.rates.find((r) => r.id === 'new-id');
    assert.equal(newRate.rate, 0.35);
    assert.equal(newRate.effective_from, '2026-10-01');
    assert.equal(newRate.effective_to, null);
  });

  await t.test('G: branch scope enforced in calculateRevenueSharingPreview', () => {
    const barbers = [
      { id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 },
      { id: 'b2', name: 'Budi', branch: 'csb', commission_rate: 0.30 },
    ];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 100000, discount_amount: 0, net_amount: 100000 },
      { receipt_number: 'R2', barber_id: 'b2', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 80000, discount_amount: 0, net_amount: 80000 },
    ];

    const bypassPreview = calculateRevenueSharingPreview({
      items,
      barbers,
      rateHistory: [],
      branchFilter: 'bypass',
    });

    assert.equal(bypassPreview.barbers.length, 1);
    assert.equal(bypassPreview.barbers[0].barber_id, 'b1');
    assert.equal(bypassPreview.barbers[0].outlet_slug, 'bypass');
  });

  await t.test('H: retail excluded from commissionable base', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 100000, discount_amount: 0, net_amount: 100000 },
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.STOCK_PRODUCT, quantity: 1, gross_amount: 50000, discount_amount: 0, net_amount: 50000 },
    ];

    const result = calculateRevenueSharingPreview({ items, barbers });
    const abdul = result.barbers[0];
    assert.equal(abdul.net_service_revenue, 100000); // Only 100k, retail 50k excluded
    assert.equal(abdul.calculated_commission, 30000);
  });

  await t.test('I: misc/F&B/membership excluded from commissionable base', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_MISC, quantity: 1, gross_amount: 30000, discount_amount: 0, net_amount: 30000 },
    ];

    const result = calculateRevenueSharingPreview({ items, barbers });
    const abdul = result.barbers[0];
    assert.equal(abdul.net_service_revenue, 85000);
    assert.equal(abdul.calculated_commission, 25500);
  });

  await t.test('J: review item excluded from commission and flags REVIEW_REQUIRED', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
      { receipt_number: 'R2', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.REVIEW_REQUIRED, quantity: 1, gross_amount: 50000, discount_amount: 0, net_amount: 50000 },
    ];

    const result = calculateRevenueSharingPreview({ items, barbers });
    const abdul = result.barbers[0];
    assert.equal(abdul.net_service_revenue, 85000); // 50k review item NOT included in service revenue
    assert.equal(abdul.review_required_count, 1);
    assert.equal(abdul.status, STATUS.REVIEW_REQUIRED);
    assert.equal(abdul.calculated_commission, 25500); // only calculates for the valid service
  });

  await t.test('K: discounted service uses net amount', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 100000, discount_amount: 20000, net_amount: 80000 },
    ];

    const result = calculateRevenueSharingPreview({ items, barbers });
    const abdul = result.barbers[0];
    assert.equal(abdul.gross_service_revenue, 100000);
    assert.equal(abdul.discount_total, 20000);
    assert.equal(abdul.net_service_revenue, 80000);
    assert.equal(abdul.calculated_commission, 24000); // 80k * 0.30, NOT 100k * 0.30
  });

  await t.test('L: multi-barber receipt correct attribution per barber', () => {
    const barbers = [
      { id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 },
      { id: 'b2', name: 'Ari', branch: 'bypass', commission_rate: 0.35 },
    ];
    // Single receipt with services by two different barbers
    const items = [
      { receipt_number: 'MULTI_01', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
      { receipt_number: 'MULTI_01', barber_id: 'b2', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 120000, discount_amount: 0, net_amount: 120000 },
    ];

    const result = calculateRevenueSharingPreview({ items, barbers });
    const abdul = result.barbers.find((b) => b.barber_id === 'b1');
    const ari = result.barbers.find((b) => b.barber_id === 'b2');

    assert.equal(abdul.net_service_revenue, 85000);
    assert.equal(abdul.calculated_commission, 25500); // 85k * 0.30

    assert.equal(ari.net_service_revenue, 120000);
    assert.equal(ari.calculated_commission, 42000); // 120k * 0.35

    assert.equal(result.summary.total_net_service_revenue, 205000);
    assert.equal(result.summary.total_estimated_commission, 67500);
  });

  await t.test('M: no legacy revenue_share dependency', () => {
    // Passing item objects without any revenue_share property
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-15', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
    ];
    assert.equal(items[0].revenue_share, undefined);

    const result = calculateRevenueSharingPreview({ items, barbers });
    assert.equal(result.barbers[0].calculated_commission, 25500);
  });

  await t.test('N: date range filter', () => {
    const barbers = [{ id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 }];
    // Item inside range
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-10', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
    ];

    const result = calculateRevenueSharingPreview({
      items,
      barbers,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-15',
    });

    assert.equal(result.barbers[0].date_from, '2026-09-01');
    assert.equal(result.barbers[0].date_to, '2026-09-15');
    assert.equal(result.barbers[0].net_service_revenue, 85000);
  });

  await t.test('O: barber filter', () => {
    const barbers = [
      { id: 'b1', name: 'Abdul', branch: 'bypass', commission_rate: 0.30 },
      { id: 'b2', name: 'Ari', branch: 'bypass', commission_rate: 0.35 },
    ];
    const items = [
      { receipt_number: 'R1', barber_id: 'b1', tx_date: '2026-09-10', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
      { receipt_number: 'R2', barber_id: 'b2', tx_date: '2026-09-10', classification: CLASSIFICATION.NON_STOCK_SERVICE, quantity: 1, gross_amount: 85000, discount_amount: 0, net_amount: 85000 },
    ];

    const result = calculateRevenueSharingPreview({
      items,
      barbers,
      barberFilter: 'b1',
    });

    assert.equal(result.barbers.length, 1);
    assert.equal(result.barbers[0].barber_id, 'b1');
  });

});
