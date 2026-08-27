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

test('M16. registered member with no membership_status is paid_plan_status unavailable, not verified INACTIVE', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', membership_status: null }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });

  assert.equal(result.membership.plan_status, null);
  assert.equal(result.membership.status_source, 'absent');
  assert.equal(envelope.facts.membership_plan_status, undefined);
  assert.equal(envelope.fact_quality.paid_plan_status, 'unavailable');
  assert.notEqual(envelope.fact_quality.paid_plan_status, 'verified');
});

test('M17. guest customer with no paid plan fields is paid_plan_status unavailable', async () => {
  const result = await getCustomer360(createMockSupabase({
    customers: [{ id: 'cust-1', wa: '6281234567890' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });

  assert.equal(result.membership.plan_status, null);
  assert.equal(envelope.fact_quality.paid_plan_status, 'unavailable');
});

test('M18. explicit INACTIVE status is paid_plan_status INACTIVE verified', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', membership_status: 'INACTIVE' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });

  assert.equal(result.membership.plan_status, 'INACTIVE');
  assert.equal(envelope.facts.membership_plan_status, 'INACTIVE');
  assert.equal(envelope.fact_quality.paid_plan_status, 'verified');
});

test('M19. explicit ACTIVE status with valid policy timing is paid_plan_status ACTIVE verified', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', membership_status: 'ACTIVE', membership_activated_at: '2026-01-01T00:00:00Z', membership_expires_at: '2099-01-01T00:00:00Z' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });

  assert.equal(result.membership.plan_status, 'ACTIVE');
  assert.equal(envelope.facts.membership_plan_status, 'ACTIVE');
  assert.equal(envelope.fact_quality.paid_plan_status, 'verified');
});

test('M20. no configured tier makes paid_plan_tier unavailable', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', tier: null }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });

  assert.equal(result.membership.tier_origin, 'default_baseline');
  assert.equal(envelope.fact_quality.paid_plan_tier, 'unavailable');
});

test('M21. configured tier makes paid_plan_tier verified', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', tier: 'silver' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });

  assert.equal(result.membership.tier_origin, 'configured');
  assert.equal(envelope.fact_quality.paid_plan_tier, 'verified');
});

test('M22. fact pack does not expose verified INACTIVE when source status is absent', async () => {
  const result = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(result),
  });
  const prompt = buildCustomerFactsContext(envelope);

  assert.equal(envelope.fact_quality.paid_plan_status, 'unavailable');
  assert.doesNotMatch(prompt, /paid_plan_status:\s*verified/);
});

test('M23. "member aktif kapan?" triggers clarify_membership_time_scope', () => {
  const decision = buildDecisionEnvelope({ message: 'member aktif kapan?', decision: baseDecision });

  assert.equal(decision.clarification_required, true);
  assert.equal(decision.response_strategy, 'clarify_short');
  assert.equal(decision.action, 'clarify_membership_time_scope');
});

test('M24. "membership aktif sejak kapan?" triggers clarify_membership_time_scope', () => {
  const decision = buildDecisionEnvelope({ message: 'membership aktif sejak kapan?', decision: baseDecision });

  assert.equal(decision.clarification_required, true);
  assert.equal(decision.response_strategy, 'clarify_short');
  assert.equal(decision.action, 'clarify_membership_time_scope');
});

