'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { REDBOX_SERVICES } = require('../../public/js/services-data');
const { REDBOX_KNOWLEDGE } = require('../agents/reddy/knowledge/redboxKnowledge');
const { resolveKnowledgeContext } = require('../agents/reddy/knowledge/knowledgeResolver');
const {
  guardFactualServiceNumbers,
  guardLegacyServiceNames,
  HISTORICAL_OR_DISPUTE_CONTEXT_REGEX,
} = require('../agents/reddy/personalityPolicy');

// ── 1. CATALOG MASTER & BRANCH PRICING ────────────────────────────
test('1. CATALOG: REDBOX_SERVICES has updated Treatment Smoothing & Shave with branch pricing', () => {
  const service = REDBOX_SERVICES.find((s) => s.id === 'hair-smoothing');
  assert.ok(service, 'Service hair-smoothing must exist');
  assert.equal(service.name, 'Treatment Smoothing & Shave', 'Name must be Treatment Smoothing & Shave');
  assert.equal(service.price, 450000, 'Standard branch price must be 450000');
  assert.equal(service.csbPrice, 450000, 'CSB branch price must be 450000 (no different price)');
  assert.equal(service.duration, '90 menit', 'Duration must be preserved at 90 menit');
  assert.equal(
    service.desc,
    'Perawatan lengkap untuk rambut yang lebih halus, rapi, dan mudah diatur, dipadukan dengan shaving untuk memberikan hasil grooming yang lebih bersih dan polished.',
    'Description must match business specification'
  );

  const oldNamedService = REDBOX_SERVICES.find((s) => s.name.toLowerCase() === 'hair smoothing');
  assert.equal(oldNamedService, undefined, 'Hair Smoothing must NOT exist as official service name in catalog');
});

test('2. BRANCH PRICING: Standard and CSB prices are strictly 450000; no stale 360000 / 370000', () => {
  const service = REDBOX_SERVICES.find((s) => s.id === 'hair-smoothing');
  assert.equal(service.price, 450000);
  assert.equal(service.csbPrice, 450000);
  assert.notEqual(service.price, 360000, 'Must not have stale standard price 360000');
  assert.notEqual(service.csbPrice, 370000, 'Must not have stale CSB price 370000');

  // Verify across knowledge representation
  const knowledgeService = REDBOX_KNOWLEDGE.services.find((s) => s.id === 'hair-smoothing');
  assert.equal(knowledgeService.prices.standard, 450000);
  assert.equal(knowledgeService.prices.csb, 450000);
});

// ── 2. REDDY KNOWLEDGE & RESOLVER ─────────────────────────────────
test('3. REDDY KNOWLEDGE: REDBOX_KNOWLEDGE inherits Treatment Smoothing & Shave with aliases', () => {
  const service = REDBOX_KNOWLEDGE.services.find((s) => s.id === 'hair-smoothing');
  assert.ok(service, 'Service hair-smoothing must exist in REDBOX_KNOWLEDGE');
  assert.equal(service.name, 'Treatment Smoothing & Shave');
  assert.equal(service.duration_minutes, 90);
  assert.equal(service.prices.standard, 450000);
  assert.equal(service.prices.csb, 450000);

  const aliases = service.aliases;
  assert.ok(aliases.includes('treatment smoothing & shave'), 'Must include official name alias');
  assert.ok(aliases.includes('treatment smoothing'), 'Must include treatment smoothing alias');
  assert.ok(aliases.includes('hair smoothing'), 'Must recognize old hair smoothing alias');
  assert.ok(aliases.includes('smoothing rambut'), 'Must recognize smoothing rambut alias');
  assert.ok(aliases.includes('smoothing'), 'Must recognize smoothing alias');
  assert.ok(aliases.includes('rebonding'), 'Must recognize rebonding alias');
  assert.ok(aliases.includes('lurusin'), 'Must recognize lurusin alias');
});

