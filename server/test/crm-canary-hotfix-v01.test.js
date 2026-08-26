'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { getCustomer360 } = require('../crm/customer360Service');
const { issueTrustedIdentity } = require('../identity/trustedIdentity');
const webhookModule = require('../../api/wa/webhook');
const { handleMessage } = webhookModule;

// ── 1. PostgREST Thenable Mock (No .catch Method) ──────────────────────────
function createPostgrestThenableMock(data) {
  const obj = {
    then(onFulfilled, onRejected) {
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    },
    // Intentionally NO .catch method to accurately model Supabase PostgREST builder
  };
  return obj;
}

test('1. getCustomer360 executes cleanly when metadata queries return PostgREST thenables without .catch()', async () => {
  const mockSupabase = {
    from(table) {
      return {
        select() {
          return {
            or() {
              if (table === 'member_profiles') return Promise.resolve({ data: [], error: null });
              if (table === 'customers') return Promise.resolve({ data: [{ id: 'cust-1', name: 'Adhit Nugraha', wa: '6281234567890' }], error: null });
              if (table === 'bookings') return { order() { return Promise.resolve({ data: [{ id: 'b-1', customer_id: 'cust-1', date: '2026-08-20', location: 'Bypass', status: 'done' }], error: null }); } };
              return Promise.resolve({ data: [], error: null });
            },
            in() {
              if (table === 'transactions') {
                return {
                  eq() {
                    return {
                      order() {
                        return Promise.resolve({ data: [{ id: 't-1', customer_id: 'cust-1', outlet_id: 'out-1', created_at: '2026-08-25T14:00:00Z', status: 'completed' }], error: null });
                      },
                    };
                  },
                };
              }
              // Return PostgREST thenables WITHOUT .catch() for outlets, schedules, barbers
              if (table === 'outlets') return createPostgrestThenableMock([{ id: 'out-1', name: 'RedBox Bypass' }]);
              if (table === 'schedules') return createPostgrestThenableMock([]);
              if (table === 'barbers') return createPostgrestThenableMock([]);
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      };
    },
  };

  const res = await getCustomer360(mockSupabase, { phone: '6281234567890' });

  assert.equal(res.identity.customer_found, true);
  assert.equal(res.activity.last_visit, '2026-08-25');
  assert.equal(res.activity.last_visit_branch, 'RedBox Bypass');
  assert.notEqual(res.identity.resolution, 'db_error');
});

// ── 2. Live Customer History & Last Service Routing Priority Tests ─────────
test('2. Exact live phrase "terakhir aku potong rambut kapan ya?" routes to customer_history and returns CRM facts', async () => {
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '6281234567890',
  });

  const res = await handleMessage(
    {
      from: '6281234567890',
      text: 'terakhir aku potong rambut kapan ya?',
      branchFromPayload: 'sumber',
      trustedIdentity,
    },
    {
      send: async (_from, reply) => ({ status: 'sent' }),
      loadConversationHistory: async () => ({ history: [], rawCount: 0 }),
      orchestrate: async () => ({
        route: 'crm_agent',
        agent: 'crm_agent',
        intent: 'customer_history',
        action: 'get_customer_history',
        confidence: 1.0,
        fallback_used: false,
      }),
      executeIntelligence: async () => ({
        execution_status: 'success',
        intelligence: {
          facts: {
            last_visit: '2026-08-25',
            last_visit_branch: 'Bypass',
          },
        },
      }),
      executeReddy: async ({ customerIntelligence }) => {
        assert.ok(customerIntelligence);
        return { reply: 'Terakhir potong rambut tanggal 25 Agustus 2026 di cabang Bypass kak!', sendResult: { status: 'sent' } };
      },
    }
  );

  assert.notEqual(res.used, 'crm_unavailable_guard');
  assert.notEqual(res.used, 'keyword');
  assert.match(res.reply, /25 Agustus 2026|2026-08-25/);
});

test('3. Exact live phrase "layanan apa saya terakhir pakai?" routes to customer_history and returns last_visit_service, NOT catalog', async () => {
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '6281234567890',
  });

  const res = await handleMessage(
    {
      from: '6281234567890',
      text: 'layanan apa saya terakhir pakai?',
      branchFromPayload: 'sumber',
      trustedIdentity,
    },
    {
      send: async (_from, reply) => ({ status: 'sent' }),
      loadConversationHistory: async () => ({ history: [], rawCount: 0 }),
      orchestrate: async () => ({
        route: 'crm_agent',
        agent: 'crm_agent',
        intent: 'customer_history',
        action: 'get_customer_history',
        confidence: 1.0,
        fallback_used: false,
      }),
      executeIntelligence: async () => ({
        execution_status: 'success',
        intelligence: {
          facts: {
            last_visit_service: 'Gentleman Grooming',
          },
        },
      }),
      executeReddy: async ({ customerIntelligence }) => {
        assert.ok(customerIntelligence);
        return { reply: 'Layanan terakhir yang kamu ambil adalah Gentleman Grooming kak!', sendResult: { status: 'sent' } };
      },
    }
  );

  assert.notEqual(res.used, 'keyword');
  assert.match(res.reply, /Gentleman Grooming/);
});

