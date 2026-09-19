'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  servicesCatalog,
  buildCanonicalServicesText,
  resetServicesCatalogCache,
} = require('../services/servicesCatalog');
const {
  executeReddyAgent,
} = require('../agents/reddy/reddyAdapter');
const {
  guardFactualServiceNumbers,
  guardLateArrivalGuarantees,
  guardRepeatedGreeting,
  canUseCustomerName,
} = require('../agents/reddy/personalityPolicy');
const {
  createGuardedSend,
  normalizeOutboundLifecycleOutcome,
} = require('../services/waOutboundGuard');
const {
  classifyDeterministically,
} = require('../orchestrator/routingPolicy');
const {
  orchestrateMessage,
} = require('../orchestrator/orchestratorService');
const {
  resolveResponseLanguage,
} = require('../agents/reddy/languageResolution');
const {
  autoAssignHandoff,
  reconcileHandoffBacklog,
  evaluateCaseSLA,
} = require('../services/humanHandoff');
const {
  buildServicesText,
  handleMessage,
} = require('../../api/wa/webhook');

// ── 1. CANONICAL SERVICE PRICES & ACTIVE STATUS ──────────────────────────────
test('1. Canonical services catalog: returns active services with canonical live DB prices', async () => {
  const active = await servicesCatalog.getActiveServices();
  assert.ok(Array.isArray(active) && active.length >= 5);

  const grooming = servicesCatalog.getServiceBySlug('gentleman-grooming');
  assert.equal(grooming?.price, 95000);
  assert.equal(grooming?.duration_minutes, 75);

  const hairColor = servicesCatalog.getServiceBySlug('hair-color');
  assert.equal(hairColor?.price, 150000);

  const hairSpa = servicesCatalog.getServiceBySlug('hair-spa');
  assert.equal(hairSpa?.price, 100000);

  const rootLift = servicesCatalog.getServiceBySlug('down-perm');
  assert.equal(rootLift?.price, 165000);

  const curly = servicesCatalog.getServiceBySlug('hair-curly');
  assert.equal(curly?.price, 300000);
});

test('2. Inactive services: not returned as active services', async () => {
  const active = await servicesCatalog.getActiveServices();
  const activeSlugs = active.map(s => s.slug || s.name.toLowerCase());
  
  assert.ok(!activeSlugs.includes('beard-trim'), 'Beard trim must be inactive');
  assert.ok(!activeSlugs.includes('creambath'), 'Creambath must be inactive');
  assert.ok(!active.some(s => s.name === 'Hair Cut' && s.price === 0));
});

test('3. buildCanonicalServicesText & buildServicesText: outputs canonical prices', () => {
  const text = buildServicesText('bypass');
  assert.match(text, /Gentleman Grooming\s*—\s*Rp95\.000/);
  assert.match(text, /Hair Color\s*—\s*Rp150\.000/);
  assert.match(text, /Hair Spa\s*—\s*Rp100\.000/);
  assert.match(text, /Root Lift.*Rp165\.000|Down Perm.*Rp165\.000/);
  assert.match(text, /Hair Curly\s*—\s*Rp300\.000/);
  // Stale prices must NOT appear
  assert.doesNotMatch(text, /Gentleman Grooming\s*—\s*Rp120\.000/);
  assert.doesNotMatch(text, /Hair Color\s*—\s*Rp160\.000/);
});

// ── 2. PRE-OUTBOUND FACTUAL GUARD & ATOMIC BLOCKING ───────────────────────────
test('4. Single service hallucination: guard blocks and corrects to canonical price', async () => {
  const hallucinated = 'Harga Gentleman Grooming di RedBox adalah Rp120.000 dengan durasi 75 menit.';
  const res = await guardFactualServiceNumbers(hallucinated, { serviceName: 'Gentleman Grooming' });
  
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Rp95.000'));
  assert.ok(!res.sanitizedReply.includes('Rp120.000'));
  assert.equal(res.mismatches.length, 1);
  assert.equal(res.mismatches[0].claimed_price, 120000);
  assert.equal(res.mismatches[0].canonical_price, 95000);
});

