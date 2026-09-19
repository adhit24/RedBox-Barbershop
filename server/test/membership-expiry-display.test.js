'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, '..', '..', 'public', 'js', 'membership-access.js');

// Minimal DOM: just enough for renderCustomerMembershipExpiry (getElementById,
// createElement, insertAdjacentElement) so the test needs no jsdom dependency.
function installFakeDocument() {
  const body = [];
  const makeEl = (id) => ({
    id, textContent: '', hidden: false, style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    insertAdjacentElement(_pos, el) { body.push(el); return el; },
  });
  const badge = makeEl('memberStatusBadge');
  body.push(badge);
  global.document = {
    getElementById: (id) => body.find((el) => el.id === id) || null,
    createElement: () => makeEl(''),
  };
  return { body, badge };
}

function load() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test.afterEach(() => { delete global.document; });

test('case 1: ACTIVE membership shows the backend expiry date', () => {
  const dom = installFakeDocument();
  const m = load();
  const now = '2026-09-19T00:00:00.000Z';
  assert.equal(m.isActiveMembership({
    membership_status: 'ACTIVE',
    membership_started_at: '2026-09-15',
    membership_expires_at: '2027-09-15',
  }, now), true);
  const label = dom.body.find((el) => el.id === 'membershipExpiryDisplay');
  assert.equal(label.textContent, 'Berakhir 15 Sep 2027');
  assert.equal(label.hidden, false);
});

test('case 2: date formatting is timezone-safe (15 Sep 2027 in every TZ)', () => {
  const script = `const m=require(${JSON.stringify(modulePath)});
    process.stdout.write([m.formatMembershipExpiryDate('2027-09-15'),
      m.formatMembershipExpiryDate('2027-09-15T00:00:00.000Z'),
      m.membershipDateKey('2027-09-15')].join('|'));`;
  for (const tz of ['UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Asia/Jakarta', 'America/Los_Angeles']) {
    const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(out, '15 Sep 2027|15 Sep 2027|2027-09-15', `TZ=${tz}`);
  }
});

test('case 3: non-ACTIVE or already-expired membership does not show expiry', () => {
  const dom = installFakeDocument();
  const m = load();
  const now = '2026-09-19T00:00:00.000Z';
  m.isActiveMembership({ membership_status: 'ACTIVE', membership_expires_at: '2027-09-15' }, now);
  const label = dom.body.find((el) => el.id === 'membershipExpiryDisplay');
  assert.equal(label.hidden, false);

  assert.equal(m.isActiveMembership({ membership_status: 'INACTIVE', membership_expires_at: '2027-09-15' }, now), false);
  assert.equal(label.hidden, true);
  assert.equal(label.textContent, '');

  m.isActiveMembership({ membership_status: 'ACTIVE', membership_expires_at: '2027-09-15' }, now);
  assert.equal(label.hidden, false);
  // ACTIVE flag but expiry already in the past -> not active, so no label.
  assert.equal(m.isActiveMembership({ membership_status: 'ACTIVE', membership_expires_at: '2026-01-01' }, now), false);
  assert.equal(label.hidden, true);
});

test('case 4: missing expiry does not crash and is never invented', () => {
  const dom = installFakeDocument();
  const m = load();
  const now = '2026-09-19T00:00:00.000Z';
  for (const record of [
    { membership_status: 'ACTIVE', membership_expires_at: null },
    { membership_status: 'ACTIVE' },
    { membership_status: 'ACTIVE', membership_activated_at: '2026-09-01', membership_expires_at: 'garbage' },
    {},
  ]) {
    assert.doesNotThrow(() => m.isActiveMembership(record, now));
  }
  assert.equal(dom.body.find((el) => el.id === 'membershipExpiryDisplay'), undefined);
  assert.equal(m.formatMembershipExpiryDate(null), '');
  assert.equal(m.formatMembershipExpiryDate('2027-02-31'), '');
});

test('case 5: repeated renders keep exactly one expiry element', () => {
  const dom = installFakeDocument();
  const m = load();
  const now = '2026-09-19T00:00:00.000Z';
  const record = { membership_status: 'ACTIVE', membership_expires_at: '2027-09-15' };
  for (let i = 0; i < 5; i += 1) m.isActiveMembership(record, now);
  m.isActiveMembership({ ...record, membership_expires_at: '2027-10-01' }, now);
  const labels = dom.body.filter((el) => el.id === 'membershipExpiryDisplay');
  assert.equal(labels.length, 1);
  assert.equal(labels[0].textContent, 'Berakhir 1 Okt 2027');
});

test('case 6: authority result and main-branch helpers are unchanged', () => {
  installFakeDocument();
  const m = load();
  const now = '2026-08-08T10:00:00.000Z';
  assert.equal(m.isActiveMembership({ membership_status: 'ACTIVE' }, now), true); // grandfathered legacy
  assert.equal(m.isActiveMembership({
    membership_status: 'ACTIVE', membership_started_at: '2026-08-08T10:00:00.000Z', membership_expires_at: null,
  }, now), false);
  assert.equal(m.calculateMembershipExpiry('2024-02-29T00:00:00.000Z'), '2025-02-28T00:00:00.000Z');
});

test('isActiveMembership works without a DOM (node / CRM callers)', () => {
  const m = load();
  assert.equal(m.isActiveMembership({ membership_status: 'ACTIVE', membership_expires_at: '2099-01-01' }), true);
});
