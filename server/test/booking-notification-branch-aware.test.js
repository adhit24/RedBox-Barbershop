'use strict';

process.env.WA_ADMIN_NUMBER = '628999000111';
process.env.FONNTE_TOKEN = 'T_BYPASS';
process.env.FONNTE_TOKEN_SUMBER = 'T_SUMBER';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  dispatchBookingNotifications, notifyBarberOutletBooking,
} = require('../services/bookingNotificationOrchestrator');

const ADMIN = '628999000111';
const CUSTOMER = '6281300000001';
const PRIMA_PHONE = '6281234500001';
const OPAN_PHONE = '6281234500002';

function installFetch(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const call = { token: opts.headers.Authorization, target: body.target, message: body.message };
    calls.push(call);
    const payload = handler ? handler(call) : { status: true, id: ['m'] };
    return { ok: true, text: async () => JSON.stringify(payload) };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function fakeSupabase({ outboxBroken = false } = {}) {
  const barbers = [
    { id: 'sumber-prima', name: 'Prima', phone: '081234500001', is_active: true },
    { id: 'sumber-opan', name: 'Opan', phone: '+6281234500002', is_active: true },
  ];
  const outbox = [];
  return {
    from(table) {
      if (table === 'barbers') {
        return { select() { return { in: async (_c, ids) => ({ data: barbers.filter(b => ids.includes(b.id)), error: null }) }; } };
      }
      if (table === 'booking_notification_outbox') {
        if (outboxBroken) return { insert: async () => ({ error: { code: '57P01', message: 'db down' } }), update() { throw new Error('db down'); } };
        return {
          insert: async (row) => {
            if (outbox.some(r => r.booking_id === row.booking_id && r.kind === row.kind)) return { error: { code: '23505' } };
            outbox.push({ ...row }); return { error: null };
          },
          update(patch) {
            const filters = {};
            const q = {
              eq(c, v) { filters[c] = v; return q; }, select() { return q; },
              maybeSingle: async () => apply(true),
              then(res, rej) { return Promise.resolve(apply(false)).then(res, rej); },
            };
            const apply = (single) => {
              const hit = outbox.filter(r => Object.entries(filters).every(([k, v]) => r[k] === v));
              hit.forEach(r => Object.assign(r, patch));
              return single ? { data: hit[0] ? { id: 1 } : null, error: null } : { error: null };
            };
            return q;
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  };
}

// legacy-path helper reads: from('barbers').select().eq().single()
function legacyBarberSb(phone = '081234500001') {
  return { from() { return { select() { return { eq() { return { single: async () => ({ data: { name: 'Prima', phone }, error: null }) }; } }; } }; } };
}

const member = (over) => ({
  wa: CUSTOMER, service: 'Hair Curly', duration: '90', date: '2026-09-25', time: '13:00',
  location: 'sumber', status: 'confirmed', ...over,
});
const group = () => ([
  member({ id: 'b-alam', name: 'Alam', barber_id: 'sumber-prima', price: 310000 }),
  member({ id: 'b-thaariq', name: 'Thaariq', barber_id: 'sumber-opan', price: 310000 }),
]);
const sumberBooking = () => ({
  id: 'b1', name: 'Alam', service: 'Hair Curly', price: 310000, date: '2026-09-25', time: '13:00',
  location: 'sumber', barber_id: 'sumber-prima',
});

async function run(bookings, { sb, includeAdmin = true, handler } = {}) {
  const f = installFetch(handler);
  const logged = [];
  try {
    const res = await dispatchBookingNotifications({
      supabase: sb || fakeSupabase(), bookings, groupId: 'g-1', correlationId: 'c-1', includeAdmin,
      deps: { logEvent: async (e) => { logged.push(e); } },
    });
    return { ...res, calls: f.calls, logged };
  } finally { f.restore(); }
}
const to = (calls, target) => calls.filter(c => c.target === target);

test('T1 single booking Sumber: barber notification uses Sumber token', async () => {
  const { calls } = await run([group()[0]], { includeAdmin: false });
  const c = to(calls, PRIMA_PHONE);
  assert.equal(c.length, 1);
  assert.equal(c[0].token, 'T_SUMBER');
});

test('T2 group Sumber: Prima and Opan both use Sumber token', async () => {
  const { calls } = await run(group());
  assert.equal(to(calls, PRIMA_PHONE)[0].token, 'T_SUMBER');
  assert.equal(to(calls, OPAN_PHONE)[0].token, 'T_SUMBER');
});

test('T3/T4 resend-notif and pending->confirmed share the helper: Sumber token, barbers.phone', async () => {
  const f = installFetch();
  try {
    await notifyBarberOutletBooking(legacyBarberSb(), sumberBooking());
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].token, 'T_SUMBER');
    assert.equal(f.calls[0].target, PRIMA_PHONE);
  } finally { f.restore(); }

  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const resendStart = src.indexOf("app.post('/api/bookings/:id/resend-notif'");
  const resend = src.slice(resendStart, src.indexOf("app.post('/api/booking-status'"));
  assert.match(resend, /_notifyBarberOutletBookingSupabase\(/);
  const statusStart = src.indexOf("app.post('/api/booking-status'");
  const status = src.slice(statusStart, statusStart + 6000);
  assert.match(status, /status === 'confirmed' && cur\?\.status !== 'confirmed' && data\?\.barber_id[\s\S]*_notifyBarberOutletBookingSupabase\(/);
  // the shared wrapper delegates to the strict helper, not the old failover sender
  assert.match(src, /notifyBarberOutletBookingLegacy\(supabase, bookingData/);

  // no barber-facing sender may use the failover path
  const wsrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'waNotification.js'), 'utf8');
  for (const fn of ['notifyBarberNewHomeServiceJob', 'notifyBarberHomeServiceReminderH1', 'notifyBarberNewOutletBooking', 'notifyBarberBookingAssignment']) {
    const from = wsrc.indexOf('async function ' + fn);
    const body = wsrc.slice(from, wsrc.indexOf('\n}', wsrc.indexOf('return ', from)));
    assert.ok(from > 0, fn);
    assert.doesNotMatch(body, /sendOperationalNotification/, fn);
  }
});

test('T5 Sumber token missing: every barber path FAILS with branch_token_missing, nothing sent via Bypass', async () => {
  const saved = process.env.FONNTE_TOKEN_SUMBER;
  delete process.env.FONNTE_TOKEN_SUMBER;
  const f = installFetch();
  try {
    await assert.rejects(() => notifyBarberOutletBooking(legacyBarberSb(), sumberBooking()), /branch_token_missing/);
    const r = await dispatchBookingNotifications({
      supabase: fakeSupabase(), bookings: group(), groupId: 'g', includeAdmin: false,
      deps: { logEvent: async () => {} },
    });
    for (const d of r.deliveries.filter(x => x.recipient_role === 'barber')) {
      assert.equal(d.status, 'failed');
      assert.match(d.reason, /branch_token_missing/);
    }
    assert.equal(f.calls.length, 0, 'no request may reach Fonnte (esp. with the Bypass token)');
  } finally { f.restore(); process.env.FONNTE_TOKEN_SUMBER = saved; }
});

test('T6 barber destination is barbers.phone (canonical), never WA_ADMIN_NUMBER; missing phone sends nothing', async () => {
  const f = installFetch();
  try {
    await notifyBarberOutletBooking(legacyBarberSb('+62 812-3450-0001'), sumberBooking());
    assert.equal(f.calls[0].target, PRIMA_PHONE);
    assert.notEqual(f.calls[0].target, ADMIN);
    const r = await notifyBarberOutletBooking(legacyBarberSb(''), sumberBooking());
    assert.deepEqual([r.skipped, r.reason], [true, 'barber_phone_missing']);
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

test('T7 admin notice is classified separately (global admin) from barber assignment', async () => {
  const { deliveries } = await run(group());
  const admin = deliveries.find(d => d.notification_type === 'booking_admin_notice');
  assert.equal(admin.recipient_role, 'branch_admin');
  assert.equal(admin.recipient_scope, 'global_admin'); // one WA_ADMIN_NUMBER, not per-branch
  assert.ok(deliveries.filter(d => d.notification_type === 'booking_barber_assignment').every(d => d.recipient_role === 'barber'));
});

test('T8 admin failover to Bypass is recorded: requested_branch, actual_device, failover=true; barbers unaffected', async () => {
  const handler = (c) => (c.token === 'T_SUMBER' && c.target === ADMIN)
    ? { status: false, reason: 'disconnected device' } : { status: true, id: ['m'] };
  const { deliveries, logged, calls } = await run(group(), { handler });
  const admin = deliveries.find(d => d.recipient_role === 'branch_admin');
  assert.equal(admin.status, 'sent');
  assert.equal(admin.requested_branch, 'sumber');
  assert.equal(admin.actual_device, 'bypass');
  assert.equal(admin.failover, true);
  const ev = logged.find(e => e.metadata.recipient_role === 'branch_admin');
  assert.equal(ev.metadata.failover, true);
  assert.equal(ev.metadata.actual_device, 'bypass');
  assert.equal(ev.severity, 'WARNING');
  assert.ok(calls.filter(c => c.target === PRIMA_PHONE || c.target === OPAN_PHONE).every(c => c.token === 'T_SUMBER'));
  // a normal (no failover) admin send is reported as such
  const normal = await run(group());
  const n = normal.deliveries.find(d => d.recipient_role === 'branch_admin');
  assert.equal(n.failover, false); assert.equal(n.actual_device, 'sumber');
});

test('T9 outbox unavailable: deliveries still go out, telemetry idempotency_mode=degraded', async () => {
  const r = await run(group(), { sb: fakeSupabase({ outboxBroken: true }) });
  assert.equal(to(r.calls, PRIMA_PHONE).length, 1);
  assert.equal(to(r.calls, OPAN_PHONE).length, 1);
  assert.equal(to(r.calls, CUSTOMER).length, 1);
  assert.ok(r.deliveries.every(d => d.idempotency_mode === 'degraded' && d.warning === 'notification_outbox_unavailable'));
  assert.ok(r.logged.every(e => e.metadata.idempotency_mode === 'degraded' && e.severity === 'WARNING' || e.severity === 'WARNING'));
  const ok = await run(group());
  assert.ok(ok.deliveries.every(d => d.idempotency_mode === 'normal'));
  assert.ok(ok.logged.every(e => e.metadata.idempotency_mode === 'normal'));
});

test('T10 Sumber group: customer 1, Prima 1, Opan 1, admin notice separate, no barber notice to admin', async () => {
  const { calls, deliveries } = await run(group());
  assert.equal(to(calls, CUSTOMER).length, 1);
  assert.equal(to(calls, PRIMA_PHONE).length, 1);
  assert.equal(to(calls, OPAN_PHONE).length, 1);
  assert.equal(to(calls, ADMIN).length, 1);
  assert.doesNotMatch(to(calls, ADMIN)[0].message, /Kamu terpilih sebagai kapster/);
  assert.equal(deliveries.filter(d => d.notification_type === 'booking_admin_notice').length, 1);
  assert.ok(calls.every(c => c.token === 'T_SUMBER'));
});