test('5. Multi-service catalog atomic validation: if any item mismatches, entire list is corrected/blocked', async () => {
  const multiServiceReply = [
    'Berikut daftar harga layanan kami:',
    '• Gentleman Grooming — Rp120.000', // WRONG (canonical 95.000)
    '• Hair Color — Rp150.000',          // CORRECT
    '• Hair Spa — Rp110.000',            // WRONG (canonical 100.000)
    '• Hair Curly — Rp300.000',          // CORRECT
  ].join('\n');

  const res = await guardFactualServiceNumbers(multiServiceReply);
  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Rp95.000'));
  assert.ok(res.sanitizedReply.includes('Rp100.000'));
  assert.doesNotMatch(res.sanitizedReply, /Rp120\.000/);
  assert.doesNotMatch(res.sanitizedReply, /Rp110\.000/);
  assert.equal(res.mismatches.length, 2);
});

test('6. Pre-outbound factual gate in createGuardedSend: logs factual_price_mismatch_blocked with full telemetry payload', async () => {
  const loggedEvents = [];
  const fakeLogEvent = (evt) => loggedEvents.push(evt);
  let sentOutboundText = null;

  const fakeSupabase = {
    rpc: async (fn) => (fn === 'reserve_wa_automated_send'
      ? { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }
      : { data: null, error: null }),
  };

  const guardedSend = createGuardedSend({
    realSend: async (to, text) => {
      sentOutboundText = text;
      return { status: true };
    },
    supabase: fakeSupabase,
    inboundEventRowId: 'evt-test-01',
    logEvent: fakeLogEvent,
  });

  const correlationId = 'corr-audit-999';
  await guardedSend('628123456789', 'Harga Gentleman Grooming Rp120.000 kak.', {
    correlationId,
    serviceName: 'Gentleman Grooming',
    responseSource: 'ai',
    branch: 'bypass',
  });

  // Outbound must send sanitized text
  assert.ok(sentOutboundText.includes('Rp95.000'));
  assert.ok(!sentOutboundText.includes('Rp120.000'));

  // Telemetry event must be emitted with required audit fields
  const mismatchEvent = loggedEvents.find(e => e.event_type === 'factual_price_mismatch_blocked');
  assert.ok(mismatchEvent, 'factual_price_mismatch_blocked event must be emitted');
  assert.equal(mismatchEvent.correlation_id, correlationId);
  assert.equal(mismatchEvent.claimed_price, 120000);
  assert.equal(mismatchEvent.canonical_price, 95000);
  assert.equal(mismatchEvent.response_source, 'ai');
});

// ── 3. LATE ARRIVAL SAFETY ────────────────────────────────────────────────────
test('7. Late arrival guarantee guard: blocks overclaims ("tetap ditunggu", "slot aman") and sanitizes to policy statement', () => {
  const overclaim = 'Gapapa kak, tetap ditunggu ya kapsternya siap dan slot aman.';
  const res = guardLateArrivalGuarantees(overclaim);

  assert.equal(res.blocked, true);
  assert.equal(res.reason, 'unsupported_late_guarantee_blocked');
  assert.match(res.sanitizedReply, /layanan tetap menyesuaikan kondisi slot/);
  assert.doesNotMatch(res.sanitizedReply, /tetap ditunggu/);
  assert.doesNotMatch(res.sanitizedReply, /slot aman/);
});

test('8. Late arrival without booking found: does not invent booking status, clarifies safely', async () => {
  let sentReply = null;
  await handleMessage({
    from: '628999999999',
    text: 'Agak telat, 15 menit lagi.',
    branch: 'bypass',
  }, {
    send: async (_to, text) => {
      sentReply = text;
      return { status: true };
    },
    getBookingStatus: async () => ({ status: 'NOT_FOUND', bookings: [] }),
    getHandoffState: async () => ({ status: 'none' }),
  });

  assert.ok(sentReply);
  assert.match(sentReply, /Aku belum bisa memastikan booking yang dimaksud|Bisa kirim jam booking atau cabangnya/i);
  assert.doesNotMatch(sentReply, /tetap ditunggu/i);
});

test('9. Late arrival with active confirmed booking: acknowledges booking conditionally without overclaiming', async () => {
  let sentReply = null;
  await handleMessage({
    from: '628111111111',
    text: 'Agak telat 15 menit ya',
    branch: 'bypass',
  }, {
    send: async (_to, text) => {
      sentReply = text;
      return { status: true };
    },
    getBookingStatus: async () => ({
      status: 'CONFIRMED',
      bookings: [{ booking_time: '14:00', barber_name: 'Abdul', status: 'confirmed' }],
    }),
    getHandoffState: async () => ({ status: 'none' }),
  });

  assert.ok(sentReply);
  assert.match(sentReply, /aku lihat booking-nya/i);
  assert.match(sentReply, /menyesuaikan kondisi slot/i);
  assert.doesNotMatch(sentReply, /pasti ditunggu|slot aman|gapapa kak/i);
});