test('M25. "aku jadi member sejak kapan?" routes directly to CRM member_since', () => {
  const decision = buildDecisionEnvelope({ message: 'aku jadi member sejak kapan?', decision: baseDecision });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('M26. "terdaftar member sejak kapan?" routes directly to CRM member_since', () => {
  const decision = buildDecisionEnvelope({ message: 'terdaftar member sejak kapan?', decision: baseDecision });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('M27. "paket membership aktif sejak kapan?" routes directly to CRM paid plan fact', () => {
  const decision = buildDecisionEnvelope({ message: 'paket membership aktif sejak kapan?', decision: baseDecision });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('M28. "membership berbayar aktif kapan?" routes directly to CRM paid plan fact', () => {
  const decision = buildDecisionEnvelope({ message: 'membership berbayar aktif kapan?', decision: baseDecision });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.action, 'get_customer_profile');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('M29. account context + "aktif kapan?" resolves account registration scope without clarification', () => {
  const decision = buildDecisionEnvelope({
    message: 'aktif kapan?',
    conversationContext: {
      history_status: 'available',
      sessionStatus: 'active_conversation',
      turns: [{ role: 'user', content: 'Akun member aku masih terdaftar?' }],
    },
    decision: baseDecision,
  });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.continuation_type, 'contextual');
  assert.equal(decision.context_reference, 'prior_account_registration_discussion');
  assert.equal(decision.action, 'get_customer_profile');
});

test('M30. paid plan context + "aktif sejak kapan?" resolves paid plan activation scope without clarification', () => {
  const decision = buildDecisionEnvelope({
    message: 'aktif sejak kapan?',
    conversationContext: {
      history_status: 'available',
      sessionStatus: 'active_conversation',
      turns: [{ role: 'user', content: 'Paket membership aku aktif nggak?' }],
    },
    decision: baseDecision,
  });

  assert.equal(decision.clarification_required, false);
  assert.equal(decision.continuation_type, 'contextual');
  assert.equal(decision.context_reference, 'prior_paid_membership_discussion');
  assert.equal(decision.action, 'get_customer_profile');
});

test('M31. conversation context resolves scope only; backend date comes strictly from CRM', async () => {
  const internal = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', created_at: '2026-05-28T00:00:00Z', membership_status: 'ACTIVE', membership_activated_at: '2026-07-01T00:00:00Z' }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(internal),
  });

  assert.equal(envelope.facts.member_since, '2026-05-28');
  assert.equal(envelope.facts.membership_plan_activated_at, '2026-07-01T00:00:00Z');
});

test('M32. member_since and paid_plan_activated_at sources are strictly separate and never swapped', async () => {
  const internal = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', created_at: '2026-05-28T00:00:00Z', membership_status: 'ACTIVE', membership_activated_at: '2026-07-01T00:00:00Z' }],
  }), { phone: '6281234567890' });

  assert.equal(internal.customer.member_since, '2026-05-28');
  assert.equal(internal.membership.activated_at, '2026-07-01T00:00:00Z');
  assert.notEqual(internal.customer.member_since, internal.membership.activated_at);
});

test('Hengky-like anonymized regression: member account, paid plan active, dates separate, ambiguity clarified', async () => {
  const internal = await getCustomer360(createMockSupabase({
    member_profiles: [{ id: 'prof-1', phone: '6281234567890', full_name: 'Anonymized Member', created_at: '2026-05-28T00:00:00Z', membership_status: 'ACTIVE', membership_activated_at: '2026-07-01T00:00:00Z', tier: 'silver', total_points: 150 }],
  }), { phone: '6281234567890' });
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true, data: projectCustomerSelf(internal),
  });

  // 1. "member sejak kapan?" -> Date A (2026-05-28)
  assert.equal(envelope.facts.member_since, '2026-05-28');
  assert.equal(envelope.fact_quality.member_since, 'verified');

  // 2. "paket membership aktif sejak kapan?" -> Date B (2026-07-01)
  assert.equal(envelope.facts.membership_plan_activated_at, '2026-07-01T00:00:00Z');
  assert.equal(envelope.fact_quality.paid_plan_activation, 'verified');

  // 3. "member aktif kapan?" -> clarification first
  const decision = buildDecisionEnvelope({ message: 'member aktif kapan?', decision: baseDecision });
  assert.equal(decision.clarification_required, true);
  assert.equal(decision.action, 'clarify_membership_time_scope');
  assert.equal(decision.response_strategy, 'clarify_short');

  // Points independent
  assert.equal(envelope.facts.points_balance, 150);
});

// --- PROVENANCE HARDENING TESTS (P1 - P8) ---

test('P1. member_since value with source customers.created_at is unavailable quality', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { member_since: '2024-01-01', member_since_source: 'customers.created_at' } },
  });

  assert.equal(envelope.facts.member_since, '2024-01-01');
  assert.equal(envelope.fact_quality.member_since, 'unavailable');
});

test('P2. member_since value with source member_profiles.created_at is verified quality', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { member_since: '2025-03-14', member_since_source: 'member_profiles.created_at' } },
  });

  assert.equal(envelope.facts.member_since, '2025-03-14');
  assert.equal(envelope.fact_quality.member_since, 'verified');
});

test('P3. registration_status without canonical source is unavailable quality', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { registration_status: 'registered_member', is_registered_member: true } },
  });

  assert.equal(envelope.fact_quality.registration_status, 'unavailable');
  assert.equal(envelope.fact_quality.identity, 'unavailable');
});

test('P4. registration_status with source member_profiles_presence is verified quality', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { registration_status: 'registered_member', registration_status_source: 'member_profiles_presence' } },
  });

  assert.equal(envelope.fact_quality.registration_status, 'verified');
  assert.equal(envelope.fact_quality.identity, 'verified');
});

test('P5. guest_customer with source member_profiles_absence is verified quality', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: { customer: { registration_status: 'guest_customer', registration_status_source: 'member_profiles_absence' } },
  });

  assert.equal(envelope.fact_quality.registration_status, 'verified');
  assert.equal(envelope.fact_quality.identity, 'verified');
});

test('P6. member_profiles.membership_activated_at source makes paid_plan_activation verified', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: {
      membership: {
        activated_at: '2026-07-01T00:00:00Z',
        activated_at_source: 'member_profiles.membership_activated_at',
      },
    },
  });

  assert.equal(envelope.facts.membership_plan_activated_at, '2026-07-01T00:00:00Z');
  assert.equal(envelope.fact_quality.paid_plan_activation, 'verified');
});

