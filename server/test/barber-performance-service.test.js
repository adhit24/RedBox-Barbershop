'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeBarberPerformance } = require('../crm/barberPerformanceService');

function visit(phone, name, date, overrides = {}) {
  return {
    phone, name, date,
    branch: 'csb', barberId: 'b1', barberName: 'Ubay', service: 'Haircut', source: 'booking',
    ...overrides,
  };
}

test('counts distinct customers served per barber, not total visits', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-02-01'),
    visit('6282', 'Sari', '2026-01-01'),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 2);
  assert.equal(ubay.completed_services, 3);
});

test('a barber with no repeat customers has a 0% repeat rate', () => {
  const rows = [visit('6281', 'Budi', '2026-01-01'), visit('6282', 'Sari', '2026-01-02')];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.repeat_rate, 0);
});

test('a barber where every customer returned has a 100% repeat rate', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01'),
    visit('6281', 'Budi', '2026-02-01'),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.repeat_rate, 100);
});

test('rows with no barberId are excluded from any barber\'s totals', () => {
  const rows = [visit('6281', 'Budi', '2026-01-01', { barberId: null, barberName: null })];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  assert.deepEqual(result.barbers, []);
});

test('branch is the barber\'s most-visited branch', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb' }),
    visit('6282', 'Sari', '2026-02-01', { branch: 'csb' }),
    visit('6283', 'Rian', '2026-03-01', { branch: 'bypass' }),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.branch, 'csb');
});

test('leaderboard is sorted by customers_served descending', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6282', 'Sari', '2026-01-02', { barberId: 'b1', barberName: 'Ubay' }),
    visit('6283', 'Rian', '2026-01-03', { barberId: 'b2', barberName: 'Dodi' }),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  assert.equal(result.barbers[0].barber_id, 'b1');
  assert.equal(result.barbers[1].barber_id, 'b2');
});

test('branch filter scopes barber performance to only that branch\'s visits', () => {
  const rows = [
    visit('6281', 'Budi', '2026-01-01', { branch: 'csb', barberId: 'b1', barberName: 'Ubay' }),
    visit('6282', 'Sari', '2026-02-01', { branch: 'bypass', barberId: 'b1', barberName: 'Ubay' }),
  ];
  const result = computeBarberPerformance(rows, { today: '2026-08-15', branch: 'csb' });
  const ubay = result.barbers.find(b => b.barber_id === 'b1');
  assert.equal(ubay.customers_served, 1);
});

test('an empty dataset returns an empty barbers list, not an error', () => {
  const result = computeBarberPerformance([], { today: '2026-08-15' });
  assert.deepEqual(result.barbers, []);
});

test('no commission or attendance field is ever present on a barber entry', () => {
  const rows = [visit('6281', 'Budi', '2026-01-01')];
  const result = computeBarberPerformance(rows, { today: '2026-08-15' });
  const allowedKeys = ['barber_id', 'name', 'branch', 'customers_served', 'completed_services', 'repeat_rate'];
  for (const key of Object.keys(result.barbers[0])) {
    assert.ok(allowedKeys.includes(key), `unexpected field on barber entry: ${key}`);
  }
});