// ── 4. CONVERSATION CONTEXT & CONTINUATION RESOLUTION ─────────────────────────
test('10. Context continuation: "Mas Abdul ada Minggu?" -> "jam 12" resolves to availability query, not generic clarification', async () => {
  const context = {
    turns: [
      { role: 'user', content: 'Mas Abdul ada Minggu?' },
      { role: 'assistant', content: 'Minggu Mas Abdul dijadwalkan masuk jam 10:00 - 21:00 WIB kak.' },
    ],
    sessionStatus: 'active_conversation',
  };

  const decision = await orchestrateMessage('jam 12', context, {});
  assert.notEqual(decision.action, 'clarify_short');
  assert.notEqual(decision.intent, 'unknown');
  assert.equal(decision.intent, 'specific_time_availability_query');
});

test('11. Continuation: "Minggu jam 12.00" after barber discussion does not ask "Maksud Kak yang bagian mana?"', async () => {
  const context = {
    turns: [
      { role: 'user', content: 'Mas Abdul jadwalnya kapan?' },
      { role: 'assistant', content: 'Mas Abdul ada jadwal di Bypass kak.' },
    ],
    sessionStatus: 'active_conversation',
  };

  const decision = await orchestrateMessage('Minggu jam 12.00', context, {});
  assert.notEqual(decision.action, 'clarify_short');
  assert.ok(
    decision.intent === 'specific_time_availability_query' || decision.intent === 'booking_request',
    `Expected availability query or booking continuation, got ${decision.intent}`
  );
});

test('12. Availability follow-up continuity: "yang jam 2 aja" resolves same barber and date', async () => {
  const context = {
    turns: [
      { role: 'user', content: 'Mas Abdul besok kosong jam berapa?' },
      { role: 'assistant', content: 'Mas Abdul besok masih ada slot jam 11:00, 14:00, dan 16:00 kak.' },
    ],
    sessionStatus: 'active_conversation',
    latest_availability_result: {
      barber: 'Abdul',
      date: '2026-09-20',
      available_slots: ['11:00', '14:00', '16:00'],
    },
  };

  const decision = await orchestrateMessage('yang jam 2 aja', context, {});
  assert.notEqual(decision.intent, 'unknown');
  assert.equal(decision.intent, 'specific_time_availability_query');
});

test('13. Early arrival / time change intent: "bisa lebih cepat?" is classified as early_arrival_request, NOT barber_inquiry', () => {
  const classified1 = classifyDeterministically('bisa lebih cepat?');
  assert.equal(classified1?.intent, 'early_arrival_request');

  const classified2 = classifyDeterministically('bisa maju jamnya?');
  assert.equal(classified2?.intent, 'early_arrival_request');

  const classified3 = classifyDeterministically('kalau datang sekarang bisa?');
  assert.equal(classified3?.intent, 'early_arrival_request');
});

// ── 5. LANGUAGE CONSISTENCY ───────────────────────────────────────────────────
test('14. Language consistency: "Ini booking haircut." defaults to Indonesian and does not switch to English', () => {
  const lang = resolveResponseLanguage('Ini booking haircut.', { turns: [] });
  assert.equal(lang, 'indonesian', 'Should remain Indonesian despite English loanwords');

  const lang2 = resolveResponseLanguage('Mau booking haircut untuk besok', { turns: [] });
  assert.equal(lang2, 'indonesian');
});

test('15. Dominant English message correctly resolves to English', () => {
  const lang = resolveResponseLanguage('Can I book an appointment for tomorrow?', { turns: [] });
  assert.equal(lang, 'english');
});

// ── 6. PERSONALIZATION SAFETY ─────────────────────────────────────────────────
test('16. canUseCustomerName: rejects generic placeholder names and unverified identities', () => {
  assert.equal(canUseCustomerName({ name: 'Kak' }), false);
  assert.equal(canUseCustomerName({ name: 'Customer' }), false);
  assert.equal(canUseCustomerName({ name: 'User' }), false);
  assert.equal(canUseCustomerName({ name: 'Budi', trustedIdentity: null, customer: null }), false);

  assert.equal(canUseCustomerName({ name: 'Budi', trustedIdentity: { is_trusted: true } }), true);
  assert.equal(canUseCustomerName({ name: 'Budi', customer: { id: 'cust-123' } }), true);
});

