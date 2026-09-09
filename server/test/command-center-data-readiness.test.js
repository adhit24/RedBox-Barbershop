'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes, getMokaFreshness } = require('../routes/adminCrmLegacy');
const { computeBranchCapacity } = require('../moka/slotEngine');

function buildAppWithAuth(supabase, authContext) {
  const app = express();
  const adminAuth = (req, res, next) => {
    req.adminAuth = authContext;
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

function makeChain(getData) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const data = await Promise.resolve(typeof getData === 'function' ? getData() : getData);
      return { data: Array.isArray(data) ? (data[0] || null) : (data || null), error: null };
    },
    then: (resolve, reject) => {
      return Promise.resolve(typeof getData === 'function' ? getData() : getData)
        .then(res => resolve({ data: res, error: null }))
        .catch(reject);
    },
  };
  return chain;
}

function createMockSupabase({
  outlets = [{ id: 'out-csb', name: 'CSB Mall', slug: 'csb', last_polled_at: new Date().toISOString() }],
  barbers = [
    { id: 'b1', name: 'Barber One', branch: 'csb', is_active: true, work_days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
    { id: 'b2', name: 'Barber Two', branch: 'csb', is_active: true, work_days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
    { id: 'b3', name: 'Barber Three', branch: 'csb', is_active: true, work_days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
  ],
  attendance = [
    { barber_id: 'b1', status: 'hadir' },
    { barber_id: 'b2', status: 'sakit' },
  ],
  shifts = [],
  workingHours = [],
  dateOverrides = [],
  bookings = [
    { id: 'bk1', status: 'confirmed', time: '10:00', barber_id: 'b1', name: 'Cust 1', wa: '081', service: 'Haircut', notes: null, type: 'outlet' },
    { id: 'bk2', status: 'cancelled', time: '11:00', barber_id: 'b1', name: 'Cust 2', wa: '082', service: 'Haircut', notes: null, type: 'outlet' },
    { id: 'bk3', status: 'pending', time: '14:00', barber_id: 'b3', name: 'Cust 3', wa: '083', service: 'Haircut', notes: null, type: 'outlet' },
  ],
  counts = [
    { barber_id: 'b1', count: 3 },
  ],
  schedules = [],
  posOrders = [],
} = {}) {
  return {
    from(table) {
      if (table === 'outlets') {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                const found = outlets.find(o => o[col] === val);
                return { data: found || null, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'barbers') {
        return makeChain(() => barbers.filter(b => b.is_active !== false));
      }
      if (table === 'barber_attendance') {
        return makeChain(() => attendance);
      }
      if (table === 'barber_shifts') {
        return makeChain(() => shifts);
      }
      if (table === 'barber_working_hours') {
        return makeChain(() => workingHours);
      }
      if (table === 'barber_date_overrides') {
        return makeChain(() => dateOverrides);
      }
      if (table === 'bookings') {
        return makeChain(() => bookings);
      }
      if (table === 'barber_daily_counts') {
        return makeChain(() => counts);
      }
      if (table === 'schedules') {
        return makeChain(() => schedules);
      }
      if (table === 'pos_orders') {
        return makeChain(() => posOrders);
      }
      return makeChain(() => []);
    },
  };
}

// ── 1. ROLE & BRANCH SCOPING (SECURITY) ───────────────────────────────────────

test('1. Owner role can query any branch successfully', async () => {
  const app = buildAppWithAuth(createMockSupabase(), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stats.hadir, 1);
    assert.equal(body.stats.tidak_hadir, 1);
    assert.equal(body.freshness.booking, 'live');
    assert.equal(body.freshness.moka.status, 'live');
  } finally {
    server.close();
  }
});

test('2. Missing branch parameter returns 400 Bad Request', async () => {
  const app = buildAppWithAuth(createMockSupabase(), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'branch query parameter required');
  } finally {
    server.close();
  }
});

test('3. Manager assigned to CSB can query CSB branch', async () => {
  const app = buildAppWithAuth(createMockSupabase(), {
    staffId: 'mgr-1',
    role: 'manager',
    branch: 'csb',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test('4. Manager assigned to CSB attempting to query Bypass fails closed with 403 Forbidden', async () => {
  const app = buildAppWithAuth(createMockSupabase(), {
    staffId: 'mgr-1',
    role: 'manager',
    branch: 'csb',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=bypass`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /Access to branch denied/i);
  } finally {
    server.close();
  }
});

test('5. Manager without assigned branch fails closed with 403 Forbidden', async () => {
  const app = buildAppWithAuth(createMockSupabase(), {
    staffId: 'mgr-2',
    role: 'manager',
    branch: null,
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /No assigned branch/i);
  } finally {
    server.close();
  }
});

// ── 2. BOOKINGS & CANCELLED EXCLUSION ─────────────────────────────────────────

test('6. Cancelled bookings are excluded from stats.booking_today', async () => {
  const app = buildAppWithAuth(createMockSupabase(), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    const body = await res.json();
    assert.equal(body.stats.booking_today, 2);
    assert.equal(body.stats.pending, 1);
  } finally {
    server.close();
  }
});

// ── 3. BARBER SHIFT / OFF-DAY ROSTER & OPERATIONAL STATUS ─────────────────────

test('7. Barber with is_off = true in barber_shifts derives status = off and creates no belum_check_in alert', async () => {
  const shifts = [
    { barber_id: 'b3', is_off: true, shift_date: '2026-09-09' },
  ];
  const app = buildAppWithAuth(createMockSupabase({ shifts }), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    const body = await res.json();
    const b3 = body.barbers.find(b => b.id === 'b3');
    assert.equal(b3.is_off, true);
    assert.equal(b3.operational_status, 'off');
    assert.equal(body.stats.off, 1);

    // Verify b3 is NOT counted in belum_check_in
    assert.equal(body.stats.belum_check_in, 0);

    // Verify b3 does NOT trigger a belum_check_in alert
    const b3Alert = body.alerts.find(a => a.message.includes('Barber Three belum check-in'));
    assert.equal(b3Alert, undefined);
  } finally {
    server.close();
  }
});

test('8. Barber on active home service trip derives operational_status = home_service', async () => {
  const homeBookings = [
    { id: 'bk-hs', status: 'departed', time: '13:00', barber_id: 'b1', name: 'VIP Cust', wa: '081', service: 'VIP', notes: 'Home service Cirebon', type: 'home_service' },
  ];
  const app = buildAppWithAuth(createMockSupabase({ bookings: homeBookings }), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    const body = await res.json();
    const b1 = body.barbers.find(b => b.id === 'b1');
    assert.equal(b1.operational_status, 'home_service');
    assert.equal(body.stats.home_service_active, 1);
  } finally {
    server.close();
  }
});

test('9. Alert engine differentiates all barbers OFF from barbers not checked in', async () => {
  const shifts = [
    { barber_id: 'b1', is_off: true },
    { barber_id: 'b2', is_off: true },
    { barber_id: 'b3', is_off: true },
  ];
  const app = buildAppWithAuth(createMockSupabase({ shifts, attendance: [] }), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    const body = await res.json();
    const allOffAlert = body.alerts.find(a => a.message.includes('semua barber berstatus OFF'));
    assert.ok(allOffAlert, 'Should trigger specific all-off alert when active bookings exist');
  } finally {
    server.close();
  }
});

// ── 4. CAPACITY & SLOT UTILIZATION ───────────────────────────────────────────

test('10. Capacity computes available, serving, home_service and slot utilization correctly', async () => {
  const supabase = createMockSupabase();
  const res = await computeBranchCapacity(supabase, {
    outletId: 'out-csb',
    date: '2026-09-09',
    barbers: [
      { id: 'b1', name: 'Barber 1', is_active: true, work_days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
      { id: 'b2', name: 'Barber 2', is_active: true, work_days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
    ],
    activeBookings: [
      { id: 'bk1', barber_id: 'b1', duration: '30 menit', time: '10:00' },
    ],
    homeServiceActive: [],
    barberOperationalStatusMap: {
      b1: 'serving',
      b2: 'available',
    },
  });

  assert.equal(res.status, 'ready');
  assert.equal(res.active_barbers, 2);
  assert.equal(res.available_barbers, 1);
  assert.equal(res.serving_barbers, 1);
  assert.equal(res.home_service_barbers, 0);
  assert.ok(res.total_slots_today > 0);
  assert.ok(res.occupied_slots >= 1);
  assert.equal(res.available_slots, res.total_slots_today - res.occupied_slots);
  assert.equal(res.utilization_percent, Math.round((res.occupied_slots / res.total_slots_today) * 100));
});

test('11. Home service barber is excluded from available barbers in capacity', async () => {
  const supabase = createMockSupabase();
  const res = await computeBranchCapacity(supabase, {
    outletId: 'out-csb',
    date: '2026-09-09',
    barbers: [
      { id: 'b1', name: 'Barber 1', is_active: true, work_days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
    ],
    activeBookings: [],
    homeServiceActive: [{ barber_id: 'b1' }],
    barberOperationalStatusMap: {
      b1: 'home_service',
    },
  });

  assert.equal(res.status, 'ready');
  assert.equal(res.available_barbers, 0);
  assert.equal(res.home_service_barbers, 1);
});

// ── 5. MOKA SYNC FRESHNESS INDICATOR ──────────────────────────────────────────

test('12. Moka freshness returns live for poll <= 10m', () => {
  const now = new Date('2026-09-09T12:05:00Z');
  const pollTime = '2026-09-09T12:00:00Z'; // 5 min ago
  const freshness = getMokaFreshness(pollTime, now);
  assert.equal(freshness.status, 'live');
  assert.equal(freshness.age_minutes, 5);
  assert.match(freshness.label, /LIVE/);
});

test('13. Moka freshness returns delayed for poll 11-30m', () => {
  const now = new Date('2026-09-09T12:20:00Z');
  const pollTime = '2026-09-09T12:00:00Z'; // 20 min ago
  const freshness = getMokaFreshness(pollTime, now);
  assert.equal(freshness.status, 'delayed');
  assert.equal(freshness.age_minutes, 20);
  assert.match(freshness.label, /DELAYED/);
});

test('14. Moka freshness returns stale for poll > 30m', () => {
  const now = new Date('2026-09-09T13:00:00Z');
  const pollTime = '2026-09-09T12:00:00Z'; // 60 min ago
  const freshness = getMokaFreshness(pollTime, now);
  assert.equal(freshness.status, 'stale');
  assert.equal(freshness.age_minutes, 60);
  assert.match(freshness.label, /STALE/);
});

test('15. Moka freshness returns unavailable for null / missing timestamp', () => {
  const freshness = getMokaFreshness(null);
  assert.equal(freshness.status, 'unavailable');
  assert.equal(freshness.last_updated_at, null);
  assert.equal(freshness.age_minutes, null);
  assert.equal(freshness.label, 'UNAVAILABLE');
});

// ── 6. PARTIAL DATA HANDLING ──────────────────────────────────────────────────

test('16. Incomplete capacity parameters return status = unavailable without failing the endpoint', async () => {
  const app = buildAppWithAuth(createMockSupabase({ outlets: [] }), {
    staffId: 'owner-1',
    role: 'owner',
    sessionVerified: true,
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/crm/command-center?branch=csb`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.capacity.status, 'unavailable');
    assert.equal(body.freshness.booking, 'live');
    assert.ok(Array.isArray(body.barbers));
  } finally {
    server.close();
  }
});