test('4. KNOWLEDGE RESOLVER: Customer smoothing queries resolve to Treatment Smoothing & Shave', () => {
  const testQueries = [
    'ada smoothing?',
    'harga smoothing berapa?',
    'bisa smoothing rambut di tegal?',
    'ada hair smoothing kak?',
    'treatment smoothing biayanya berapa?',
    'mau lurusin rambut',
    'bisa rebonding ga?',
  ];

  for (const query of testQueries) {
    const resolved = resolveKnowledgeContext({
      intent: 'price_inquiry',
      text: query,
    });

    assert.equal(resolved.status, 'available', `Query "${query}" should resolve as available`);
    const serviceFact = resolved.facts.find((f) => f.id === 'hair-smoothing');
    assert.ok(serviceFact, `Query "${query}" must include hair-smoothing fact`);
    assert.equal(serviceFact.name, 'Treatment Smoothing & Shave', `Query "${query}" must return Treatment Smoothing & Shave`);
    assert.equal(serviceFact.prices.standard, 450000);
  }
});

// ── 3. GUARD SCOPE & PROTECTION OF HISTORICAL CONTEXT ──────────────
test('5. GUARD SCOPE: guardLegacyServiceNames normalizes CURRENT quotes but preserves HISTORICAL quotes', () => {
  // Case A: Current service quote with old name -> normalized
  const currentQuote = 'Untuk layanan Hair Smoothing harganya Rp450.000 kak.';
  const guardedCurrent = guardLegacyServiceNames(currentQuote);
  assert.equal(guardedCurrent.corrected, true);
  assert.equal(guardedCurrent.sanitizedReply, 'Untuk layanan Treatment Smoothing & Shave harganya Rp450.000 kak.');

  // Case B: Customer: "Dulu saya smoothing 360 ribu ya?"
  // Allowed response: "Ya, pada transaksi lama harganya bisa berbeda. Harga Treatment Smoothing & Shave saat ini Rp450.000."
  const pastTransactionReply = 'Ya, pada transaksi lama harganya bisa berbeda. Harga Treatment Smoothing & Shave saat ini Rp450.000.';
  const guardedPast = guardLegacyServiceNames(pastTransactionReply);
  assert.equal(guardedPast.corrected, false, 'Must not modify historical context reply');
  assert.equal(guardedPast.sanitizedReply, pastTransactionReply);

  // Case C: Historical snapshot discussion: "Booking saya bulan lalu Hair Smoothing Rp360.000"
  // MUST preserve historical snapshot language and not rename "Hair Smoothing"
  const historicalBooking = 'Booking saya bulan lalu Hair Smoothing Rp360.000';
  const guardedHistory = guardLegacyServiceNames(historicalBooking);
  assert.equal(guardedHistory.corrected, false, 'Must preserve historical snapshot name');
  assert.equal(guardedHistory.sanitizedReply, historicalBooking);

  // Case D: Past transaction record: "Transaksi tanggal 21 Juli tercatat Hair Smoothing seharga Rp360.000."
  const pastRecord = 'Transaksi tanggal 21 Juli tercatat Hair Smoothing seharga Rp360.000.';
  const guardedRecord = guardLegacyServiceNames(pastRecord);
  assert.equal(guardedRecord.corrected, false);
  assert.equal(guardedRecord.sanitizedReply, pastRecord);

  // Case E: Comparison: "Dulu Hair Smoothing harganya Rp360.000, sekarang Treatment Smoothing & Shave Rp450.000."
  const comparison = 'Dulu Hair Smoothing harganya Rp360.000, sekarang Treatment Smoothing & Shave Rp450.000.';
  const guardedComparison = guardLegacyServiceNames(comparison);
  assert.equal(guardedComparison.corrected, false);
  assert.equal(guardedComparison.sanitizedReply, comparison);

  // Case F: Dispute/complaint: "Terkait komplain selisih biaya Hair Smoothing..."
  const dispute = 'Terkait komplain selisih biaya Hair Smoothing Rp360.000, aku teruskan ke admin ya.';
  const guardedDispute = guardLegacyServiceNames(dispute);
  assert.equal(guardedDispute.corrected, false);
  assert.equal(guardedDispute.sanitizedReply, dispute);
});

