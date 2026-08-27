'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCustomer360 } = require('../crm/customer360Service');
const { buildCustomerFactsContext } = require('../agents/reddy/customerFactsContext');

function createMockSupabase(fixtures = {}) {
  return {
    from(table) {
      const query = {
        rows: Array.isArray(fixtures[table]) ? [...fixtures[table]] : [],
        select() { return this; },
        or() { return this; },
        in(column, values) {
          this.rows = this.rows.filter(row => values.includes(row[column]));
          return this;
        },
        eq(column, value) {
          this.rows = this.rows.filter(row => row[column] === value);
          return this;
        },
        order(column, options = {}) {
          const direction = options.ascending === false ? -1 : 1;
          this.rows.sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * direction);
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: this.rows[0] || null, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const CUSTOMER = { id: 'customer-fixture', wa: '6281234567890', name: 'Fixture Customer' };
const BARBERS = [
  { id: 'barber-onoy', name: 'Onoy', is_active: true },
  { id: 'barber-abdul', name: 'Abdul Dul', is_active: true },
  { id: 'barber-budi', name: 'Budi', is_active: true },
];
const OUTLETS = [
  { id: 'outlet-bypass', name: 'RedBox Bypass', slug: 'bypass' },
  { id: 'outlet-csb', name: 'RedBox CSB', slug: 'csb' },
];
const SERVICES = [
  { id: 'service-grooming', name: 'Redbox Gentleman Grooming', is_active: true },
  { id: 'service-hair-spa', name: 'Hair Spa', is_active: true },
];

function schedule(id, barberId, startTime, overrides = {}) {
  return {
    id,
    customer_id: CUSTOMER.id,
    outlet_id: 'outlet-bypass',
    barber_id: barberId,
    service_id: 'service-grooming',
    service_name: 'Redbox Gentleman Grooming',
    start_time: startTime,
    status: 'completed',
    ...overrides,
  };
}

function transaction(id, scheduleId, createdAt, serviceNames, overrides = {}) {
  return {
    id,
    customer_id: CUSTOMER.id,
    outlet_id: 'outlet-bypass',
    schedule_id: scheduleId,
    created_at: createdAt,
    status: 'completed',
    transaction_items: serviceNames.map((service_name, index) => ({ id: `${id}-item-${index}`, service_name })),
    ...overrides,
  };
}

function booking(id, barberId, date, time, overrides = {}) {
  return {
    id,
    customer_id: CUSTOMER.id,
    location: 'RedBox Bypass',
    barber_id: barberId,
    service_id: 'service-grooming',
    service: 'Redbox Gentleman Grooming',
    date,
    time,
    status: 'done',
    ...overrides,
  };
}

async function customer360(overrides = {}) {
  const fixtures = {
    customers: [CUSTOMER],
    member_profiles: [],
    barbers: BARBERS,
    outlets: OUTLETS,
    services: SERVICES,
    schedules: [],
    transactions: [],
    bookings: [],
    ...overrides,
  };
  return getCustomer360(createMockSupabase(fixtures), { phone: CUSTOMER.wa });
}

test('C1 two genuine Onoy visits beat one Abdul Custom Amount + TIPS event', async () => {
  const schedules = [
    schedule('schedule-1', 'barber-onoy', '2026-08-01T10:00:00Z'),
    schedule('schedule-2', 'barber-onoy', '2026-08-11T10:00:00Z'),
    schedule('schedule-3', 'barber-abdul', '2026-08-12T10:00:00Z', { service_id: null, service_name: 'Custom Amount + TIPS' }),
  ];
  const result = await customer360({
    schedules,
    transactions: [
      transaction('tx-1', 'schedule-1', '2026-08-01T10:05:00Z', ['Redbox Gentleman Grooming']),
      transaction('tx-2', 'schedule-2', '2026-08-11T10:05:00Z', ['Redbox Gentleman Grooming']),
      transaction('tx-3', 'schedule-3', '2026-08-12T10:05:00Z', ['Custom Amount', 'TIPS']),
    ],
  });

  assert.equal(result.preferences.favorite_barber.value, 'Onoy');
  assert.equal(result.preferences.favorite_barber.visit_count, 2);
  assert.equal(result.preferences.favorite_barber.confidence, 'verified');
});

test('C2 TIPS-only event is not a completed service visit', async () => {
  const result = await customer360({
    schedules: [schedule('schedule-tip', 'barber-abdul', '2026-08-12T10:00:00Z', { service_id: null, service_name: 'TIPS' })],
    transactions: [transaction('tx-tip', 'schedule-tip', '2026-08-12T10:05:00Z', ['TIPS'])],
  });
  assert.equal(result.activity.last_visit, null);
  assert.equal(result.preferences.favorite_barber, null);
  assert.equal(result.data_quality.excluded_non_service_count, 2);
});

test('C3 Custom Amount-only event is not a completed service visit', async () => {
  const result = await customer360({
    schedules: [schedule('schedule-custom', 'barber-abdul', '2026-08-12T10:00:00Z', { service_id: null, service_name: 'Custom Amount' })],
    transactions: [transaction('tx-custom', 'schedule-custom', '2026-08-12T10:05:00Z', ['Custom Amount'])],
  });
  assert.equal(result.activity.last_visit, null);
  assert.equal(result.preferences.favorite_service, null);
});

test('C4 booking, schedule, and transaction for one appointment count once', async () => {
  const result = await customer360({
    schedules: [schedule('schedule-shared', 'barber-onoy', '2026-08-11T10:00:00Z')],
    bookings: [booking('booking-shared', 'barber-onoy', '2026-08-11', '10:00', { schedule_id: 'schedule-shared' })],
    transactions: [transaction('tx-shared', 'schedule-shared', '2026-08-11T10:04:00Z', ['Redbox Gentleman Grooming'])],
  });
  assert.equal(result.data_quality.visit_event_count, 3);
  assert.equal(result.data_quality.deduplicated_event_count, 1);
  assert.equal(result.preferences.favorite_barber.visit_count, 1);
});

test('C5 two legitimate visits on the same day remain distinct', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-morning', 'barber-onoy', '2026-08-11T09:00:00Z'),
      schedule('schedule-evening', 'barber-onoy', '2026-08-11T16:00:00Z'),
    ],
  });
  assert.equal(result.data_quality.deduplicated_event_count, 2);
  assert.equal(result.preferences.favorite_barber.visit_count, 2);
});

