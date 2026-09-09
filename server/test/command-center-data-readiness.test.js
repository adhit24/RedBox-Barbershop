'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createAdminCrmRoutes } = require('../routes/adminCrmLegacy');

function buildAppWithAuth(supabase, authContext) {
  const app = express();
  const adminAuth = (req, res, next) => {
    req.adminAuth = authContext;
    next();
  };
  app.use('/api/admin/crm', createAdminCrmRoutes(supabase, adminAuth));
  return app;
}

function createMockSupabase({
  outlets = [{ id: 'out-csb', name: 'CSB Mall', slug: 'csb', last_polled_at: '2026-09-09T10:00:00Z' }],
  barbers = [
    { id: 'b1', name: 'Barber One', branch: 'csb', is_active: true },
    { id: 'b2', name: 'Barber Two', branch: 'csb', is_active: true },
    { id: 'b3', name: 'Barber Three', branch: 'csb', is_active: true },
  ],
  attendance = [
    { barber_id: 'b1', status: 'hadir' },
    { barber_id: 'b2', status: 'sakit' },
    // b3 has no attendance row (belum check in)
  ],
  bookings = [
    { id: 'bk1', status: 'confirmed', time: '10:00', barber_id: 'b1', name: 'Cust 1', wa: '081', service: 'Haircut', notes: null, type: 'outlet' },
    { id: 'bk2', status: 'cancelled', time: '11:00', barber_id: 'b1', name: 'Cust 2', wa: '082', service: 'Haircut', notes: null, type: 'outlet' },
    { id: 'bk3', status: 'pending', time: '14:00', barber_id: 'b3', name: 'Cust 3', wa: '083', service: 'Haircut', notes: null, type: 'outlet' },
  ],
  counts = [
    { barber_id: 'b1', count: 3 },
  ],
  schedules = [],
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
        return {
          select: () => ({
            eq: (col1, val1) => ({
              eq: (col2, val2) => {
                const filtered = barbers.filter(b => b[col1] === val1 && b[col2] === val2);
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'barber_attendance') {
        return {
          select: () => ({
            in: (col, vals) => ({
              eq: () => {
                const filtered = attendance.filter(a => vals.includes(a.barber_id));
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (col1, val1) => ({
              eq: (col2, val2) => {
                return Promise.resolve({ data: bookings, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'barber_daily_counts') {
        return {
          select: () => ({
            in: (col, vals) => ({
              eq: () => {
                const filtered = counts.filter(c => vals.includes(c.barber_id));
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'schedules') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => ({
                      order: async () => ({ data: schedules, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  };
}

// ── 1. ROLE & BRANCH SCOPING ──────────────────────────────────────────────────

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
    assert.equal(body.stats.belum_check_in, 1);
    assert.equal(body.freshness.booking, 'live');
    assert.equal(body.freshness.moka, '2026-09-09T10:00:00Z');
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

// ── 2. BOOKING CALCULATION & CANCELLED EXCLUSION ─────────────────────────────

test('6. Cancelled bookings are excluded from stats.booking_today', async () => {
  // 3 total bookings: 1 confirmed, 1 pending, 1 cancelled
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
    // active bookings = 2 (confirmed + pending), cancelled (1) must NOT be counted
    assert.equal(body.stats.booking_today, 2);
    assert.equal(body.stats.pending, 1);
  } finally {
    server.close();
  }
});

// ── 3. BARBER OPERATIONAL STATUS DERIVATION ──────────────────────────────────

test('7. Barber operational_status derives available, absent, and belum_check_in accurately', async () => {
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
    const b1 = body.barbers.find(b => b.id === 'b1');
    const b2 = body.barbers.find(b => b.id === 'b2');
    const b3 = body.barbers.find(b => b.id === 'b3');

    assert.equal(b1.attendance_status, 'hadir');
    assert.equal(b1.operational_status, 'available'); // Hadir, no active in_progress booking

    assert.equal(b2.attendance_status, 'sakit');
    assert.equal(b2.operational_status, 'absent'); // Sakit

    assert.equal(b3.attendance_status, null);
    assert.equal(b3.operational_status, 'belum_check_in'); // No attendance row
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
    assert.equal(b1.operational_status, 'home_service', 'Barber currently on home service must not show as available in branch');
    assert.equal(body.stats.home_service_active, 1);
  } finally {
    server.close();
  }
});