test('4. Personal preference phrase "kapster favorit saya siapa?" routes to personalized path, NOT generic keyword', async () => {
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '6281234567890',
  });

  const res = await handleMessage(
    {
      from: '6281234567890',
      text: 'kapster favorit saya siapa?',
      branchFromPayload: 'sumber',
      trustedIdentity,
    },
    {
      send: async (_from, reply) => ({ status: 'sent' }),
      loadConversationHistory: async () => ({ history: [], rawCount: 0 }),
      orchestrate: async () => ({
        route: 'crm_agent',
        agent: 'crm_agent',
        intent: 'customer_preferences',
        action: 'get_customer_preferences',
        confidence: 1.0,
        fallback_used: false,
      }),
      executeIntelligence: async () => ({
        execution_status: 'success',
        intelligence: {
          facts: {
            favorite_barber: 'Ubay',
          },
        },
      }),
      executeReddy: async ({ customerIntelligence }) => {
        assert.ok(customerIntelligence);
        return { reply: 'Kapster favorit kamu di Redbox adalah Ubay!', sendResult: { status: 'sent' } };
      },
    }
  );

  assert.notEqual(res.used, 'keyword');
  assert.match(res.reply, /Ubay/);
});

test('5. Points inquiry "poin saya berapa?" executes crm_points deterministically', async () => {
  const trustedIdentity = issueTrustedIdentity({
    source: 'whatsapp',
    verifiedPhone: '6281234567890',
  });

  const res = await handleMessage(
    {
      from: '6281234567890',
      text: 'poin saya berapa?',
      branchFromPayload: 'sumber',
      trustedIdentity,
    },
    {
      send: async (_from, reply) => ({ status: 'sent' }),
      executeOrchestration: async () => ({
        mode: 'execute',
        execution_status: 'success',
        result: {
          status: 'success',
          tool: 'get_customer_points',
          customer_found: true,
          data: { points_balance: 150, status: 'available' },
        },
      }),
    }
  );

  assert.match(res.reply, /150/);
});

test('6. Generic public inquiry "layanan apa aja?" returns public catalog', async () => {
  const res = await handleMessage(
    {
      from: '6289999999999',
      text: 'layanan apa aja?',
      branchFromPayload: 'sumber',
    },
    {
      send: async (_from, reply) => ({ status: 'sent' }),
    }
  );

  assert.equal(res.used, 'keyword');
  assert.match(res.reply, /Redbox Gentleman Grooming|Gentleman Grooming/);
});

// ── 3. Welcome Message Personalization Rules Tests ─────────────────────────
test('7. Webhook system prompt enforces Welcome Message Personalization & Name Usage rules', () => {
  const webhookSource = fs.readFileSync(path.resolve(__dirname, '../../api/wa/webhook.js'), 'utf8');

  assert.match(webhookSource, /ATURAN SALAM & PERSONALISASI NAMA/);
  assert.match(webhookSource, /PENGGUNAAN NAMA/);
  assert.match(webhookSource, /DILARANG OVERUSE NAMA/);
  assert.match(webhookSource, /MAKSIMAL 1 CTA/);
});

