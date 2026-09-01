'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeCustomerSegments } = require('../crm/customerSegmentsService');

function visit(phone, name, date, overrides = {}) {
  return {
    phone,
    name,
    date,
    branch: 'csb',
    barberId: 'b1',
    barberName: 'Ubay',
    service: 'Haircut',
    source: 'booking',
    ...overrides,
  };
}

test('a customer with 1 completed visit is classified as new', () => {
  const result = computeCustomerSegments([visit('6281', 'Budi', '2026-08-01')], { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'new');
});

test('a customer with 2 completed visits is still classified as new', () => {
  const rows = [
    visit('6281', 'Budi', '2026-06-01'),
    visit('6281', 'Budi', '2026-08-01'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'new');
});

test('a customer with 3 completed visits is classified as repeat', () => {
  const rows = ['2026-01-01', '2026-04-01', '2026-08-01'].map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'repeat');
});

test('a customer with 9 completed visits is classified as repeat', () => {
  const dates = Array.from({ length: 9 }, (_, i) => `2026-0${(i % 8) + 1}-01`);
  const rows = dates.map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'repeat');
});

test('a customer with 10 completed visits is classified as loyal', () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, '0')}-01`);
  const rows = dates.map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].visit_count_tier, 'loyal');
});

test('a customer whose last visit is 60+ days ago is dormant, overriding visit-count tier in segments', () => {
  const rows = ['2025-01-01', '2025-02-01', '2025-03-01'].map(d => visit('6281', 'Budi', d));
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const dormantSegment = result.segments.find(s => s.key === 'dormant');
  assert.equal(dormantSegment.count, 1);
  assert.equal(result.customers.items[0].engagement_status, 'dormant');
  assert.equal(result.customers.items[0].visit_count_tier, 'repeat');
});

test('a customer whose last visit is within 60 days is not dormant', () => {
  const rows = [visit('6281', 'Budi', '2026-08-01')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].engagement_status, 'active');
  assert.equal(result.kpis.dormant_customers, 0);
  assert.equal(result.kpis.active_customers, 1);
});

test('identity linkage merges the same phone across bookings and transactions into one customer', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { source: 'booking' }),
    visit('6281', 'Budi', '2026-08-01', { source: 'transaction' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.total, 1);
  assert.equal(result.customers.items[0].total_visits, 2);
});

test('a booking with no phone falls back to a name-based grouping key', () => {
  const rows = [visit(null, 'Cash Customer', '2026-08-01')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.total, 1);
  assert.equal(result.customers.items[0].name, 'Cash Customer');
});

test('monthly trend: a first-ever visit in the month counts as new for that month', () => {
  const rows = [visit('6281', 'Budi', '2026-08-05')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const august = result.new_vs_repeat_trend.find(m => m.month === '2026-08');
  assert.equal(august.new, 1);
  assert.equal(august.repeat, 0);
});

test('monthly trend: a visit with an earlier first-visit date counts as repeat for that month', () => {
  const rows = [
    visit('6281', 'Budi', '2026-03-05'),
    visit('6281', 'Budi', '2026-08-05'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const august = result.new_vs_repeat_trend.find(m => m.month === '2026-08');
  assert.equal(august.new, 0);
  assert.equal(august.repeat, 1);
  const march = result.new_vs_repeat_trend.find(m => m.month === '2026-03');
  assert.equal(march.new, 1);
});

test('favorite branch is the customer\'s most-visited branch', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-02-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-03-01', { branch: 'bypass' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].favorite_branch, 'csb');
});

test('favorite barber is the customer\'s most-visited barber', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6281', 'Budi', '2026-02-01', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6281', 'Budi', '2026-03-01', { barberId: 'b2', barberName: 'Dodi' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.customers.items[0].favorite_barber, 'Ubay');
});

test('favorite_services leaderboard counts total visit volume per service across all customers', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { service: 'Haircut' }),
    visit('6282', 'Sari', '2026-01-02', { service: 'Haircut' }),
    visit('6283', 'Rian', '2026-01-03', { service: 'Hair Spa' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  const haircut = result.favorite_services.find(s => s.service_name === 'Haircut');
  assert.equal(haircut.count, 2);
});

test('avg visit interval pools individual gaps across eligible customers and averages them', () => {
  // Budi: 2026-01-01 -> 2026-01-11 (10 day gap) -> 2026-01-21 (10 day gap)
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-01-11'),
    visit('6281', 'Budi', '2026-01-21'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.kpis.avg_visit_interval_days, 10);
});

test('a customer with a single visit contributes no interval and does not skew the average to 0', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-01-11'),
    visit('6282', 'Sari', '2026-05-01'),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.kpis.avg_visit_interval_days, 10);
});

test('branch filter scopes every metric to only that branch\'s visit history', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-02-01', { branch: 'csb' }),
    visit('6281', 'Budi', '2026-03-01', { branch: 'bypass' }),
  ];
  const result = computeCustomerSegments(rows, { today: '2026-08-15', branch: 'bypass' });
  assert.equal(result.customers.items[0].total_visits, 1);
  assert.equal(result.customers.items[0].visit_count_tier, 'new');
});

test('pagination returns the requested page and an accurate total', () => {
  const rows = Array.from({ length: 5 }, (_, i) => visit(`628${i}`, `Customer ${i}`, '2026-08-01'));
  const result = computeCustomerSegments(rows, { today: '2026-08-15', limit: 2, offset: 2 });
  assert.equal(result.customers.total, 5);
  assert.equal(result.customers.items.length, 2);
  assert.equal(result.customers.limit, 2);
  assert.equal(result.customers.offset, 2);
});

test('an empty dataset returns zeroed KPIs and no customers, not an error', () => {
  const result = computeCustomerSegments([], { today: '2026-08-15' });
  assert.equal(result.customers.total, 0);
  assert.equal(result.kpis.active_customers, 0);
  assert.equal(result.kpis.avg_visit_interval_days, null);
  assert.deepEqual(result.customers.items, []);
});

test('data_coverage discloses the earliest and latest observed visit date', () => {
  const rows = [visit('6281', 'Budi', '2026-01-15'), visit('6282', 'Sari', '2026-08-01')];
  const result = computeCustomerSegments(rows, { today: '2026-08-15' });
  assert.equal(result.data_coverage.from, '2026-01-15');
  assert.equal(result.data_coverage.to, '2026-08-01');
});