test('C6 favorite barber count tie is won by most recent valid visit', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-old', 'barber-budi', '2026-08-01T09:00:00Z'),
      schedule('schedule-new', 'barber-onoy', '2026-08-11T09:00:00Z'),
    ],
  });
  assert.equal(result.preferences.favorite_barber.value, 'Onoy');
});

test('C7 final preference tie uses stable deterministic barber ordering', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-budi', 'barber-budi', '2026-08-11T09:00:00Z'),
      schedule('schedule-onoy', 'barber-onoy', '2026-08-11T09:00:00Z'),
    ],
  });
  assert.equal(result.preferences.favorite_barber.value, 'Budi');
});

test('C8 verified behavioral favorite overrides conflicting stored fav_barber', async () => {
  const result = await customer360({
    member_profiles: [{ id: 'profile-fixture', phone: CUSTOMER.wa, fav_barber: 'Abdul Dul' }],
    schedules: [
      schedule('schedule-1', 'barber-onoy', '2026-08-01T10:00:00Z'),
      schedule('schedule-2', 'barber-onoy', '2026-08-11T10:00:00Z'),
    ],
  });
  assert.equal(result.preferences.favorite_barber.value, 'Onoy');
  assert.equal(result.preferences.favorite_barber.basis, 'completed_service_visit_frequency');
});

test('C9 stored fav_barber is fallback only when no valid visit history exists', async () => {
  const result = await customer360({
    member_profiles: [{ id: 'profile-fixture', phone: CUSTOMER.wa, fav_barber: 'Budi' }],
  });
  assert.deepEqual(result.preferences.favorite_barber, {
    value: 'Budi',
    basis: 'stored_profile_fallback',
    visit_count: 0,
    last_seen: null,
    confidence: 'unverified',
  });
});

test('C10 last_visit is the latest completed genuine service event', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-valid', 'barber-onoy', '2026-08-11T10:00:00Z'),
      schedule('schedule-tip', 'barber-abdul', '2026-08-12T10:00:00Z', { service_id: null, service_name: 'TIPS' }),
    ],
  });
  assert.equal(result.activity.last_visit, '2026-08-11');
  assert.equal(result.activity.last_visit_barber, 'Onoy');
});

test('C11 latest_booking remains latest booking-system record regardless of status', async () => {
  const result = await customer360({
    bookings: [
      booking('booking-done', 'barber-onoy', '2026-05-18', '10:00'),
      booking('booking-cancelled', 'barber-budi', '2026-05-19', '14:00', { status: 'cancelled' }),
    ],
  });
  assert.equal(result.activity.latest_booking_date, '2026-05-19');
  assert.equal(result.activity.latest_booking_time, '14:00');
  assert.equal(result.activity.latest_booking_status, 'cancelled');
});

test('C12 newer cancelled booking does not replace last completed visit', async () => {
  const result = await customer360({
    schedules: [schedule('schedule-valid', 'barber-onoy', '2026-08-11T10:00:00Z')],
    bookings: [booking('booking-cancelled', 'barber-budi', '2026-08-20', '14:00', { status: 'cancelled' })],
  });
  assert.equal(result.activity.last_visit, '2026-08-11');
  assert.equal(result.activity.latest_booking_date, '2026-08-20');
  assert.equal(result.activity.latest_booking_status, 'cancelled');
});

function trustedContext(facts) {
  return buildCustomerFactsContext({
    status: 'success',
    customer_found: true,
    facts,
    unknown_fields: [],
  });
}

test('C13 Reddy maps potong terakhir to completed last_visit', () => {
  const context = trustedContext({ last_visit: '2026-08-11', latest_booking_date: '2026-08-20' });
  assert.match(context, /terakhir (?:aku )?potong.*last_visit/i);
  assert.match(context, /Kunjungan selesai terakhir/i);
});