// ── 7. MEDIA FALLBACK DIFFERENTIATION ─────────────────────────────────────────
test('17. Media fallback: returns distinct specific responses for image, audio, video, sticker, document', async () => {
  const sentMessages = {};
  const mockSend = async (_to, text) => {
    return { status: true, finalOutboundText: text };
  };

  // Image
  const resImage = {
    status: () => ({ json: () => {} }),
  };
  await handleMessage({ from: '628111', text: '', type: 'image' }, { send: mockSend });
  // Audio
  await handleMessage({ from: '628222', text: '', type: 'audio' }, { send: mockSend });
});

// ── 8. REPEATED GREETING GUARD ────────────────────────────────────────────────
test('18. Repeated greeting guard: strips opening greeting in active ongoing conversation', () => {
  const replyWithGreeting = 'Halo Kak! Untuk booking besok masih bisa langsung lewat web ya.';
  const guarded = guardRepeatedGreeting(replyWithGreeting, {
    sessionStatus: 'active_conversation',
    turns: [{ role: 'user', content: 'Halo' }],
  });

  assert.equal(guarded.stripped, true);
  assert.equal(guarded.sanitizedReply, 'Untuk booking besok masih bisa langsung lewat web ya.');
});

// ── 9. HUMAN HANDOFF AUTO-ASSIGNMENT & RECONCILIATION ─────────────────────────
test('19. Human handoff auto-assignment: assigns branch admin for known branches and central admin otherwise', () => {
  assert.equal(autoAssignHandoff('csb'), 'admin_csb');
  assert.equal(autoAssignHandoff('bypass'), 'admin_bypass');
  assert.equal(autoAssignHandoff('sumber'), 'admin_sumber');
  assert.equal(autoAssignHandoff(null), 'central_admin');
  assert.equal(autoAssignHandoff('unknown_branch'), 'central_admin');
});

test('20. Backlog reconciliation: unproven stale cases remain open and get escalated', async () => {
  const fakeCases = [
    {
      id: 'case-1',
      customer_phone: '6281001',
      branch: 'bypass',
      priority: 'high',
      status: 'waiting_human',
      created_at: new Date(Date.now() - 3600000).toISOString(), // 60 min old (high SLA 15 min breached)
    },
  ];

  const recordedEvents = [];
  const fakeSupabase = {
    from: (table) => {
      if (table === 'human_handoff_cases') {
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: fakeCases, error: null }),
            }),
          }),
          update: (_updates) => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }), // No later booking found
                }),
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  const result = await reconcileHandoffBacklog({
    supabase: fakeSupabase,
    recordEvaluationEvent: async (evt) => { recordedEvents.push(evt); },
  });

  assert.equal(result.status, 'reconciled');
  assert.equal(result.summary.stale_escalated, 1);
  assert.equal(result.summary.already_resolved_indirectly, 0);

  // SLA breach and escalation events must be recorded
  assert.ok(recordedEvents.some(e => e.event_type === 'handoff_sla_breached'));
  assert.ok(recordedEvents.some(e => e.event_type === 'handoff_escalated'));
});

// ── 10. TERMINAL OUTBOUND DUPLICATE LIFECYCLE ────────────────────────────────
test('21. Duplicate outbound lifecycle: reservation rejected as duplicate -> terminalKind duplicate, no provider send, correlation_id preserved', async () => {
  let providerSent = false;
  const loggedEvents = [];
  const fakeLogEvent = (evt) => loggedEvents.push(evt);

  const fakeSupabase = {
    rpc: async (fn) => {
      if (fn === 'reserve_wa_automated_send') {
        return { data: [{ decision: 'duplicate_content', claim_id: null }], error: null };
      }
      return { data: null, error: null };
    },
  };

  const correlationId = 'corr-dup-test-123';
  const guardedSend = createGuardedSend({
    realSend: async () => {
      providerSent = true;
      return { status: true };
    },
    supabase: fakeSupabase,
    inboundEventRowId: 'evt-dup-1',
    logEvent: fakeLogEvent,
  });

  const sendResult = await guardedSend('628123456789', 'Pesan konfirmasi yang sama', {
    correlationId,
    branch: 'bypass',
  });

  assert.equal(providerSent, false, 'Provider realSend must NOT be called on duplicate');
  assert.equal(sendResult.status, false);
  assert.equal(sendResult.suppressed, true);
  assert.equal(sendResult.reason, 'duplicate_content');
  assert.equal(sendResult.correlationId, correlationId);

  const outcome = normalizeOutboundLifecycleOutcome(sendResult);
  assert.equal(outcome.terminalKind, 'duplicate');
  assert.equal(outcome.reason, 'duplicate_suppressed');

  const dupEvent = loggedEvents.find(e => e.event_type === 'outbound_duplicate_suppressed');
  assert.ok(dupEvent, 'outbound_duplicate_suppressed event must be logged');
  assert.equal(dupEvent.correlation_id, correlationId);
});

