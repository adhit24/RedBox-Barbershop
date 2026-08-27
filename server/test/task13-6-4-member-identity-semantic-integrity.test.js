'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCustomer360 } = require('../crm/customer360Service');
const { buildCustomerFactsContext, extractCustomerIntelligenceEnvelope } = require('../agents/reddy/customerFactsContext');
const { buildReddyPersonalityPrompt } = require('../agents/reddy/personalityPolicy');
const { buildSystemPrompt } = require('../../api/wa/webhook');

// Mock Supabase helper
function createMockSupabase(fixtures = {}) {
  const {
    member_profiles = [],
    customers = [],
    transactions = [],
    bookings = [],
  } = fixtures;

  return {
    from: (table) => {
      let data = [];
      if (table === 'member_profiles') data = [...member_profiles];
      if (table === 'customers') data = [...customers];
      if (table === 'transactions') data = [...transactions];
      if (table === 'bookings') data = [...bookings];

      const chain = {
        select: () => chain,
        or: () => chain,
        in: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve) => resolve({ data, error: null }),
      };
      return chain;
    },
  };
}

test('M1. member_profiles exists but membership_status is null/inactive -> registration_status remains registered_member', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', membership_status: 'INACTIVE' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'registered_member');
  assert.equal(res.customer.is_registered_member, true);
  assert.equal(res.membership.status, 'INACTIVE');
  assert.equal(res.membership.status_scope, 'paid_membership_plan');
});

test('M2. registered_member + member_profiles.created_at -> member_since derives from member profile timestamp', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', created_at: '2025-03-14T10:00:00Z' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'registered_member');
  assert.equal(res.customer.member_since, '2025-03-14');
});

test('M3. registered_member + member_since missing -> member_since is null without changing registration_status', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', created_at: null }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'registered_member');
  assert.equal(res.customer.is_registered_member, true);
  assert.equal(res.customer.member_since, null);
});

test('M4. registered_member + points > 0 + paid membership inactive -> no semantic contradiction', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', total_points: 961, membership_status: 'INACTIVE' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'registered_member');
  assert.equal(res.loyalty.points_balance, 961);
  assert.equal(res.membership.status, 'INACTIVE');
  assert.equal(res.membership.status_scope, 'paid_membership_plan');
});

test('M5. Question "member sejak kapan?" facts context points to member_since NOT membership.status', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success',
    customer_found: true,
    data: {
      customer: { name: 'Henky', registration_status: 'registered_member', is_registered_member: true, member_since: '2025-03-14' },
      membership: { status: 'INACTIVE', status_scope: 'paid_membership_plan' },
      loyalty: { points_balance: 961 },
    },
  });

  assert.equal(envelope.facts.registration_status, 'registered_member');
  assert.equal(envelope.facts.member_since, '2025-03-14');
  assert.equal(envelope.facts.membership_status_scope, 'paid_membership_plan');

  const context = buildCustomerFactsContext(envelope);
  assert.match(context, /registered_member/);
  assert.match(context, /member_since/);
  assert.match(context, /MEMBER ACCOUNT vs PAID PLAN DISTINCTION/);
  assert.match(context, /Kak \[Nama\] sudah jadi member Redbox sejak/);
});

test('M6. Question "member sejak kapan?" with member_since null instructs registered member date-unavailable semantics', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success',
    customer_found: true,
    data: {
      customer: { name: 'Henky', registration_status: 'registered_member', is_registered_member: true, member_since: null },
      membership: { status: 'INACTIVE', status_scope: 'paid_membership_plan' },
    },
  });

  const context = buildCustomerFactsContext(envelope);
  assert.match(context, /registered_member/);
  assert.match(context, /Cuma tanggal pertama kali gabungnya belum kebaca di dataku/);
  assert.match(context, /NEVER say membership\/account is inactive when answering "member sejak kapan"/);
});

test('M7. Question "membership aku aktif?" instructs distinguishing member account from paid plan status', () => {
  const prompt = buildReddyPersonalityPrompt({ isVerifiedName: true, verifiedName: 'Henky' });
  assert.match(prompt, /ATURAN INTEGRITAS STATUS MEMBERSHIP & MEMBER SINCE/);
  assert.match(prompt, /Akun member Redbox kamu terdaftar, Kak\. Kalau yang dimaksud paket\/benefit membership/);
});

test('M8. Guest customer with no member profile does NOT claim registered member', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-1', wa: '6281234567890', name: 'Guest User' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'guest_customer');
  assert.equal(res.customer.is_registered_member, false);
  assert.equal(res.customer.member_since, null);
});

test('M9. Points exist in guest customer row but no trusted member profile does NOT claim registered member', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-1', wa: '6281234567890', name: 'Guest User', points: 100 }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'guest_customer');
  assert.equal(res.customer.is_registered_member, false);
  assert.equal(res.loyalty.points_balance, 100);
});

test('M10. membership_status ACTIVE in customer row without trusted member profile remains guest_customer', async () => {
  const supabase = createMockSupabase({
    customers: [{ id: 'cust-1', wa: '6281234567890', name: 'Guest User', membership_status: 'ACTIVE' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'guest_customer');
  assert.equal(res.customer.is_registered_member, false);
});

test('M11. member profile creation date (2025-03-14) differs from customers.created_at (2024-01-01) -> member_since uses profile date', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', created_at: '2025-03-14T10:00:00Z' }],
    customers: [{ id: 'cust-1', wa: '6281234567890', name: 'Henky', created_at: '2024-01-01T08:00:00Z' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'registered_member');
  assert.equal(res.customer.member_since, '2025-03-14');
  assert.equal(res.customer.created_at, '2024-01-01T08:00:00Z');
});

test('M12. Multiple alias customer rows do NOT cause arbitrary earliest-date member_since inference', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', created_at: null }],
    customers: [
      { id: 'cust-1', wa: '6281234567890', name: 'Henky A', created_at: '2023-05-01T00:00:00Z' },
      { id: 'cust-2', wa: '6281234567890', name: 'Henky B', created_at: '2022-01-01T00:00:00Z' },
    ],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.equal(res.customer.registration_status, 'registered_member');
  assert.equal(res.customer.member_since, null);
});

test('M13. System prompt strictly forbids stating "membership tidak aktif" when customer asks "member sejak kapan"', () => {
  const systemPrompt = buildSystemPrompt('bypass', 'expired', 'Henky');
  assert.match(systemPrompt, /DILARANG MENYATAKAN membership\/akun tidak aktif saat menjawab pertanyaan "member sejak kapan"/);
});

test('M14. Natural language rules remain Task 13.6.3 compliant (no bureaucratic jargon)', () => {
  const prompt = buildReddyPersonalityPrompt({ isVerifiedName: true, verifiedName: 'Henky' });
  assert.match(prompt, /GAYA BAHASA PERCAKAPAN ALAMI/);
  assert.match(prompt, /Kak Henky sudah jadi member Redbox sejak/);
  assert.equal(prompt.includes('status membership Anda tidak aktif'), false);
});

test('M15. Existing Customer360, identity, and points output structure remains intact', async () => {
  const supabase = createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', total_points: 500, created_at: '2025-03-14T10:00:00Z' }],
  });

  const res = await getCustomer360(supabase, { phone: '6281234567890' });
  assert.ok(res.customer);
  assert.ok(res.membership);
  assert.ok(res.loyalty);
  assert.equal(res.customer.name, 'Henky');
  assert.equal(res.loyalty.points_balance, 500);
});