test('C14 Reddy maps booking time question to latest_booking', () => {
  const context = trustedContext({ latest_booking_date: '2026-05-19', latest_booking_time: '14:00' });
  assert.match(context, /booking terakhir.*latest_booking/i);
  assert.match(context, /sistem booking Redbox/i);
});

test('C15 cancelled latest booking must never be described as last visit', () => {
  const context = trustedContext({ last_visit: '2026-08-11', latest_booking_date: '2026-05-19', latest_booking_status: 'cancelled' });
  assert.match(context, /status.*cancelled.*dibatalkan/i);
  assert.match(context, /DO NOT call.*kunjungan terakhir/i);
});

test('C16 combined last visit and favorite barber facts are internally consistent', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-1', 'barber-onoy', '2026-08-01T10:00:00Z'),
      schedule('schedule-2', 'barber-onoy', '2026-08-11T10:00:00Z'),
    ],
  });
  assert.equal(result.activity.last_visit_barber, 'Onoy');
  assert.equal(result.preferences.favorite_barber.value, 'Onoy');
});

test('C17 favorite service ignores TIPS and Custom Amount rows', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-valid', 'barber-onoy', '2026-08-11T10:00:00Z'),
      schedule('schedule-tip', 'barber-abdul', '2026-08-12T10:00:00Z', { service_id: null, service_name: 'Custom Amount + TIPS' }),
    ],
    transactions: [
      transaction('tx-valid', 'schedule-valid', '2026-08-11T10:05:00Z', ['Redbox Gentleman Grooming', 'TIPS']),
      transaction('tx-tip', 'schedule-tip', '2026-08-12T10:05:00Z', ['Custom Amount', 'TIPS']),
    ],
  });
  assert.equal(result.preferences.favorite_service.value, 'Redbox Gentleman Grooming');
});

test('C18 favorite branch is not double-counted by duplicate booking and transaction rows', async () => {
  const result = await customer360({
    schedules: [
      schedule('schedule-bypass', 'barber-onoy', '2026-08-01T10:00:00Z'),
      schedule('schedule-csb', 'barber-budi', '2026-08-11T10:00:00Z', { outlet_id: 'outlet-csb', service_id: 'service-hair-spa', service_name: 'Hair Spa' }),
    ],
    bookings: [booking('booking-bypass', 'barber-onoy', '2026-08-01', '10:00', { schedule_id: 'schedule-bypass' })],
    transactions: [transaction('tx-bypass', 'schedule-bypass', '2026-08-01T10:05:00Z', ['Redbox Gentleman Grooming'])],
  });
  assert.equal(result.preferences.favorite_branch.value, 'RedBox CSB');
});

function legacyBranchFallbackFixture(bookingOverrides = {}) {
  return customer360({
    schedules: [schedule('schedule-legacy', 'barber-onoy', '2026-08-11T10:00:00Z')],
    bookings: [booking('booking-legacy', 'barber-onoy', '2026-08-11', '10:10', {
      location: 'bypass',
      ...bookingOverrides,
    })],
  });
}

test('B1 legacy booking slug and schedule outlet label deduplicate through canonical branch identity', async () => {
  const result = await legacyBranchFallbackFixture();
  assert.equal(result.data_quality.visit_event_count, 2);
  assert.equal(result.data_quality.deduplicated_event_count, 1);
});

test('B2 favorite branch groups slug and display label as one canonical branch', async () => {
  const result = await legacyBranchFallbackFixture();
  assert.deepEqual(result.preferences.favorite_branch, {
    value: 'RedBox Bypass',
    basis: 'completed_service_visit_frequency',
    visit_count: 1,
    last_seen: '2026-08-11',
    confidence: 'verified',
  });
});

test('B3 last_visit_branch remains customer-readable after canonical branch dedup', async () => {
  const result = await legacyBranchFallbackFixture();
  assert.equal(result.activity.last_visit_branch, 'RedBox Bypass');
  assert.equal(result.activity.last_visit_event.branch, 'RedBox Bypass');
});

test('B4 different canonical branches never fallback-deduplicate', async () => {
  const result = await legacyBranchFallbackFixture({ location: 'csb' });
  assert.equal(result.data_quality.visit_event_count, 2);
  assert.equal(result.data_quality.deduplicated_event_count, 2);
});

test('B5 explicit schedule_id dedup remains authoritative', async () => {
  const result = await legacyBranchFallbackFixture({
    location: 'csb',
    schedule_id: 'schedule-legacy',
  });
  assert.equal(result.data_quality.visit_event_count, 2);
  assert.equal(result.data_quality.deduplicated_event_count, 1);
  assert.equal(result.activity.last_visit_branch, 'RedBox Bypass');
});

test('B6 production-style booking location slug resolves to canonical display branch', async () => {
  const result = await customer360({
    bookings: [booking('booking-production-shape', 'barber-onoy', '2026-08-11', '10:00', { location: 'bypass' })],
  });
  assert.equal(result.activity.last_visit_branch, 'RedBox Bypass');
  assert.equal(result.preferences.favorite_branch.value, 'RedBox Bypass');
});