test('P7. customer-row membership_activated_at source makes paid_plan_activation unavailable', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: {
      membership: {
        activated_at: '2026-07-01T00:00:00Z',
        activated_at_source: 'customers.membership_activated_at',
      },
    },
  });

  assert.equal(envelope.facts.membership_plan_activated_at, '2026-07-01T00:00:00Z');
  assert.equal(envelope.fact_quality.paid_plan_activation, 'unavailable');
});

test('P8. activation timestamp without source metadata is unavailable quality', () => {
  const envelope = extractCustomerIntelligenceEnvelope({
    status: 'success', customer_found: true,
    data: {
      membership: {
        activated_at: '2026-07-01T00:00:00Z',
      },
    },
  });

  assert.equal(envelope.facts.membership_plan_activated_at, '2026-07-01T00:00:00Z');
  assert.equal(envelope.fact_quality.paid_plan_activation, 'unavailable');
});

// --- PR REVIEW ROUTING CORRECTIONS (R1 - R8) ---

const mixedMembershipClarificationContext = {
  history_status: 'available',
  sessionStatus: 'active_conversation',
  turns: [{
    role: 'assistant',
    content: 'Maksud Kak, sejak kapan terdaftar sebagai member Redbox, atau sejak kapan paket membership-nya aktif?',
  }],
};

test('R1. mixed clarification history + explicit paid-plan reply uses paid-plan activation scope', () => {
  for (const message of ['yang paket, aktif kapan?', 'paketnya', 'yang membership berbayar']) {
    const decision = buildDecisionEnvelope({
      message,
      conversationContext: mixedMembershipClarificationContext,
      decision: baseDecision,
    });

    assert.equal(decision.route, 'crm_agent', message);
    assert.equal(decision.action, 'get_customer_profile', message);
    assert.equal(decision.context_reference, 'explicit_paid_plan_activation_scope', message);
    assert.equal(decision.clarification_required, false, message);
  }
});

test('R2. mixed clarification history + explicit account reply uses member account scope', () => {
  for (const message of ['yang akun', 'yang terdaftar']) {
    const decision = buildDecisionEnvelope({
      message,
      conversationContext: mixedMembershipClarificationContext,
      decision: baseDecision,
    });

    assert.equal(decision.route, 'crm_agent', message);
    assert.equal(decision.action, 'get_customer_profile', message);
    assert.equal(decision.context_reference, 'explicit_member_account_scope', message);
    assert.equal(decision.clarification_required, false, message);
  }
});

test('R3. current explicit paid-plan wording beats prior account context', () => {
  const decision = buildDecisionEnvelope({
    message: 'paket membership aktif sejak kapan?',
    conversationContext: {
      history_status: 'available', sessionStatus: 'active_conversation',
      turns: [{ role: 'user', content: 'Akun member aku masih terdaftar?' }],
    },
    decision: baseDecision,
  });

  assert.equal(decision.context_reference, 'explicit_paid_plan_activation_scope');
  assert.equal(decision.route, 'crm_agent');
});

test('R4. current explicit account wording beats prior paid-plan context', () => {
  const decision = buildDecisionEnvelope({
    message: 'akun member aku terdaftar sejak kapan?',
    conversationContext: {
      history_status: 'available', sessionStatus: 'active_conversation',
      turns: [{ role: 'user', content: 'Paket membership aku aktif?' }],
    },
    decision: baseDecision,
  });

  assert.equal(decision.context_reference, 'explicit_member_account_scope');
  assert.equal(decision.route, 'crm_agent');
});

test('R5. "gimana cara jadi member?" remains public membership information', () => {
  const decision = buildDecisionEnvelope({ message: 'gimana cara jadi member?', decision: baseDecision });

  assert.equal(decision.intent, 'membership_inquiry');
  assert.equal(decision.route, 'reddy_agent');
  assert.equal(decision.action, 'explain_membership');
  assert.deepEqual(decision.required_sources, ['knowledge:verified_business_fact']);
  assert.equal(decision.response_strategy, 'answer_with_knowledge_fact');
});

test('R6. "cara daftar member Redbox?" remains public membership information', () => {
  const decision = buildDecisionEnvelope({ message: 'cara daftar member Redbox?', decision: baseDecision });

  assert.equal(decision.intent, 'membership_inquiry');
  assert.equal(decision.route, 'reddy_agent');
  assert.equal(decision.action, 'explain_membership');
  assert.equal(decision.response_strategy, 'answer_with_knowledge_fact');
});

test('R7. "aku jadi member sejak kapan?" remains a CRM member_since read', () => {
  const decision = buildDecisionEnvelope({ message: 'aku jadi member sejak kapan?', decision: baseDecision });

  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.context_reference, 'explicit_member_since_scope');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});

test('R8. "kapan pertama jadi member?" remains a CRM member_since read', () => {
  const decision = buildDecisionEnvelope({ message: 'kapan pertama jadi member?', decision: baseDecision });

  assert.equal(decision.intent, 'customer_profile');
  assert.equal(decision.route, 'crm_agent');
  assert.equal(decision.context_reference, 'explicit_member_since_scope');
  assert.equal(decision.response_strategy, 'answer_with_crm_fact');
});