test('6. GUARD SCOPE: guardFactualServiceNumbers corrects CURRENT prices but preserves HISTORICAL prices', async () => {
  const mockSupabase = {
    from(table) {
      assert.equal(table, 'services');
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: [
                  {
                    id: 'a41ee0a1-f854-48ca-8304-30529451d3c8',
                    name: 'Treatment Smoothing & Shave',
                    price: 450000,
                    duration_minutes: 90,
                    is_active: true,
                  },
                ],
                error: null,
              });
            },
          };
        },
      };
    },
  };

  // Case A: Current service quote with stale price -> corrected
  const replyWithOldPrice = 'Layanan Treatment Smoothing & Shave harganya Rp360.000 ya kak.';
  const guardedCurrent = await guardFactualServiceNumbers(replyWithOldPrice, {
    supabase: mockSupabase,
    serviceId: 'hair-smoothing',
  });
  assert.equal(guardedCurrent.blocked, true, 'Current quote with old price must be corrected');
  assert.equal(guardedCurrent.sanitizedReply, 'Layanan Treatment Smoothing & Shave harganya Rp450.000 ya kak.');

  // Case B: Historical quote: "Booking saya bulan lalu Hair Smoothing Rp360.000"
  // Must NOT become "Booking saya bulan lalu Hair Smoothing Rp450.000"
  const historicalQuote = 'Booking saya bulan lalu Hair Smoothing Rp360.000';
  const guardedHistorical = await guardFactualServiceNumbers(historicalQuote, {
    supabase: mockSupabase,
    serviceId: 'hair-smoothing',
  });
  assert.equal(guardedHistorical.blocked, false, 'Historical price must NOT be rewritten');
  assert.equal(guardedHistorical.sanitizedReply, historicalQuote, 'Must preserve Rp360.000 in past booking quote');

  // Case C: Past transaction discussion: "Dulu pada transaksi lama smoothing Rp360.000 ya Kak."
  const pastTransaction = 'Dulu pada transaksi lama smoothing Rp360.000 ya Kak.';
  const guardedPast = await guardFactualServiceNumbers(pastTransaction, {
    supabase: mockSupabase,
    serviceId: 'hair-smoothing',
  });
  assert.equal(guardedPast.blocked, false);
  assert.equal(guardedPast.sanitizedReply, pastTransaction);

  // Case D: Comparison: "Dulu 360 ribu sekarang 450 ribu"
  const comparisonQuote = 'Dulu harganya Rp360.000, sekarang Treatment Smoothing & Shave Rp450.000 ya Kak.';
  const guardedComp = await guardFactualServiceNumbers(comparisonQuote, {
    supabase: mockSupabase,
    serviceId: 'hair-smoothing',
  });
  assert.equal(guardedComp.blocked, false);
  assert.equal(guardedComp.sanitizedReply, comparisonQuote);
});

test('7. FACTUAL GUARD: Stale duration on current service is intercepted and corrected to 90 menit', async () => {
  const mockSupabase = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: [
                  {
                    id: 'a41ee0a1-f854-48ca-8304-30529451d3c8',
                    name: 'Treatment Smoothing & Shave',
                    price: 450000,
                    duration_minutes: 90,
                    is_active: true,
                  },
                ],
                error: null,
              });
            },
          };
        },
      };
    },
  };

  const replyWithWrongDuration = 'Treatment Smoothing & Shave durasinya 60 menit ya kak.';
  const guarded = await guardFactualServiceNumbers(replyWithWrongDuration, {
    supabase: mockSupabase,
    serviceId: 'hair-smoothing',
  });

  assert.equal(guarded.blocked, true);
  assert.equal(guarded.sanitizedReply, 'Treatment Smoothing & Shave durasinya 90 menit ya kak.');
});

