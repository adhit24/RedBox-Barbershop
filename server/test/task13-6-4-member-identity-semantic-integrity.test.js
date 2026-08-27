'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCustomer360 } = require('../crm/customer360Service');
const { projectCustomerSelf } = require('../crm/customerPrivacy');
const { buildCustomerFactsContext, extractCustomerIntelligenceEnvelope } = require('../agents/reddy/customerFactsContext');
const { buildReddyPersonalityPrompt } = require('../agents/reddy/personalityPolicy');
const { buildDecisionEnvelope } = require('../orchestrator/orchestratorService');

function createMockSupabase(fixtures = {}) {
  return {
    from: (table) => {
      const data = [...(fixtures[table] || [])];
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

const baseDecision = {
  intent: 'unknown',
  route: 'reddy_agent',
  action: 'fallback_unknown',
  confidence: 0.5,
  model_tier: 'none',
};

test('M1. canonical member profile presence establishes registered member identity', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Henky', membership_status: 'INACTIVE' }],
  }), { phone: '6281234567890' });

  assert.equal(result.customer.registration_status, 'registered_member');
  assert.equal(result.customer.is_registered_member, true);
  assert.equal(result.customer.registration_status_source, 'member_profiles_presence');
});

test('M2. member_profiles.created_at is the verified member_since authority', async () => {
  const internal = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', created_at: '2025-03-14T10:00:00Z' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(internal),
  });

  assert.equal(envelope.facts.member_since, '2025-03-14');
  assert.equal(envelope.fact_quality.member_since, 'verified');
});

test('M3. customers.created_at alone never becomes member_since', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', created_at: null }],
    customers: [{ id: 'cust-1', wa: '6281234567890', created_at: '2024-01-01T00:00:00Z' }],
  }), { phone: '6281234567890' });

  assert.equal(result.customer.member_since, null);
  assert.equal(result.customer.member_since_source, null);
  assert.equal(result.customer.created_at, '2024-01-01T00:00:00Z');
});

test('M4. inactive paid plan does not negate registered member identity', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', membership_status: 'INACTIVE' }],
  }), { phone: '6281234567890' });

  assert.equal(result.customer.registration_status, 'registered_member');
  assert.equal(result.membership.plan_status, 'INACTIVE');
  assert.equal(result.membership.status_scope, 'paid_membership_plan');
});

test('M5. member-since guidance uses registration facts and forbids volunteering paid-plan inactivity', () => {
  const context = buildCustomerFactsContext(extractCustomerIntelligenceEnvelope({
    status: 'success',
    customer_found: true,
    data: {
      customer: {
        name: 'Henky', registration_status: 'registered_member', is_registered_member: true,
        registration_status_source: 'member_profiles_presence', member_since: '2025-03-14',
        member_since_source: 'member_profiles.created_at',
      },
      membership: { plan_status: 'INACTIVE', status_scope: 'paid_membership_plan', status_source: 'membership_policy' },
    },
  }));

  assert.match(context, /answer using registration_status \+ member_since/);
  assert.match(context, /NEVER say membership\/account is inactive when answering "member sejak kapan"/);
});

test('M6. "Aku member Redbox gak?" routes to trusted CRM registration facts', () => {
  const decision = buildDecisionEnvelope({ message: 'Aku member Redbox gak?', decision: baseDecision });

  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_customer_profile');
  assert.deepEqual(decision.required_sources, ['crm:get_customer_profile']);
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('M7. ambiguous "Membership aku aktif?" requires one short scope clarification', () => {
  const decision = buildDecisionEnvelope({ message: 'Membership aku aktif?', decision: baseDecision });
  const prompt = buildReddyPersonalityPrompt({ isVerifiedName: true, verifiedName: 'Henky' });

  assert.equal(decision.clarification_required, true);
  assert.equal(decision.response_strategy, 'clarify_short');
  assert.equal(decision.action, 'clarify_membership_scope');
  assert.match(prompt, /Maksud Kak, akun member Redbox-nya atau paket membership berbayarnya/);
});

test('M8. points balance never infers an active paid plan', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', total_points: 961, membership_status: 'INACTIVE' }],
  }), { phone: '6281234567890' });

  assert.equal(result.loyalty.points_balance, 961);
  assert.equal(result.membership.plan_status, 'INACTIVE');
});

test('M9. successful OTP verification creates authentication state but never activates paid membership', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const verifyStart = source.indexOf("app.post('/api/auth/otp/verify'");
  const verifyEnd = source.indexOf("app.get('/api/auth/me'", verifyStart);
  const verifyRoute = source.slice(verifyStart, verifyEnd);

  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart);
  assert.match(verifyRoute, /from\('otp_codes'\)[\s\S]*verified_at/);
  assert.match(verifyRoute, /from\('member_sessions'\)\.insert/);
  assert.doesNotMatch(verifyRoute, /membership_status\s*:\s*['"]ACTIVE['"]/);
  assert.doesNotMatch(verifyRoute, /from\(['"]member_profiles['"]\)[\s\S]*\.update\(/);
});

test('M10. unavailable CRM never infers member_since from visits or transactions', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'error',
    customer_found: false,
    data: { activity: { first_visit: '2024-01-01' }, transactions: [{ created_at: '2023-01-01' }] },
  });

  assert.equal(envelope.facts.member_since, undefined);
  assert.equal(envelope.fact_quality.member_since, 'unavailable');
});

test('M11. member_since quality is verified only with canonical source metadata', () => {
  const untrusted = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { member_since: '2020-01-01' } },
  });
  const trusted = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { member_since: '2025-03-14', member_since_source: 'member_profiles.created_at' } },
  });

  assert.equal(untrusted.fact_quality.member_since, 'unavailable');
  assert.equal(trusted.fact_quality.member_since, 'verified');
});

test('M12. legacy customer membership_status cannot override registration identity', async () => {
  const result = await getCustomer360(createMockSupabase({
    customers: [{ id: 'cust-1', wa: '6281234567890', membership_status: 'ACTIVE' }],
  }), { phone: '6281234567890' });

  assert.equal(result.customer.registration_status, 'guest_customer');
  assert.equal(result.customer.is_registered_member, false);
  assert.equal(result.customer.registration_status_source, 'member_profiles_absence');
});

test('M13. customer fact prompt explicitly scopes account, paid plan, points, and ambiguity', () => {
  const context = buildCustomerFactsContext({
    status: 'success', customer_found: true, facts: {}, unknown_fields: [], fact_quality: {},
  });

  assert.match(context, /REGISTERED REDBOX MEMBER ACCOUNT/);
  assert.match(context, /paid membership benefit\/plan status ONLY/);
  assert.match(context, /Points balance is independent/);
  assert.match(context, /Never guess either status/);
});

test('M14. member_since question remains an Orchestrator CRM read', () => {
  const decision = buildDecisionEnvelope({ message: 'Aku member sejak kapan?', decision: baseDecision });

  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('M15. Task 13.6.3.1 direct-booking no-commit governance remains intact', () => {
  const decision = buildDecisionEnvelope({
    message: 'Aku mau booking Onoy besok jam 3.',
    decision: { ...baseDecision, intent: 'booking_request', action: 'guide_booking' },
  });

  assert.equal(decision.response_strategy, 'guide_to_booking');
  assert.ok(decision.allowed_claims.includes('website_is_reservation_authority'));
  assert.ok(decision.prohibited_claims.includes('booking_updated'));
  assert.ok(decision.prohibited_claims.includes('reservation_confirmed'));
});