// ── 4. Welcome Message Personalization Behavioral Tests (Round 1) ──────────
test('8. Welcome Test A — Verified CRM Name: executeReddyAgent passes customerIntelligence.facts.name to callOpenAI', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  let passedName = undefined;
  const mockCallOpenAI = async (from, text, name) => {
    passedName = name;
    return 'Halo Mas Adhit 👋 Ada yang bisa aku bantu?';
  };

  const intel = {
    facts: { name: 'Adhit Nugraha', membership_tier: 'Gold' },
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', name: 'Boss Besar', text: 'halo', customerIntelligence: intel },
    { callOpenAI: mockCallOpenAI }
  );

  assert.equal(passedName, 'Adhit Nugraha', 'callOpenAI must receive verified CRM name, NOT WhatsApp display name');
  assert.match(res.reply, /Adhit/);
});

test('9. Welcome Test B — Channel Name Safety: WhatsApp display name "Boss Besar" is NOT treated as verified CRM name', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  let passedName = undefined;
  const mockCallOpenAI = async (from, text, name) => {
    passedName = name;
    return 'Halo Kak 👋 Selamat datang di RedBox Barbershop! Ada yang bisa aku bantu?';
  };

  // No CRM name in intelligence
  const intel = {
    facts: { last_visit: '2026-08-20' },
  };

  const res = await executeReddyAgent(
    { from: '6281234567890', name: 'Boss Besar', text: 'halo', customerIntelligence: intel },
    { callOpenAI: mockCallOpenAI }
  );

  assert.equal(passedName, null, 'Unverified WhatsApp display name must resolve to null for verifiedName');
  assert.equal(res.reply.includes('Boss Besar'), false, 'Greeting must not fabricate verified name from channel display name');
  assert.match(res.reply, /Halo Kak/);
});

test('10. Welcome Test C — Known Returning Customer: CRM history facts present allow warm returning greeting', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');
  const { extractCustomerIntelligenceEnvelope } = require('../agents/reddy/customerFactsContext');

  let passedFactsContext = null;
  const mockCallOpenAI = async (from, text, name, branch, factsContext) => {
    passedFactsContext = factsContext;
    return 'Halo Mas Adhit 👋 Senang ketemu lagi di RedBox Bypass!';
  };

  const crmResult = {
    status: 'success',
    customer_found: true,
    data: {
      customer: { name: 'Adhit Nugraha' },
      activity: { last_visit: '2026-08-20', last_visit_branch: 'RedBox Bypass' },
    },
  };
  const intel = extractCustomerIntelligenceEnvelope(crmResult, 'customer_history');

  const res = await executeReddyAgent(
    { from: '6281234567890', text: 'halo', customerIntelligence: intel },
    { callOpenAI: mockCallOpenAI }
  );

  assert.ok(passedFactsContext);
  assert.match(passedFactsContext, /2026-08-20/);
  assert.match(res.reply, /Senang ketemu lagi/);
});

test('11. Welcome Test D — Unknown Customer: No CRM name or history results in warm generic greeting without fabricated name or history', async () => {
  const { executeReddyAgent } = require('../agents/reddy/reddyAdapter');

  let passedName = undefined;
  let passedFactsContext = undefined;

  const mockCallOpenAI = async (from, text, name, branch, factsContext) => {
    passedName = name;
    passedFactsContext = factsContext;
    return 'Halo Kak 👋 Selamat datang di Redbox Bypass. Ada yang mau dibantu?';
  };

  const res = await executeReddyAgent(
    { from: '6289999999999', name: 'Random User', text: 'halo', customerIntelligence: null },
    { callOpenAI: mockCallOpenAI }
  );

  assert.equal(passedName, null);
  assert.equal(passedFactsContext, null);
  assert.equal(res.reply.includes('Random User'), false);
  assert.equal(res.reply.includes('ketemu lagi'), false);
  assert.match(res.reply, /Halo Kak/);
});