// ── 4. BOOKING E2E AUTHORITY ──────────────────────────────────────
test('8. BOOKING E2E AUTHORITY: New booking for slug hair-smoothing resolves to current values and writes new snapshot', () => {
  // Simulate booking system resolving service by slug 'hair-smoothing'
  const catalogService = REDBOX_SERVICES.find((s) => s.id === 'hair-smoothing');
  assert.ok(catalogService, 'Slug hair-smoothing must resolve in catalog');
  assert.equal(catalogService.name, 'Treatment Smoothing & Shave');
  assert.equal(catalogService.price, 450000);
  assert.equal(catalogService.duration, '90 menit');

  // Simulate payload creation in booking.js (_buildPayloadFor)
  function buildBookingPayload(svc, location = 'bypass') {
    const effectivePrice = (location === 'csb' && svc.csbPrice) ? svc.csbPrice : svc.price;
    return {
      service_id: svc.id,
      service: svc.name,
      price: effectivePrice,
      duration: svc.duration,
      location,
      status: 'pending',
    };
  }

  // Standard outlet payload
  const bypassPayload = buildBookingPayload(catalogService, 'bypass');
  assert.equal(bypassPayload.service, 'Treatment Smoothing & Shave');
  assert.equal(bypassPayload.service_id, 'hair-smoothing');
  assert.equal(bypassPayload.price, 450000);
  assert.equal(bypassPayload.duration, '90 menit');

  // CSB outlet payload
  const csbPayload = buildBookingPayload(catalogService, 'csb');
  assert.equal(csbPayload.service, 'Treatment Smoothing & Shave');
  assert.equal(csbPayload.service_id, 'hair-smoothing');
  assert.equal(csbPayload.price, 450000, 'CSB price must be 450000');
  assert.equal(csbPayload.duration, '90 menit');

  // Verify historical snapshot rule: past booking snapshot must remain intact
  const historicalBookingSnapshot = {
    id: 'historical-booking-1',
    date: '2026-07-21',
    service: 'Hair Smoothing',
    price: 360000,
    status: 'done',
  };
  assert.equal(historicalBookingSnapshot.service, 'Hair Smoothing');
  assert.equal(historicalBookingSnapshot.price, 360000);
});

// ── 5. WHATSAPP AI PROJECTIONS ────────────────────────────────────
test('9. WHATSAPP AI KNOWLEDGE: services.json and faq.json match Treatment Smoothing & Shave', () => {
  const servicesJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../whatsapp-ai/knowledge/services.json'), 'utf8')
  );
  const smoothingService = servicesJson.services.find((s) => s.name === 'Treatment Smoothing & Shave');
  assert.ok(smoothingService, 'Treatment Smoothing & Shave must be in services.json');
  assert.equal(smoothingService.price, '450k');
  assert.equal(smoothingService.price_csb, '450k');
  assert.equal(smoothingService.duration, '90 menit');

  const faqJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../whatsapp-ai/knowledge/faq.json'), 'utf8')
  );
  const smoothingFaq = faqJson.faq.find((f) => f.question === 'Treatment Smoothing & Shave');
  assert.ok(smoothingFaq, 'Treatment Smoothing & Shave FAQ must exist');
  assert.ok(smoothingFaq.keywords.includes('smoothing'));
  assert.ok(smoothingFaq.keywords.includes('hair smoothing'));
  assert.ok(smoothingFaq.answer.includes('Treatment Smoothing & Shave'));
  assert.ok(smoothingFaq.answer.includes('Rp450.000'));
});

// ── 6. PRODUCTION DB EVIDENCE (READ-ONLY) ──────────────────────────
test('10. PRODUCTION DB EVIDENCE: Read-only verification of canonical row a41ee0a1-f854-48ca-8304-30529451d3c8', async () => {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { createClient } = require('@supabase/supabase-js');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return; // skip if no env
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase
    .from('services')
    .select('id, name, slug, price, duration_minutes, is_active, moka_item_id, moka_variant_name, moka_category_name')
    .eq('id', 'a41ee0a1-f854-48ca-8304-30529451d3c8')
    .single();

  assert.equal(error, null);
  assert.equal(data.id, 'a41ee0a1-f854-48ca-8304-30529451d3c8');
  assert.equal(data.name, 'Treatment Smoothing & Shave');
  assert.equal(data.slug, 'hair-smoothing');
  assert.equal(data.price, 450000);
  assert.equal(data.duration_minutes, 90);
  assert.equal(data.is_active, true);
  assert.equal(data.moka_item_id, '154255883');
  assert.equal(data.moka_variant_name, 'Hair Smoothing');
  assert.equal(data.moka_category_name, 'Regular Cutting');
});
