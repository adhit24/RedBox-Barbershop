'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');

function createResponseHarness() {
  const output = { statusCode: 200, headers: {}, body: null };
  const response = {
    setHeader(name, value) { output.headers[name] = value; return response; },
    status(code) { output.statusCode = code; return response; },
    json(payload) { output.body = payload; return response; },
    end() { return response; },
  };
  return { response, output };
}

// Helper to mock Date.now to off-hours time (23:30 WIB = 16:30 UTC)
function withOffHoursTime(fn) {
  const originalDateNow = Date.now;
  // 2026-08-26 23:30:00 WIB = 2026-08-26 16:30:00 UTC = 1787761800000 ms
  const offHoursMs = new Date('2026-08-26T16:30:00Z').getTime();
  Date.now = () => offHoursMs;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.finally(() => { Date.now = originalDateNow; });
    }
    Date.now = originalDateNow;
    return res;
  } catch (err) {
    Date.now = originalDateNow;
    throw err;
  }
}

// ── 1. Off-hours + points inquiry ─────────────────────────────────────────────
test('1. Off-hours + points inquiry: points path runs 24/7 without off-hours silencing', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);
    const sentMessages = [];

    const deps = {
      send: async (to, msg) => {
        sentMessages.push({ to, msg });
        return { status: true, id: ['msg-1'] };
      },
      loadConversationHistory: async () => [],
    };

    const res = await webhook.handleMessage({
      from: '6281234567890',
      name: 'Budi',
      text: 'poin saya berapa?',
      device: '0818202599',
      branchFromPayload: 'sumber',
      trustedIdentity: { status: 'verified', phone: '6281234567890' },
    }, deps);

    assert.equal(res.used, 'crm_points');
    assert.match(res.reply, /saldo poin member RedBox/i);
    assert.equal(sentMessages.length, 1);
  });
});

// ── 2. Off-hours + customer_history ──────────────────────────────────────────
test('2. Off-hours + customer_history: CRM path executes 24/7', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);
    const sentMessages = [];

    const deps = {
      orchestrate: async () => ({
        route: 'crm_agent',
        agent: 'crm_agent',
        intent: 'customer_history',
        action: 'get_customer_history',
        confidence: 1.0,
      }),
      executeIntelligence: async () => ({
        execution_status: 'success',
        intelligence: {
          status: 'success',
          facts_envelope: '<customer_facts_json>\n{"activity":{"completed_transaction_count":5}}\n</customer_facts_json>',
        },
      }),
      executeReddy: async () => ({
        reply: 'Terakhir cukur 15 Agustus 2026 di Sumber kak!',
        sendResult: { status: true },
      }),
      send: async (to, msg) => {
        sentMessages.push({ to, msg });
        return { status: true };
      },
      loadConversationHistory: async () => [],
    };

    const res = await webhook.handleMessage({
      from: '6281234567890',
      name: 'Budi',
      text: 'kapan terakhir aku potong rambut di Redbox?',
      device: '0818202599',
      branchFromPayload: 'sumber',
      trustedIdentity: { status: 'verified', phone: '6281234567890' },
    }, deps);

    assert.equal(res.used, 'crm_reddy_intelligence');
    assert.match(res.reply, /15 Agustus/i);
  });
});

// ── 3. Off-hours + normal general question ───────────────────────────────────
test('3. Off-hours + normal general question: Reddy processes message 24/7', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);
    const sentMessages = [];

    const deps = {
      send: async (to, msg) => {
        sentMessages.push({ to, msg });
        return { status: true };
      },
      loadConversationHistory: async () => [],
    };

    const res = await webhook.handleMessage({
      from: '6281234567890',
      name: 'Budi',
      text: 'harga potong rambut berapa?',
      device: '0818202599',
      branchFromPayload: 'sumber',
      trustedIdentity: null,
    }, deps);

    assert.equal(res.used, 'keyword');
    assert.match(res.reply, /harga layanan RedBox/i);
    assert.equal(sentMessages.length, 1);
  });
});

// ── 4. Off-hours + branch operating-hours question ───────────────────────────
test('4. Off-hours + branch operating-hours question: Reddy remains active and provides operating hours', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);
    const sentMessages = [];

    const deps = {
      orchestrate: async () => ({
        route: 'reddy_agent',
        agent: 'reddy_agent',
        intent: 'operating_hours_inquiry',
        action: 'answer_operating_hours',
        confidence: 0.95,
      }),
      executeReddy: async () => ({
        reply: 'Cabang Sumber saat ini sudah tutup ya kak, buka lagi besok jam 10:00 WIB!',
        sendResult: { status: true },
      }),
      send: async (to, msg) => {
        sentMessages.push({ to, msg });
        return { status: true };
      },
      loadConversationHistory: async () => [],
    };

    const res = await webhook.handleMessage({
      from: '6281234567890',
      name: 'Budi',
      text: 'Sumber masih buka?',
      device: '0818202599',
      branchFromPayload: 'sumber',
      trustedIdentity: null,
    }, deps);

    assert.equal(res.used, 'reddy_agent');
    assert.match(res.reply, /tutup/i);
    assert.match(res.reply, /besok jam 10:00/i);
  });
});

// ── 5. Human Takeover / wa_paused override ────────────────────────────────────
test('5. Human takeover / wa_paused still overrides 24/7 AI availability', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);

    const res = await webhook.handleMessage({
      from: '6281234567890',
      name: 'Budi',
      text: 'halo',
      device: '0818202599',
      branchFromPayload: 'sumber',
      aiPaused: true,
    });

    assert.equal(res.used, 'paused');
    assert.equal(res.reply, null);
  });
});

// ── 6. Untrusted request security gates ──────────────────────────────────────
test('6. Untrusted CRM requests still follow security gates 24/7', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);
    const sentMessages = [];

    const deps = {
      orchestrate: async () => ({
        route: 'crm_agent',
        agent: 'crm_agent',
        intent: 'customer_history',
        action: 'get_customer_history',
        confidence: 1.0,
      }),
      send: async (to, msg) => {
        sentMessages.push({ to, msg });
        return { status: true };
      },
      loadConversationHistory: async () => [],
    };

    const res = await webhook.handleMessage({
      from: '6281234567890',
      name: 'Budi',
      text: 'kapan terakhir aku potong?',
      device: '0818202599',
      branchFromPayload: 'sumber',
      trustedIdentity: null, // Untrusted context
    }, deps);

    assert.equal(res.used, 'crm_privacy_guard');
    assert.match(res.reply, /nomor terverifikasi/i);
  });
});

// ── 7. HTTP Webhook Handler Entry level 24/7 test ──────────────────────────────
test('7. Webhook HTTP handler entry point processes messages off-hours (no branch_ai_off_hours ignore)', async () => {
  await withOffHoursTime(async () => {
    const webhook = require(webhookPath);
    const { response, output } = createResponseHarness();

    const req = {
      method: 'POST',
      query: {},
      body: {
        device: '0818202599',
        sender: '6281234567890',
        message: 'harga',
        type: 'text',
        id: 'test-msg-offhours-001',
      },
    };

    await webhook(req, response);

    assert.equal(output.statusCode, 200);
    assert.notEqual(output.body?.reason, 'branch_ai_off_hours');
    assert.equal(output.body?.status, 'ok');
  });
});