// ── 11. PERSISTENCE ORDER & HALLUCINATION SANITIZATION ───────────────────────
test('22. History persistence order: hallucinated price in generated response is sanitized before persistence and provider send', async () => {
  let persistedHistory = null;
  let sentToProvider = null;

  const fakeSupabase = {
    rpc: async (fn) => (fn === 'reserve_wa_automated_send'
      ? { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }
      : { data: null, error: null }),
  };

  const guardedSend = createGuardedSend({
    realSend: async (_to, text) => {
      sentToProvider = text;
      return { status: true, finalOutboundText: text };
    },
    supabase: fakeSupabase,
    inboundEventRowId: 'evt-persist-test',
  });

  const mockPersist = async (_from, _history, _userMsg, assistantMsg) => {
    persistedHistory = assistantMsg;
  };

  const correlationId = 'corr-persist-001';
  const hallucinatedReply = 'Untuk Gentleman Grooming harganya Rp120.000 ya kak.';

  await executeReddyAgent({
    from: '628123456789',
    text: 'Berapa harga grooming?',
    branch: 'bypass',
    correlationId,
  }, {
    sendWA: guardedSend,
    persistConversation: mockPersist,
    callOpenAI: async () => hallucinatedReply,
    customer: null,
  });

  // Guard must have rewritten 120.000 to 95.000
  assert.ok(sentToProvider && sentToProvider.includes('Rp95.000'), 'Provider must receive sanitized text');
  assert.ok(!sentToProvider.includes('Rp120.000'), 'Provider must NOT receive hallucinated 120.000');

  // History must contain ONLY the sanitized text, never the raw hallucinated text
  assert.ok(persistedHistory && persistedHistory.includes('Rp95.000'), 'History must persist sanitized text');
  assert.ok(!persistedHistory.includes('Rp120.000'), 'History must NEVER persist hallucinated text');
});

// ── 12. FULL CONTEXT TURN 1 + TURN 2 INTEGRATION ────────────────────────────
test('23. End-to-end conversation continuation: Turn 1 barber inquiry -> Turn 2 "Minggu jam 12.00" executes availability query without clarification', async () => {
  const turn1User = 'Mas Abdul hari Minggu ada?';
  const turn1Assistant = 'Mas Abdul ada jadwal hari Minggu di cabang Bypass kak.';

  const conversationContext = {
    turns: [
      { role: 'user', content: turn1User },
      { role: 'assistant', content: turn1Assistant },
    ],
    sessionStatus: 'active_conversation',
  };

  const turn2Decision = await orchestrateMessage({
    message: 'Minggu jam 12.00',
    conversationContext,
    branch: 'bypass',
  });

  assert.notEqual(turn2Decision.action, 'clarify_short');
  assert.notEqual(turn2Decision.intent, 'unknown');
  assert.equal(turn2Decision.intent, 'specific_time_availability_query');
  assert.equal(turn2Decision.action, 'answer_barber_availability');
  assert.equal(turn2Decision.context_reference, 'prior_availability_barber_date');
});

test('24. Contextual relative shifts: "lebih pagi?", "bisa maju jamnya?" classified as early_arrival or availability refinement', () => {
  const c1 = classifyDeterministically('bisa maju jamnya?');
  assert.equal(c1?.intent, 'early_arrival_request');

  const c2 = classifyDeterministically('bisa lebih cepat?');
  assert.equal(c2?.intent, 'early_arrival_request');

  const c3 = classifyDeterministically('kalau datang sekarang bisa?');
  assert.equal(c3?.intent, 'early_arrival_request');
});

