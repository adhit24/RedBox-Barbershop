'use strict';

process.env.WA_ADMIN_NUMBER = '628999000111';
process.env.FONNTE_TOKEN = 'T_BYPASS';
process.env.FONNTE_TOKEN_SUMBER = 'T_SUMBER';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { dispatchBookingNotifications, normalizeBarberPhone } = require('../services/bookingNotificationOrchestrator');

const ADMIN = '628999000111';
const CUSTOMER = '6281300000001';
const PRIMA_PHONE = '6281234500001';
const OPAN_PHONE = '6281234500002';

// ── fakes ────────────────────────────────────────────────────
function installFetch({ failTargets = [] } = {}) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ token: opts.headers.Authorization, target: body.target, message: body.message });
    const fail = failTargets.includes(body.target);
    const payload = fail ? { status: false, reason: 'simulated provider failure' } : { status: true, id: ['m1'] };
    return { ok: true, text: async () => JSON.stringify(payload) };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function fakeSupabase({ barbers }) {
  const outbox = [];
  const events = [];
  return {
    outbox, events,
    from(table) {
      if (table === 'barbers') {
        return { select() { return { in: async (_c, ids) => ({ data: barbers.filter(b => ids.includes(b.id)), error: null }) }; } };
      }
      if (table === 'booking_notification_outbox') {
        return {
          insert: async (row) => {
            if (outbox.some(r => r.booking_id === row.booking_id && r.kind === row.kind)) return { error: { code: '23505' } };
            outbox.push({ ...row }); return { error: null };
          },
          update(patch) {
            const filters = {};
            const q = {
              eq(c, v) { filters[c] = v; return q; },
              select() { return q; },
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
      return { insert: async (row) => { events.push(row); return { error: null }; } };
    },
  };
}

const barbers = () => ([
  { id: 'sumber-prima', name: 'Prima', phone: '081234500001', is_active: true },
  { id: 'sumber-opan', name: 'Opan', phone: '+6281234500002', is_active: true },
]);

const member = (over) => ({
  wa: CUSTOMER, service: 'Hair Curly', duration: '90', date: '2026-09-25', time: '13:00',
  location: 'sumber', status: 'confirmed', ...over,
});
const group = () => ([
  member({ id: 'b-alam', name: 'Alam', barber_id: 'sumber-prima', price: 310000 }),
  member({ id: 'b-thaariq', name: 'Thaariq', barber_id: 'sumber-opan', price: 310000 }),
]);

async function run(bookings, { sb, deps, failTargets, includeAdmin = true } = {}) {
  const f = installFetch({ failTargets });
  const supabase = sb || fakeSupabase({ barbers: barbers() });
  const logged = [];
  try {
    const res = await dispatchBookingNotifications({
      supabase, bookings, groupId: 'g-1', correlationId: 'corr-1', includeAdmin,
      deps: { logEvent: async (e) => { logged.push(e); }, ...(deps || {}) },
    });
    return { ...res, calls: f.calls, supabase, logged };
  } finally { f.restore(); }
}
const to = (calls, target) => calls.filter(c => c.target === target);

// ── N1/N2 single booking ─────────────────────────────────────
test('N1 single booking: exactly 1 customer confirmation attempt', async () => {
  let n = 0;
  const { deliveries } = await run([group()[0]], {
    includeAdmin: false,
    deps: { sendCustomerSingle: async () => { n++; return { sent: true, providerResponse: { status: true } }; } },
  });
  assert.equal(n, 1);
  assert.equal(deliveries.filter(d => d.recipient_role === 'customer' && d.status === 'sent').length, 1);
});

test('N2 single booking: 1 barber assignment to barbers.phone, never admin', async () => {
  const { calls } = await run([group()[0]], { includeAdmin: false });
  assert.equal(to(calls, PRIMA_PHONE).length, 1);
  assert.equal(to(calls, ADMIN).length, 0);
});

// ── N3/N4/N11/N14 group ──────────────────────────────────────
test('N3 group of 2: customer x1, Prima x1, Opan x1', async () => {
  const { calls } = await run(group());
  assert.equal(to(calls, CUSTOMER).length, 1);
  assert.equal(to(calls, PRIMA_PHONE).length, 1);
  assert.equal(to(calls, OPAN_PHONE).length, 1);
});

test('N4 Prima only sees Alam, Opan only sees Thaariq, no customer phone leaked', async () => {
  const { calls } = await run(group());
  const prima = to(calls, PRIMA_PHONE)[0].message;
  const opan = to(calls, OPAN_PHONE)[0].message;
  assert.match(prima, /Alam/); assert.doesNotMatch(prima, /Thaariq/);
  assert.match(opan, /Thaariq/); assert.doesNotMatch(opan, /Alam/);
  assert.match(prima, /Hair Curly/); assert.match(prima, /13:00/); assert.match(prima, /90 menit/);
  assert.match(prima, /REDBOX SUMBER/); assert.match(prima, /Jumat/);
  assert.ok(!prima.includes(CUSTOMER) && !opan.includes(CUSTOMER));
});

test('N11 consolidated customer confirmation lists both members', async () => {
  const { calls } = await run(group());
  const msg = to(calls, CUSTOMER)[0].message;
  for (const s of ['Alam', 'Thaariq', 'Prima', 'Opan', 'Hair Curly', '13:00', 'Sumber', 'CONFIRMED', 'Jumat']) {
    assert.ok(msg.includes(s), `missing ${s}`);
  }
});

test('N14 one main contact -> exactly one customer confirmation', async () => {
  const { deliveries } = await run(group());
  assert.equal(deliveries.filter(d => d.recipient_role === 'customer').length, 1);
});

// ── N5 token/device ──────────────────────────────────────────
test('N5 Sumber booking uses the Sumber device token for every send', async () => {
  const { calls } = await run(group());
  assert.ok(calls.length >= 4);
  assert.ok(calls.every(c => c.token === 'T_SUMBER'), JSON.stringify(calls.map(c => c.token)));
});

test('N5b missing Sumber token: barber/customer NOT silently sent via Bypass', async () => {
  const saved = process.env.FONNTE_TOKEN_SUMBER;
  delete process.env.FONNTE_TOKEN_SUMBER;
  try {
    const { calls, deliveries } = await run(group(), { includeAdmin: false });
    assert.equal(calls.length, 0);
    assert.ok(deliveries.every(d => d.status === 'failed' && /not configured for branch: sumber/.test(d.reason)));
  } finally { process.env.FONNTE_TOKEN_SUMBER = saved; }
});

// ── N6/N7/N15 independence ───────────────────────────────────
test('N6 customer failure does not block barbers', async () => {
  const { calls, deliveries } = await run(group(), { failTargets: [CUSTOMER] });
  assert.equal(to(calls, PRIMA_PHONE).length, 1);
  assert.equal(to(calls, OPAN_PHONE).length, 1);
  assert.equal(deliveries.find(d => d.recipient_role === 'customer').status, 'failed');
});

test('N7 Prima failure does not block Opan or customer', async () => {
  const { calls, deliveries } = await run(group(), { failTargets: [PRIMA_PHONE] });
  assert.equal(to(calls, OPAN_PHONE).length, 1);
  assert.equal(to(calls, CUSTOMER).length, 1);
  const prima = deliveries.find(d => d.barber_id === 'sumber-prima');
  const opan = deliveries.find(d => d.barber_id === 'sumber-opan');
  assert.equal(prima.status, 'failed'); assert.equal(opan.status, 'sent');
});

test('N15 admin notice is separate, never replaces others, and its failure blocks nothing', async () => {
  const ok = await run(group());
  const adminLeg = ok.deliveries.find(d => d.recipient_role === 'branch_admin');
  assert.equal(adminLeg.notification_type, 'booking_admin_notice');
  assert.equal(to(ok.calls, ADMIN).length, 1);
  assert.equal(ok.deliveries.filter(d => d.recipient_role === 'barber' && d.status === 'sent').length, 2);

  const bad = await run(group(), { failTargets: [ADMIN] });
  assert.equal(bad.deliveries.find(d => d.recipient_role === 'branch_admin').status, 'failed');
  assert.equal(to(bad.calls, PRIMA_PHONE).length, 1);
  assert.equal(to(bad.calls, OPAN_PHONE).length, 1);
  assert.equal(to(bad.calls, CUSTOMER).length, 1);
});

// ── N8/N9/N13 no admin substitution ──────────────────────────
test('N8 barber phone missing: skipped with reason, others proceed, not redirected to admin', async () => {
  const b = barbers(); b[0].phone = '';
  const { calls, deliveries } = await run(group(), { sb: fakeSupabase({ barbers: b }) });
  const prima = deliveries.find(d => d.barber_id === 'sumber-prima');
  assert.equal(prima.status, 'skipped'); assert.equal(prima.reason, 'barber_phone_missing');
  assert.equal(to(calls, CUSTOMER).length, 1);
  assert.equal(to(calls, OPAN_PHONE).length, 1);
  assert.ok(to(calls, ADMIN).every(c => !c.message.includes('BOOKING BARU —')), 'assignment leaked to admin');
});

test('N9 booking_barber_assignment destination is never the admin number', async () => {
  const b = barbers(); b[1].phone = 'abc';
  const { calls } = await run(group(), { sb: fakeSupabase({ barbers: b }) });
  for (const c of to(calls, ADMIN)) assert.doesNotMatch(c.message, /Kamu terpilih sebagai kapster/);
  const assignmentTargets = calls.filter(c => /Kamu terpilih sebagai kapster/.test(c.message)).map(c => c.target);
  assert.deepEqual(assignmentTargets, [PRIMA_PHONE]);
});

test('N13 unknown barber_id / inactive barber: failure recorded, no admin substitution', async () => {
  const bookings = group(); bookings[1].barber_id = 'sumber-ghost';
  const b = barbers(); b[0].is_active = false;
  const { calls, deliveries } = await run(bookings, { sb: fakeSupabase({ barbers: b }) });
  assert.equal(deliveries.find(d => d.barber_id === 'sumber-ghost').reason, 'barber_not_found');
  assert.equal(deliveries.find(d => d.barber_id === 'sumber-prima').reason, 'barber_inactive');
  assert.equal(calls.filter(c => /Kamu terpilih sebagai kapster/.test(c.message)).length, 0);
});

// ── N10 idempotency ──────────────────────────────────────────
test('N10 re-running orchestration with same booking ids sends no duplicates', async () => {
  const sb = fakeSupabase({ barbers: barbers() });
  const first = await run(group(), { sb });
  const second = await run(group(), { sb });
  assert.equal(first.calls.length, 4);
  assert.equal(second.calls.length, 0);
  assert.ok(second.deliveries.every(d => d.status === 'duplicate'));
});

test('N10b a previously failed delivery is retried, delivered ones are not', async () => {
  const sb = fakeSupabase({ barbers: barbers() });
  await run(group(), { sb, failTargets: [OPAN_PHONE] });
  const retry = await run(group(), { sb });
  assert.equal(to(retry.calls, OPAN_PHONE).length, 1);
  assert.equal(to(retry.calls, PRIMA_PHONE).length, 0);
  assert.equal(to(retry.calls, CUSTOMER).length, 0);
});

// ── N12 normalization ────────────────────────────────────────
test('N12 barber phone 08xxx / 628xxx / +628xxx all reach Fonnte as canonical 628xxx', async () => {
  for (const raw of ['081234500001', '6281234500001', '+6281234500001', '0812-3450-0001']) {
    const b = [{ id: 'sumber-prima', name: 'Prima', phone: raw, is_active: true }];
    const { calls } = await run([group()[0]], { sb: fakeSupabase({ barbers: b }), includeAdmin: false });
    assert.equal(to(calls, '6281234500001').length, 1, raw);
  }
  assert.equal(normalizeBarberPhone('12345'), null);
  assert.equal(normalizeBarberPhone(''), null);
});

// ── telemetry ────────────────────────────────────────────────
test('telemetry: each delivery logged with role, type, barber_id, status; phones masked', async () => {
  const { logged } = await run(group(), { failTargets: [OPAN_PHONE] });
  const opan = logged.find(e => e.barberId === 'sumber-opan');
  assert.equal(opan.eventName, 'booking_notification_failed');
  assert.equal(opan.metadata.recipient_role, 'barber');
  assert.equal(opan.metadata.notification_type, 'booking_barber_assignment');
  assert.equal(opan.metadata.group_id, 'g-1');
  assert.ok(opan.metadata.recipient.startsWith('***'));
  assert.ok(logged.some(e => e.metadata.recipient_role === 'customer' && e.eventName === 'booking_notification_sent'));
  assert.ok(logged.some(e => e.metadata.recipient_role === 'branch_admin'));
});

// ── wiring ───────────────────────────────────────────────────
test('wiring: group route awaits the orchestrator after commit (no fire-and-forget customer send)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const start = src.indexOf("app.post('/api/bookings/group'");
  const end = src.indexOf("app.post('/api/bookings/:id/resend-notif'");
  const body = src.slice(start, end);
  assert.match(body, /await dispatchBookingNotifications\(/);
  assert.doesNotMatch(body, /_notifyCustomerConfirmedWithRetry\([^)]*\)\.catch/);
  assert.ok(body.indexOf('executeCreateGroupBookingAtomic') < body.indexOf('dispatchBookingNotifications'));
});