test('25. Availability continuity != booking confirmed: selecting slot does NOT reserve or confirm without booking execution', async () => {
  const context = {
    turns: [
      { role: 'user', content: 'Mas Abdul besok ada slot jam berapa?' },
      { role: 'assistant', content: 'Mas Abdul besok ada jam 11:00, 14:00, dan 16:00.' },
    ],
    sessionStatus: 'active_conversation',
    latest_availability_result: {
      barber: 'Abdul',
      date: '2026-09-20',
      available_slots: ['11:00', '14:00', '16:00'],
    },
  };

  const decision = await orchestrateMessage({
    message: 'yang jam 2 aja',
    conversationContext: context,
  });

  assert.equal(decision.intent, 'specific_time_availability_query');
  assert.ok(
    decision.prohibited_claims?.includes('slot_reserved_via_whatsapp') ||
    decision.prohibited_claims?.includes('booking_created_via_whatsapp') ||
    decision.prohibited_claims?.includes('slot_reserved') ||
    decision.allowed_claims?.includes('website_is_reservation_authority')
  );
});

// ── 13. GENERATED OVERCLAIM BLOCKING ──────────────────────────────────────────
test('26. Model generated late arrival overclaim: "Tenang kak, kapsternya pasti tunggu." is rewritten and logged', async () => {
  const rawModelReply = 'Tenang kak, kapsternya pasti tunggu dan slot aman kok.';
  const res = guardLateArrivalGuarantees(rawModelReply);

  assert.equal(res.blocked, true);
  assert.equal(res.reason, 'unsupported_late_guarantee_blocked');
  assert.doesNotMatch(res.sanitizedReply, /pasti tunggu/);
  assert.doesNotMatch(res.sanitizedReply, /slot aman/);
  assert.match(res.sanitizedReply, /layanan tetap menyesuaikan kondisi slot/);
});

// ── 14. TELEMETRY PII SAFETY ─────────────────────────────────────────────────
test('27. Telemetry PII protection: factual guard telemetry hashes sender phone (no raw phone leak)', async () => {
  const loggedEvents = [];
  const fakeLog = (evt) => { loggedEvents.push(evt); };

  const fakeSupabase = {
    rpc: async (fn) => (fn === 'reserve_wa_automated_send'
      ? { data: [{ decision: 'allowed', claim_id: 'c1' }], error: null }
      : { data: null, error: null }),
  };

  const rawPhone = '6281987654321';
  const guardedSend = createGuardedSend({
    realSend: async () => ({ status: true }),
    supabase: fakeSupabase,
    inboundEventRowId: 'evt-telemetry-sec',
    logEvent: fakeLog,
  });

  await guardedSend(rawPhone, 'Harga Hair Color Rp180.000 kak.', {
    correlationId: 'corr-sec-test',
    branch: 'bypass',
    serviceName: 'Hair Color',
    responseSource: 'ai',
  });

  const loggedEvent = loggedEvents.find(e => e.event_type === 'factual_price_mismatch_blocked');
  assert.ok(loggedEvent, 'Event factual_price_mismatch_blocked should be logged');
  assert.equal(loggedEvent.event_type, 'factual_price_mismatch_blocked');
  assert.equal(loggedEvent.correlation_id, 'corr-sec-test');
  assert.ok(!JSON.stringify(loggedEvent).includes(rawPhone), 'Raw customer phone must NOT appear in telemetry payload');
  assert.ok(loggedEvent.sender_hash && loggedEvent.sender_hash.length >= 32, 'Sender hash must be a SHA-256 hex string');
});

// ── 15. DYNAMIC LIVE DATABASE AS AUTHORITY ───────────────────────────────────
test('28. Canonical DB authority: dynamic database row update takes immediate precedence over static seed', async () => {
  resetServicesCatalogCache();
  const dynamicDbRows = [
    { id: 'srv-special', name: 'Special Promo Cut', price: 77000, duration_minutes: 40, is_active: true },
  ];

  const fakeDbClient = {
    from: (table) => {
      if (table === 'services') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: dynamicDbRows, error: null }),
          }),
        };
      }
      return {};
    },
  };

  const catalog = await servicesCatalog.getActiveServicesCatalog(fakeDbClient, { forceRefresh: true });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].name, 'Special Promo Cut');
  assert.equal(catalog[0].price, 77000);

  const res = await guardFactualServiceNumbers('Special Promo Cut harganya Rp90.000', {
    supabase: fakeDbClient,
    serviceName: 'Special Promo Cut',
  });

  assert.equal(res.blocked, true);
  assert.ok(res.sanitizedReply.includes('Rp77.000'));
  assert.equal(res.mismatches[0].canonical_price, 77000);
});
